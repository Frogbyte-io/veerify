# Stage 01-04 Hardening Design

**Date:** 2026-08-25

**Status:** Approved direction; implementation pending

**Scope:** Security, authorization, identity, delivery reliability, and operational verification for Support Stages 01-04

## Purpose

Stages 01-04 provide contacts, conversations, inbound email, and outbound replies. The core flows work, but the final review found boundaries that need to be made production-safe before the branch is merged:

- agent attachments currently cross the API boundary as client-supplied storage metadata;
- inbox roles are stored but not enforced;
- automatic feedback linking is configurable but has no runtime behavior, and timelines are unbounded;
- RFC email identity and provider delivery identity are conflated;
- outbound retries can exhaust immediately and external delivery is not exactly-once;
- the build lifecycle performs database mutations implicitly and the production build has not completed in the review environment.

The design favors a predictable operator experience: ordinary work remains fast, administrative actions are clearly separated, privacy-sensitive linking stays conservative, and uncertain delivery behavior is surfaced instead of hidden.

## Global constraints

- Preserve the existing email-first scope. This work does not add live chat, social channels, or a knowledge base.
- Keep contacts and feedback as separate entities. Feedback never gains a contact foreign key.
- Preserve bracketless RFC Message-ID storage and add angle brackets only when constructing mail headers.
- Keep team administration and inbox-specific support roles as separate concepts.
- UI authorization is supplemental; every capability is enforced server-side.
- Existing messages, attachments, contacts, and links remain readable after migration.
- No raw credentials or attachment bytes are stored in outbox JSON.
- Schema changes use generated Drizzle migrations. Migration SQL is reviewed but never hand-authored.
- Manual provider prerequisites live in a separate checklist and do not block independent automated work.

## 1. Server-owned attachment uploads

### User experience

The composer remains a select-upload-send flow. It shows per-file progress and does not ask users to manage upload sessions. If an upload expires or is no longer valid, Send is blocked with a specific message: "This attachment expired. Remove it and upload the file again."

### Data model

Add `supportAttachmentUpload`:

| Column                   | Contract                                                                          |
| ------------------------ | --------------------------------------------------------------------------------- |
| `id`                     | Random opaque primary key returned to the composer                                |
| `conversationId`         | Required FK to `conversation`, cascade delete                                     |
| `userId`                 | Required FK to `user`, cascade delete                                             |
| `tempStorageKey`         | Server-generated temporary object key                                             |
| `finalStorageKey`        | Server-generated immutable final key, nullable until finalized                    |
| `fileName`               | Canonical sanitized display filename                                              |
| `requestedContentType`   | Allowlisted normalized MIME requested at presign                                  |
| `requestedSizeBytes`     | Size declared before upload                                                       |
| `storedContentType`      | Canonical allowlisted MIME stored for delivery; not byte-sniffed                  |
| `actualSizeBytes`        | Verified object size, nullable until uploaded                                     |
| `objectVersion`          | S3 ETag/version or local SHA-256 captured at completion                           |
| `status`                 | `pending`, `uploaded`, `finalizing`, `cleanup_required`, `consumed`, or `expired` |
| `expiresAt`              | Required expiry used by upload and cleanup paths                                  |
| `uploadedAt`             | Nullable upload completion time                                                   |
| `consumedAt`             | Nullable successful message-consumption time                                      |
| `tempDeletedAt`          | Nullable successful temporary-object cleanup time                                 |
| `cleanupAttemptCount`    | Retry counter for temporary/final orphan cleanup                                  |
| `cleanupLastError`       | Nullable sanitized cleanup failure                                                |
| `finalizeLeaseExpiresAt` | Recovers a crashed finalization attempt                                           |
| `messageId`              | Nullable FK to `conversationMessage` for audit                                    |
| timestamps               | Created and updated times                                                         |

Indexes cover `(conversationId, status)`, `(userId, status)`, and `(status, expiresAt)`.

Existing `conversationAttachment` rows are unchanged and need no backfill.

### Storage contract

Extend `StorageProvider` with metadata and copy operations:

- `headObject(key)` returns byte length, stored content type when available, and an ETag/version;
- `copyObject(sourceKey, destinationKey, { contentType, ifMatch })` creates the immutable final object only from the completed source version;
- existing `deleteObject` removes temporary objects after commit or during cleanup.

S3 upload targets must enforce the expected content type and content length through signed request constraints. If the configured S3-compatible provider cannot enforce a length constraint, the application proxies that upload through the bounded local-style endpoint instead of returning an unsafe direct target. The application still verifies object size and the completed object version before consumption.

`storedContentType` is the allowlisted request/storage metadata, not a claim that arbitrary file bytes were magic-sniffed. Agent files are always served as downloads with `nosniff`. Local storage obtains size from the filesystem and records MIME in the upload row; it does not need a MIME sidecar. The local upload endpoint consumes the request stream incrementally and aborts as soon as it exceeds 10 MB; it does not call `readRawBody` first.

Temporary keys use `support/attachments/uploads/{uploadId}/{filename}`. Final keys retain the existing outbound prefix and use a new random attachment ID. A temporary presigned target can never address a final object.

### API flow

1. `POST /api/support/attachments/presign`
   - authenticates the user and requires conversation access;
   - validates filename, allowlisted MIME, and the 10 MB per-file cap;
   - creates a pending upload row;
   - returns `uploadId`, upload target, expiry, and display metadata;
   - does not return a storage key.
2. Local upload PUT or S3 direct upload
   - accepts only the temporary key represented by the server-owned upload row;
   - enforces actual byte limits;
   - local upload computes SHA-256 while streaming, then records `uploaded`, actual size, stored content type, object version, and `uploadedAt`;
   - a local upload token is single-use because the route locks the pending row before writing.
3. `POST /api/support/attachments/{uploadId}/complete` for direct S3 uploads
   - authenticates the upload owner and requires the same conversation access;
   - is idempotent when called repeatedly for the same unchanged object;
   - calls `headObject`, verifies the requested size/type contract, and records actual size plus ETag/version;
   - rejects a missing, oversized, changed, expired, foreign-user, or foreign-conversation object;
   - transitions `pending` to `uploaded`; message creation never treats a bare S3 PUT as complete.
4. `POST /api/support/conversations/{id}/messages`
   - accepts `attachments: [{ uploadId }]` only;
   - locks all referenced upload rows;
   - requires the same conversation, current user, `uploaded` status, and unexpired session;
   - calls `headObject` and uses actual sizes for the 10 MB per-file and 25 MB per-message caps;
   - requires the current ETag/version to match the completed version, preventing replacement between completion and finalization;
   - rejects duplicate upload IDs;
   - in a short reservation transaction, locks each upload, writes a server-generated `finalStorageKey`, changes status to `finalizing`, sets a bounded finalization lease, and commits **before** any storage copy;
   - after that reservation is durable, conditionally copies the completed object using `ifMatch`;
   - in a separate message transaction, locks the same `finalizing` rows, verifies their key/version/lease, inserts message, attachment rows and outbox row, and changes the uploads to `consumed`;
   - if copy or message commit fails, a new short transaction changes the already-durable reservation to `cleanup_required`; if the process dies before that transaction, expiry of the durable finalization lease causes cleanup to make the same transition;
   - the message transaction never owns or rolls back the original `finalStorageKey` reservation, so cleanup cannot lose the orphan key;
   - after commit, deletes temporary objects best-effort and records `tempDeletedAt`.

The worker receives only canonical attachment rows created by this path. It rechecks the cumulative byte ceiling before buffering objects as a defense-in-depth guard.

### Downloads and cleanup

Attachment downloads keep conversation authorization and add `Content-Disposition: attachment` plus `X-Content-Type-Options: nosniff` for non-inline files.

A scheduled cleanup claims expired `pending`/`uploaded` rows, stale `finalizing` rows, every `cleanup_required` row, and `consumed` rows with `tempDeletedAt IS NULL` in bounded batches. For `cleanup_required`, `finalStorageKey` is the explicit orphan key: cleanup deletes it, clears it, and returns an unexpired session to `uploaded` (or an expired session to `expired`). Until then, Send returns a retryable conflict rather than copying again. Cleanup also removes temporary objects, increments cleanup attempts on failure, and records completion. Deletion is idempotent and remains retryable. Stale `finalizing` leases transition to `cleanup_required`, ensuring every reserved final key has a durable cleanup state.

Stages 01-04 have no hard-delete route for messages or conversations, and inbox deletion is restricted by existing conversations. A future hard-delete/retention feature must enqueue final attachment-object deletion before adding such a route; database cascade alone is not an acceptable storage cleanup mechanism. Production setup documents an object-store lifecycle rule for the temporary prefix as a backstop.

## 2. Enforced support permissions

### Role model

Team admins act as inbox admins for every inbox. Otherwise the required inbox-member role is evaluated by a centralized ranked helper.

| Capability                                              | Team admin | Inbox admin | Supervisor | Agent | Unassigned team member |
| ------------------------------------------------------- | ---------- | ----------- | ---------- | ----- | ---------------------- |
| List and open inbox                                     | Yes        | Yes         | Yes        | Yes   | No                     |
| Read and work conversations                             | Yes        | Yes         | Yes        | Yes   | No                     |
| Reply, note, status, assignment                         | Yes        | Yes         | Yes        | Yes   | No                     |
| Attach or remove existing tags                          | Yes        | Yes         | Yes        | Yes   | No                     |
| Create or delete shared tag vocabulary                  | Yes        | Yes         | Yes        | No    | No                     |
| View inbox members for assignment                       | Yes        | Yes         | Yes        | Yes   | No                     |
| Change member roles or membership                       | Yes        | Yes         | No         | No    | No                     |
| Edit inbox identity, addresses, routing, and auto-reply | Yes        | Yes         | No         | No    | No                     |
| Enable, disable, or delete inbox                        | Yes        | Yes         | No         | No    | No                     |
| Change team support policy or module toggles            | Yes        | No          | No         | No    | No                     |

Agents retain every day-to-day conversation capability and may attach existing tags. Supervisors additionally manage the shared tag vocabulary, while inbox admins own configuration and membership. Later productivity/SLA stages may add further supervisor-only workflow controls.

### API behavior

- `requireInboxAccess` returns the effective role and continues to support the team-admin bypass.
- Add `requireInboxRole(inboxId, userId, minimumRole)` and `requireTeamAdmin(teamId, userId)`.
- Inbox list queries return only memberships visible to ordinary users; team admins receive all team inboxes.
- Inbox creation requires team admin. Inbox list/detail requires agent-or-higher membership, with the team-admin bypass.
- Inbox identity/settings mutation, receiving-address mutation, member mutation/role changes, enable/disable, and deletion require inbox admin.
- Sending-status and channel-status reads require agent-or-higher access.
- Conversation list/create/detail/update; message list/create/retry; participant mutation; tag attachment/removal; and attachment presign/download require agent-or-higher access.
- Member list remains agent-readable so assignment controls work.
- Shared tag list requires support-team access; vocabulary creation/deletion requires supervisor-or-higher access in at least one team inbox or team admin.
- Contact, company, timeline, and contact-link routes retain the Stage 01 team-membership contract. Contacts are shared team entities rather than records owned by a single inbox.
- Team support settings GET requires team membership; policy mutation and team module mutation require team admin.
- The API returns effective capability flags with inbox/settings payloads so the UI does not infer permissions from labels.

`supportInboxMember.role` accepts only `agent`, `supervisor`, or `admin` in request validation and gains a database check constraint. The implementation inventories every route under `server/api/support` and every team module mutation route against the categories above; uncovered routes fail the authorization test matrix.

### UI behavior

- Inaccessible inboxes are absent rather than visible-but-broken.
- Settings controls are hidden or read-only based on server-returned capabilities.
- Role choices include concise descriptions.
- Existing agents lose administrative settings access immediately; there is no compatibility grace period.
- Authorization failures use a consistent message and return the user to an inbox they can access.

## 3. Privacy-safe feedback matching and bounded timelines

### Automatic linking

Keep the internal `autoLinkFeedback` field but label it **Automatically link signed-in customer feedback**.

When enabled, only future authenticated feedback where `feedback.authorUserId` exactly equals one active contact's `userId` in the same team is automatically linked. An active contact has `mergedIntoContactId IS NULL` and `blockedAt IS NULL`. If zero or more than one active contact matches, no automatic link is created. Email-only matches are never auto-linked. Automatic creation happens in the feedback write transaction, not during a timeline GET. Links use `source: 'auto'`, remain removable through the normal unlink action, and display an "Automatically linked" label.

Enabling the setting does not backfill historical feedback. Disabling it prevents future automatic links without deleting existing links. Only team admins can change the setting.

### Timeline pagination

Both linked feedback and possible matches are independently paginated with opaque `(createdAt,id)` cursors:

- default limit 25;
- maximum limit 100;
- descending deterministic order;
- separate `linkedCursor` and `probableCursor` request parameters;
- separate `linkedHasMore`/`linkedNextCursor` and `probableHasMore`/`probableNextCursor` response fields.

Possible-match queries remain team-scoped and exclude already-linked feedback. Both contact-detail surfaces render separate Load more controls. Linking or unlinking refetches the affected first page so an item moves between sections immediately.

Cursors reuse the existing versioned opaque list-cursor encoding, preserve millisecond timestamp precision, and include the row ID tie-breaker. Malformed or wrong-version cursors return the standard 400 validation response rather than silently restarting pagination.

## 4. Email identity and provider correlation

### RFC threading identity

Remove the global unique constraint on `conversationMessage.channelMessageId` and replace it with a non-unique lookup index. The message's conversation already owns the inbox scope; every lookup joins `conversationMessage` to `conversation` and filters by the resolved receiving `inboxId` before matching the bracketless RFC value. Inbound event claiming remains the concurrency/idempotency guard for provider retries.

This query-scoped approach requires no message backfill and avoids a nullable-to-not-null rolling migration. Two tenants may store the same externally supplied RFC ID without either write failing, while a header can never attach a message across inboxes. If an inbox itself contains more than one matching message, the header match is treated as ambiguous: no existing conversation is selected, a new conversation is created, and a collision warning is emitted. The resolver never guesses between customers.

Thread resolution remains scoped to the receiving inbox. Outbound RFC IDs stay random, bracketless in storage, and are enclosed in angle brackets only in mail headers. For Postmark SMTP, outbound messages include `X-PM-KeepID: true` so Postmark preserves that RFC header.

### Provider delivery identity

RFC Message-ID is never used as the primary delivery-webhook correlation key.

Each outbound delivery already has a stable `idempotencyKey`. Provider-specific headers carry it as correlation metadata:

- Postmark: `X-PM-Metadata-veerify-delivery-id`;
- Mailgun: `X-Mailgun-Variables` containing `veerify-delivery-id`.

`supportOutboundDelivery` gains nullable `provider`, `providerAccountKey`, and `providerMessageId` columns. Its existing globally unique `idempotencyKey` is the outbound `correlationKey`; existing queued rows already have this value and need no backfill.

`supportDeliveryEvent` gains required `providerAccountKey` (existing rows receive the explicit legacy sentinel `legacy` during the generated migration) and nullable `correlationKey`. Its unique index becomes `(provider, providerAccountKey, providerEventId)`.

The normalized `DeliveryEvent` contract contains `providerEventId`, `providerAccountKey`, `correlationKey`, `providerMessageId`, `recipient`, `recordType`, `occurredAt`, and `error`. Provider drivers also expose `buildDeliveryCorrelationHeaders(correlationKey)`. Webhook parsers read provider metadata, trace/event identifiers, and account/stream identity. The endpoint resolves the outbox by `correlationKey`, then obtains the exact local message. Provider-generated IDs are diagnostics and a fallback only when `(provider, providerAccountKey, providerMessageId, recipient)` resolves exactly one outbox row; RFC `channelMessageId` is never the delivery lookup.

The outbound transport returns `{ accepted, providerMessageId?, response }`. SMTP provider IDs are stored only when the response exposes a documented stable value; absence is valid because metadata correlation is primary.

Webhook idempotency prefers a provider event/trace ID. When unavailable, drivers construct a compound key including provider message ID, recipient, record type, and provider event timestamp. Provider account identity participates in unique event scope so separate accounts cannot collide.

Uncorrelated, valid provider events remain recorded and acknowledged without mutating a message. They are visible in logs/diagnostics rather than retried forever.

Existing queued outbox rows remain deliverable: the worker constructs provider metadata from each row's existing `idempotencyKey` at send time, so stored legacy payload JSON does not need rewriting. Existing attachment payloads continue to use already-persisted `conversationAttachment` records. Only new message API requests lose the unsafe raw-storage-key attachment shape. Already-sent legacy messages whose provider ID was never captured may produce recorded-but-uncorrelated webhooks; they are not falsely matched through RFC identity.

## 5. Retry and delivery-status contract

External email submission is **at-least-once**. Neither SMTP nor the initial providers supply a transaction that can atomically commit provider acceptance and the local outbox record. A process failure after provider acceptance and before local completion may cause a duplicate retry.

Add `nextAttemptAt` to `supportOutboundDelivery`. Claims select only pending rows whose next attempt is due. Retryable failures use exponential backoff with bounded jitter and do not become eligible again in the same worker pass. Maximum attempts remain five.

The stable RFC Message-ID and provider correlation metadata are reused for every attempt. This improves threading and diagnostics but is not presented as exactly-once delivery.

The operator-visible states are:

- **Queued**: stored locally and awaiting provider submission;
- **Sent**: provider/SMTP accepted submission;
- **Delivered**: provider reports acceptance by the recipient server;
- **Failed**: automatic submission attempts exhausted;
- **Bounced**: provider reports a terminal hard bounce.

Manual retry remains available for failed messages. If any previous submission attempt occurred, confirmation warns: "The previous attempt may already have been accepted. Retrying could send a duplicate."

Bounce remains terminal and wins over delivered events regardless of arrival order.

## 6. Build and operational safety

Remove database migration and seed commands from the package-manager `postbuild` lifecycle. Define explicit commands for:

- application compilation only;
- deployment migration;
- development/test seeding.

CI and provider deployment commands call the intended migration step explicitly. No ordinary local `yarn build` mutates a database.

Profile `nuxt build` separately from migration and seed work, capture phase timings and peak RSS, compare cold and warm generated caches, and record the last completed Nitro phase if it still fails to finish. Generated `.nuxt` and `.output` artifacts are not committed.

## 7. Migration and deployment sequence

Generated migrations add the attachment-upload table, role constraint, delivery correlation fields, retry scheduling field, and the channel-message lookup-index change. No data-derived not-null column or live backfill is required. The only existing-row value needed is the constant `legacy` provider-account sentinel, expressed as an additive default before the final not-null constraint by generated schema changes. If Drizzle produces unsafe ordering, split the schema changes into generated migrations by dependency rather than editing SQL manually.

Deployment order:

1. Inspect existing inbox-role values and delivery-event counts; abort if an invalid role exists rather than silently coercing it.
2. Apply additive tables/columns and the provider-account legacy default, then replace the global RFC-ID unique index with the non-unique lookup index.
3. Deploy backend and composer together because legacy raw attachment metadata is deliberately rejected.
4. Existing queued outbox rows continue through the compatibility behavior described above.
5. Configure provider metadata/webhook support and the S3 temporary-object lifecycle rule.
6. Run provider smoke tests before considering delivery correlation verified.

No compatibility path may continue accepting client-provided storage keys for new messages.

## 8. Error handling and observability

- Upload validation errors identify the affected filename and whether it expired, exceeded limits, or belongs elsewhere without exposing storage keys.
- Authorization errors never reveal inaccessible inbox names or membership.
- Provider events log provider, event ID, record type, recipient, correlation result, and local delivery/message IDs; credentials and message content are excluded.
- Cleanup reports claimed, deleted, expired, and retry counts.
- Retry scheduling logs attempt number and next eligible time.
- Metrics distinguish queued, sent, delivered, failed, bounced, uncorrelated provider events, expired uploads, and cleanup failures.

## 9. Test strategy

Implementation follows red-green-refactor for each task.

### Unit and route tests

- upload ownership, expiry, replay, wrong-conversation, actual-size, MIME, duplicate-ID, and total-cap cases;
- S3 completion idempotency, missing/replaced object rejection, ETag-conditional copy, and completion replay;
- local streaming rejection immediately after the byte ceiling without buffering the complete request;
- role matrix for every support route category, including inbox creation, statuses, contacts/companies, links/timelines, tags, participants, and attachments;
- inbox-list filtering and capability flags;
- deterministic auto-link rules and email-only non-linking;
- independent timeline cursors and already-linked exclusion;
- provider metadata construction/parsing and event-id fallback;
- retry backoff, jitter bounds, due-time claims, and stable identities;
- manual retry warning contract.

### Real Postgres integration

- atomic message, attachment, upload consumption, and outbox creation;
- rollback leaves an upload reusable and removes copied final objects;
- failed temporary/final orphan deletion remains claimable until cleanup succeeds;
- inbox-scoped duplicate RFC IDs across two teams;
- concurrent webhook duplicate claims;
- concurrent delivered and bounced events in both arrival orders, ending bounced with one bounce activity;
- auto-link concurrency without duplicate links;
- blocked, merged, ambiguous, email-only, and unlink-auto-link behavior;
- cleanup claiming without double deletion.

### Redis and multi-instance

Start two independent application processes using Redis realtime, connect one WebSocket client to each, mutate through instance A, and assert instance B receives message and delivery-status events. Include subscription restoration after a Redis reconnect. Memory-mode output remains explicitly single-instance.

### Browser/API E2E

- agent attachment upload, send, persisted attachment, and outbound payload;
- expired/missing upload produces re-upload guidance and no message;
- agent/supervisor/admin navigation and action visibility;
- inaccessible inboxes absent from lists;
- automatic signed-in feedback linking and manual email suggestion linking;
- independent timeline Load more controls;
- delivery retry confirmation;
- all Stage 03 inbound acceptance cases and all revised Stage 04 outbound acceptance cases, including legacy queued outbox delivery.

### Manual provider checklist

Keep a separate checklist for:

- Gmail and Outlook reply threading;
- Postmark SMTP metadata, preserved RFC ID, delivery, bounce, and webhook trace IDs;
- Mailgun metadata, delivery, and permanent failure events;
- multiple-recipient event correlation;
- S3 upload size enforcement and lifecycle cleanup.

Automated local tests and provider/manual validation are reported separately.

## 10. Completion criteria

- No API accepts arbitrary attachment storage keys for new messages.
- Actual uploaded bytes determine attachment caps and canonical metadata.
- Every support administration route enforces the approved role matrix.
- Ordinary users never see inaccessible inbox metadata.
- Automatic matching links only authenticated-user identity and remains auditable/reversible.
- Timeline responses are deterministically bounded.
- RFC threading and provider delivery correlation use separate identities.
- Provider retries cannot consume all attempts in one worker pass.
- Concurrent bounce/delivery ends in bounced state.
- Local build does not mutate the database and either completes or has a captured, reproducible build-phase diagnosis.
- Full harness, explicit Stage 01-04 E2E, real Postgres/Redis suites, and the two-process realtime test pass.
- Provider-only checks are completed or explicitly listed as outstanding manual prerequisites.
