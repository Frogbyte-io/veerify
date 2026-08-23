# Stage 04 — Parallel agent split

**Created:** August 17, 2026. **Applies to:** Stage 04 (outbound replies).
**Status: PROPOSED by Agent 1, awaiting Agent 2's ratification of the split.** The three questions
this document originally left open have since been **answered against the code** — see below; one of them
reverses Agent 1's first instinct and changes migration `0025`.
**Status detail:** Stage 03's split was written by Agent 2
before any code; this stage had none when Agent 1 started, and no `SUP-04-*` ids existed on the board.
Rather than assume ownership, Agent 1 drafted this. **Agent 2: amend or confirm before either side writes
code.** The Stage 03 retrospective at the bottom is worth reading — two of its findings change this stage.

**Supersedes** the Stage 03 split, which is complete (14/14).

---

## Workspaces

|                   | Agent 1                 | Agent 2            |
| ----------------- | ----------------------- | ------------------ |
| Working directory | **`D:\veerify-agent1`** | `D:\veerify`       |
| Branch            | **`agent1/stage-04`**   | `support-platform` |

`agent1/stage-04` is cut from **local `support-platform` at `350f5f3`**, not `origin/support-platform`.
At the time of writing origin is two commits behind local — `a6e58f5` (the SUP-03-14 E2E fix) and its
merge `350f5f3` are integrated locally but unpushed. Branching from origin would have silently dropped
the fix. **Agent 2: push `support-platform` when convenient**, so the next branch cut from origin is safe.

Shared and still true: the Postgres dev container is shared between worktrees, and ports 3001–3004 are in
use — start dev servers above that.

---

## Why the split is what it is

Stage 03's seam was **pipeline vs pure modules**, because the inbound endpoint was an integration point
consuming everything else. Stage 04 has the mirror-image shape: the **outbound send path** is the
integration point, and it consumes the generic sender, the composition helpers, per-inbox identity, and
attachments all at once.

So the same seam carries over, pointing the other way. **Agent 1 owns durability and the wire** — the
outbox table, the worker, the send trigger, the provider webhooks. **Agent 2 owns composition, identity,
and everything the agent sees** — the pure RFC-5322 helpers, per-inbox From/signature, attachment upload,
delivery-status UI, and the round-trip E2E.

Two items are deliberately placed against that grain, and it is worth saying why:

- **Auto-reply (SUP-04-8) is Agent 1's**, though it reads like a content feature. It fires from
  `server/api/support/inbound/[provider].post.ts` — Agent 1's file from Stage 03 — and enqueues onto
  Agent 1's outbox. Splitting it would put three of its four guards on one side of a seam and the trigger
  on the other.
- **Attachment upload (SUP-04-7) is Agent 2's**, though Stage 03's attachment _ingest_ was Agent 1's. The
  agent-side flow is composer UI plus the existing presign utilities; it touches none of the outbox.

---

## Agreed module interfaces — do not diverge without saying so

This is the mitigation that worked in Stage 03 and it is more important here, because the send path
touches both agents' code in a single call. If you need to change a signature, **say so before changing
it** rather than adapting locally.

```ts
// lib/email.ts                                (Agent 1 extends, both consume)
// Existing call sites pass { to, subject, html, text } and MUST keep working
// untouched - every new field is optional.
export interface SendEmailOptions {
  to: string | string[]
  cc?: string[]
  subject: string
  html?: string
  text?: string
  from?: { address: string; name?: string }
  replyTo?: string
  headers?: Record<string, string> // Message-ID, In-Reply-To, References, Auto-Submitted
  attachments?: EmailAttachment[]
}

// CORRECTED in SUP-04-1 (7740503). The pinned version below had `storageKey`
// on the attachment `sendEmail` takes, which conflated two different shapes
// and would have forced `lib/` to import `server/utils/storage`. There are two
// types, and the delivery worker is the bridge between them:
//
//   EmailAttachment   (lib/email.ts)  - already resolved to bytes
//   OutboundAttachment(outbox row)    - a storage key, resolved by the worker
export interface EmailAttachment {
  filename: string
  content: Buffer | Readable
  contentType?: string
  cid?: string // set for inline images
}

// lib/support-email.ts                        (Agent 2) - pure, no db, no io
export function generateMessageId(input: { messageId: string; domain: string }): string

// `existing` is oldest -> newest. Trimming keeps the FIRST entry and the most
// recent ones - a broken root is what mail clients will not tolerate.
export function buildReferences(input: { existing: string[]; inReplyTo: string | null; maxEntries?: number }): string[]

export function buildQuotedHistory(input: {
  previous: { fromName: string; sentAt: Date; body: string; bodyHtml: string | null }[]
}): { html: string; text: string }

export function appendSignature(input: { html: string; text: string; signature: string | null }): {
  html: string
  text: string
}

// Added for SUP-04-6. Reply-To is deliberately the same address as From: the
// schema has no separate Reply-To column (design.md's supportInbox field
// list has none) and no per-conversation reply-address token to thread on -
// Stage 03 threads on Message-ID/References instead. Caller (SUP-04-4) must
// guard supportInbox.emailAddress being null before calling this; it does
// not decide what happens when an inbox has no sending address.
export function buildOutboundIdentity(input: { emailAddress: string; fromName: string | null }): {
  from: { address: string; name?: string }
  replyTo: string
}
```

`generateMessageId` returns the value **with angle brackets stripped**, matching how Stage 03 stores
`InboundMessage.messageId` — the worker adds the brackets when it writes the header. This is the single
most likely place for a silent mismatch: Stage 03's threading matches on the stripped form, so a
bracketed value stored on `channelMessageId` would make every customer reply open a new ticket, which is
the stage's headline risk. **Both agents should assert this in a test on their own side.**

---

## Work split

### Agent 1 — outbound pipeline and delivery durability

Order matters: **1 → 3 → 4** is the critical path, and SUP-04-1 unblocks Agent 2, so it lands first.

- [x] **SUP-04-1** `lib/email.ts` options bag; confirm all 10 existing call sites are unaffected. Also add the outbound surface to `ChannelDriver` that SUP-04-6 needs (see answered question 3), folding in delta D-34's `isConfigured()` cleanup
- [x] **SUP-04-3** `supportOutboundDelivery` table, **migration `0025`**, and the bounded claim/retry worker
- [x] **SUP-04-4** Wire `messages/index.post.ts` for `kind: 'outgoing'` — in-transaction outbox enqueue, worker delivery-status update
- [x] **SUP-04-5** Server-side enforcement that `kind: 'note'` never dispatches
- [x] **SUP-04-8** Auto-reply with all four guards
- [ ] **SUP-04-9** `POST /api/support/delivery/[provider]` delivery and bounce webhooks, keyed on the new `supportDeliveryEvent` table (**not** `supportEmailEvent` — see answered question 1); hard bounce writes an `activity` message

### Agent 2 — composition, identity, UI, E2E

- [x] **SUP-04-2** `lib/support-email.ts` with unit tests for chain assembly and trimming
- [x] **SUP-04-6** Per-inbox From/Reply-To/signature + a settings warning when the address is not provider-authorized
- [x] **SUP-04-7** Agent attachment upload via the existing presign flow, with size cap and type allowlist
- [x] **SUP-04-10** Delivery status in the thread UI (pending/sent/failed/bounced) with a retry action
- [x] **SUP-04-11** E2E: inbound mail → agent reply → customer reply threads back

### File boundaries

| Agent 1 owns                                        | Agent 2 owns                        |
| --------------------------------------------------- | ----------------------------------- |
| `lib/email.ts`                                      | `lib/support-email.ts`              |
| `server/api/support/delivery/**`                    | `components/support/**`             |
| `server/api/support/conversations/[id]/messages/**` | `pages/support/**`                  |
| `server/utils/outbound-delivery.ts`                 | `server/api/support/attachments/**` |
| `server/services/support-channels/**`               | `server/api/support/inboxes/**`     |
| `server/api/support/inbound/**`                     | `tests/e2e/**`                      |
| `server/database/schema/support.ts`                 |                                     |

**Shared, read-only unless flagged:** `server/utils/storage/**`, `server/utils/upload-token.ts`,
`server/utils/support-realtime.ts`, `server/utils/support-access.ts`.

**One migration is expected this stage — `0025`, and it belongs to SUP-04-3 (Agent 1).** It creates
**two** tables: `supportOutboundDelivery` (specified in `design.md` but never created — the schema is at
`0024`) and `supportDeliveryEvent` (answered question 1). It does **not** alter `supportEmailEvent`.
If you believe you need a second migration, stop and say so first.

---

## Syncing

Unchanged, and it has worked for two stages: **`support-platform` is the single integration point.** Pull
from it at the start of every item; push finished items to it only after `yarn harness:verify` is green
_after_ merging `origin/support-platform` into your branch.

```bash
git fetch origin && git merge origin/support-platform
yarn harness:verify          # must be green after the merge, not before
git checkout support-platform && git pull --rebase origin support-platform
git merge --no-ff agent1/stage-04
yarn harness:verify
git push origin support-platform
git checkout agent1/stage-04 && git merge support-platform
```

`git checkout support-platform` fails while Agent 2 has it checked out — that is expected. Push your
branch, say it is ready, and Agent 2 integrates. On push rejection, `git pull --rebase`, re-verify, push
again. Never force-push.

---

## Rules

1. **`TODO.md` is edited by whoever integrates**, in a separate `chore(todo):` commit. Never inside a
   feature commit.
2. **Read before writing:** `.agents/CLAUDE.md`, then `design.md`, then `deltas.md` (35 entries; several
   override the stage docs), then `stage-04-outbound-replies.md`.
3. **Options API only** for new components.
4. **`validateBody(event, schema)`** — never a bare `.parse()` on a request body (delta D-25).
5. **Report ambiguity, don't silently resolve it.** This document exists because of that rule.
6. **Never run `prettier --write .`** on Windows. Use `npx prettier --check --end-of-line=auto .` and
   format only the files you touched. See SUP-X-6.

---

## SUP-04-1 has landed (`7740503`) — Agent 2 is unblocked

`lib/email.ts`'s options bag and `ChannelDriver`'s outbound surface are on
`agent1/stage-04`. Three things Agent 2 should know:

1. **The attachment type in the pinned contract was wrong and is corrected above.**
   `sendEmail` takes bytes, not a storage key.
2. **`Message-ID` / `In-Reply-To` / `References` are lifted out of the `headers`
   bag onto nodemailer's `messageId` / `inReplyTo` / `references` options.** Pass
   them either way — `buildMailPayload` lifts them for you, case-insensitively —
   but read them off the typed fields, not `payload.headers`.
   Worth recording: the original justification for this (that a raw header would
   produce a duplicate `Message-ID`) is **false**. Verified against MailComposer:
   nodemailer emits exactly one either way, and the option wins when both are set.
   The lifting stays for a different reason — one canonical path, and typed
   fields the worker can read — but nobody should repeat the wrong rationale.
3. **`checkSendingAuthorization` returns `unknown` when no API credential is set**,
   which is every deployment today. SUP-04-6 must render that as "cannot verify",
   **not** as a warning that the address is unauthorized. The three new env vars
   are optional and documented in `.env.example`.

**Not independently confirmed:** the exact Postmark and Mailgun endpoint and
credential pairings are written from documentation, not from a live call. Before
SUP-04-6 presents an `authorized` / `unauthorized` verdict as fact, one real call
against each provider is worth making — delta D-24 is the precedent.

---

## SUP-04-6 has landed (`ebe8d1d`) — Agent 1 has something to call for SUP-04-4

`buildOutboundIdentity` is in `lib/support-email.ts` (pinned above); `supportInbox.emailAddress` and
`fromName` are now editable via `PUT /api/support/inboxes/{id}` (they were columns nobody could ever
set — no endpoint or UI wrote them before this). Two things Agent 1 should know before wiring SUP-04-4:

1. **Reply-To is the same address as From**, not a distinct setting. There is no Reply-To column in the
   schema and no per-conversation reply-address token — Stage 03 threads on `Message-ID`/`References`,
   so there is nothing for a distinct Reply-To to buy. If SUP-04-4 needs something other than
   `buildOutboundIdentity`'s output verbatim, say so before diverging.
2. **`buildOutboundIdentity` does not guard against a null `emailAddress`.** `supportInbox.emailAddress`
   has no `.notNull()` — SUP-04-4 must check for it before calling this and decide what an inbox with no
   sending address does at send time (this stage's settings warning only covers the case where an
   address is set but unauthorized; an unset address is a different, prior condition).

The Postmark/Mailgun live-call verification noted above as unconfirmed is still unconfirmed — not
addressed by this item, which only consumes `checkSendingAuthorization`'s return shape, not its accuracy.

---

## SUP-04-3 has landed (`e7fddc1`, `a8cae92`) — the outbox Agent 1's SUP-04-4 and Agent 2's SUP-04-10 both need

Migration `0025` and `server/utils/outbound-delivery.ts` are on `agent1/stage-04`, merged with
`origin/support-platform` and pushed. Three things, one per stage item still ahead:

1. **SUP-04-4 (mine) enqueues via `enqueueOutboundDelivery(tx, { messageId, payload, kind? })`**, called
   inside the same transaction as the `conversationMessage` insert. `payload` is `OutboundDeliveryPayload`
   — the same shape as `lib/email.ts`'s `SendEmailOptions` except `attachments` are `OutboundAttachment[]`
   (`{ filename, contentType?, storageKey, cid? }` — a storage key, never bytes). SUP-04-4 builds `from`/
   `replyTo` from `buildOutboundIdentity`'s output and reads any `conversationAttachment` rows created by
   SUP-04-7 to populate `attachments` by storage key.
2. **SUP-04-10 (Agent 2's) renders `supportOutboundDelivery.status`** — `'pending' | 'sent' | 'failed'` —
   against the message it belongs to (join on `messageId`), and calls the new
   **`resetOutboundDeliveryForRetry(id)`** for the retry action, from a new endpoint (none exists yet — it
   is not in either agent's file-boundary list above, since it did not exist when that table was written;
   treat it as yours to add alongside the UI, under `server/api/support/conversations/**`). Do not reset
   `attemptCount` or `status` by writing to the table directly — go through this function, since a plain
   `UPDATE` would skip clearing `lastError` and the lease consistently.
3. **The worker itself (`runOutboundDeliveryWorker`) is not wired to run anywhere yet** — SUP-04-4 needs to
   trigger it after enqueueing (design.md's flow: insert → publish realtime → enqueue → _worker sends_).
   Every dependency of `processOutboundDelivery`/`runOutboundDeliveryWorker` is injectable specifically so
   it is unit-testable without Nitro's `useNodeMailer()` auto-import — call the exports with no `deps`
   argument in real code and they default to the real implementations.

**Not independently confirmed:** the guarded integration suite (claim atomicity under `FOR UPDATE SKIP
LOCKED`, lease behaviour, attempt-cap transitions) has not run against real Postgres in either worktree
this session — no Docker on this box. Verified it reaches a real connection attempt (`ECONNREFUSED`, not
an import/export error) and the full schema typechecks clean, but the atomicity claim itself is unproven
until someone runs it with `docker compose -f docker-compose-dev.yml up -d db` reachable.

---

## SUP-04-7 has landed — correcting an assumption in the note above

**"SUP-04-4 ... reads any `conversationAttachment` rows created by SUP-04-7" (above) does not hold, and
SUP-04-4 should not be built expecting it.** `conversationAttachment.messageId` is `.notNull()` — there is
no message row at upload time for a foreign key to point at, since an agent attaches files while composing,
before hitting send. Nothing can insert into that table until `messageId` exists, which makes it SUP-04-4's
job. This mirrors Stage 03's own inbound shape: `ingestInboundAttachments` (`server/utils/inbound-
attachments.ts`) writes bytes and returns `stored: StoredAttachment[]` for the _caller_ to insert once a
`messageId` is resolved — SUP-04-7 is the same pattern pointed the other way.

**What SUP-04-7 actually built, and what SUP-04-4 needs to do with it:**

1. `POST /api/support/attachments/presign` (`{ conversationId, filename, contentType, sizeBytes }`) checks
   `requireConversationAccess`, validates against `server/utils/support-attachments.ts`'s type allowlist and
   `MAX_ATTACHMENT_BYTES` (10 MB/file — mirrors Stage 03's inbound per-part cap), and returns an upload
   target plus a `storageKey` that already points at the file's **final** location:
   `support/attachments/outbound/{conversationId}/{attachmentId}/{filename}`. No temp-then-move step, unlike
   the project-asset presign flow — the key doesn't depend on anything not already known.
2. The client (composer) uploads bytes straight to that target — a real presigned S3 PUT, or
   `PUT /api/support/attachments/upload/{token}` for the local driver — **before** the reply is sent. By the
   time the message-creation POST fires, the object already exists in storage.
3. The composer's `POST /api/support/conversations/{id}/messages` body now includes an `attachments` array
   when non-empty: `{ storageKey, fileName, contentType, sizeBytes }[]`. **`messages/index.post.ts`'s
   `bodySchema` doesn't have this field yet**, so today it's silently stripped (zod's default is to drop
   unknown keys, not reject) — nothing breaks, but nothing happens with it either until SUP-04-4 adds it to
   the schema and, in the same transaction as the `conversationMessage` insert, inserts one
   `conversationAttachment` row per entry using the now-known `messageId` and the `storageKey` verbatim (no
   move needed — see point 1). Those same rows are what SUP-04-4 should read back to populate
   `OutboundDeliveryPayload.attachments` (`OutboundAttachment[]`), not a table SUP-04-7 populated itself.
4. **The per-file cap is enforced at presign (SUP-04-7); the per-message total cap
   (`MAX_MESSAGE_ATTACHMENT_BYTES`, 25 MB, also exported from `support-attachments.ts`) is not** — a single
   presign call can't see the other attachments in the same reply. SUP-04-4 is the first point that sees the
   full list and must enforce it there, same reasoning as Stage 03's `ingestInboundAttachments`.

**Not independently confirmed:** upload against a real S3-compatible endpoint (MinIO) hasn't been
exercised this session — no Docker on this box, same gap as SUP-04-3's note above. The local-driver path
(`putObject`/`getObject` round-trip) is exercised by existing storage tests, not by anything new here.

---

## SUP-04-4 and SUP-04-5 have landed — what SUP-04-10 and SUP-04-11 need

`messages/index.post.ts` now composes and enqueues an outgoing reply, in-transaction, using
`server/utils/outbound-reply.ts` (new, pure — `buildOutgoingReply`, `totalAttachmentBytes`) to assemble
threading headers, quoted history, signature, and the attachment list before calling
`enqueueOutboundDelivery`. SUP-04-5 (`kind: 'note'` never dispatches) is satisfied **by construction**,
not a separate code path — every step that touches the outbox is gated on `isOutgoing`, and a
`.superRefine` on the request schema now rejects a note carrying attachments outright rather than
silently dropping them.

**A real near-miss, caught before it shipped, not after:** this was written against a _guessed_
attachment shape before SUP-04-7 landed. The actual composer POST body
(`components/support/SupportComposer.vue`) and presign response use `{ storageKey, fileName, contentType,
sizeBytes }` — my draft used `filename` (no capital N). Since `validateBody`'s zod schema strips unknown
keys rather than rejecting them, every agent-attached file would have silently vanished on send, with no
error anywhere — exactly delta D-24's "no dedicated test, only exercised indirectly" failure shape, minus
even the indirect exercise. Caught by re-reading SUP-04-7's landing note before finalizing, not by a test.
Fixed, and `MAX_MESSAGE_ATTACHMENT_BYTES` (25 MB total) is now enforced here, per that note's instruction
— SUP-04-7's presign only ever sees one file and cannot check the combined total.

**For SUP-04-10 (delivery status UI):** `conversationMessage.deliveryStatus` starts `'pending'` for an
`outgoing` message (the worker updates it after `runOutboundDeliveryWorker` runs) and `'delivered'` for a
`note` — matching, not inventing, the convention Stage 03's inbound path already uses for "nothing to
send, already done." Do not treat `'delivered'` on a note as evidence anything was sent.

**For SUP-04-11 (E2E), specifically worth asserting rather than assuming:**

- A note with `attachments` set is rejected (400), not silently stripped.
- An inbox with no `emailAddress`, or a contact with no `email`, returns 409 rather than creating a
  half-sendable message.
- The stored `channelMessageId` on the new message round-trips correctly when the customer replies —
  this is the stage's headline risk (bracket-stripping), and it is only real once verified against actual
  inbound processing, not just unit-tested on the composition side.

**Not independently confirmed — same gap as every item this stage:** no live server, no E2E, no real
Postgres this session. The endpoint's own DB orchestration (the queries, the transaction, the field
mapping) has no dedicated test — this codebase has no precedent for unit-testing endpoint handlers
directly, so it rests on the pure logic it delegates to (`outbound-reply.ts`, fully tested) plus manual
code review, not automated proof. SUP-04-11 is the first thing that actually exercises it.

---

## SUP-04-10 has landed — correcting the note above: the worker never actually updated `conversationMessage.deliveryStatus`

**"The worker updates it after `runOutboundDeliveryWorker` runs" (above) was not true of the code as
landed, only of the intent.** `completeOutboundDelivery`/`failOutboundDelivery` (`server/utils/outbound-
delivery.ts`) only ever wrote to `supportOutboundDelivery.status`. Nothing touched `conversationMessage.
deliveryStatus` past its insert-time value of `'pending'` (outgoing) or `'delivered'` (note) — a message
would show `'pending'` forever in the UI regardless of whether the send actually succeeded, failed, or
exhausted its retries. Found while building the delivery-status UI: the two tables' `status` columns are
easy to conflate (both default `'pending'`), and grepping for any write to `conversationMessage.
deliveryStatus` after Stage 04 started turned up only the one at insert time.

**Fixed in `server/utils/outbound-delivery.ts`** (flagged crossing, mirroring SUP-04-4's fix of my SUP-04-7
contract guess above — same "caught before it shipped, not after" shape, just the other direction):

- `completeOutboundDelivery` and `failOutboundDelivery` now take `(id, messageId, ...)` and update both
  rows in one transaction (`applyDeliveryOutcome`), so the outbox row and the message row can never
  observably disagree.
- `failOutboundDelivery` only flips `conversationMessage.deliveryStatus` to `'failed'` when the failure is
  **terminal** (`attemptCount >= MAX_DELIVERY_ATTEMPTS`) — a below-cap failure leaves it at `'pending'`,
  matching the outbox row's own pending/failed split, since the agent should not see "failed" for something
  about to auto-retry.
- `resetOutboundDeliveryForRetry` also takes `(id, messageId)` now and resets `conversationMessage.
deliveryStatus` back to `'pending'` with `deliveryError` cleared.
- A new `publishDeliveryStatusChanged(messageId)` fires on every status change the UI needs to see
  (sent, terminal-failed, and reset-to-pending) — looks up `teamId`/`inboxId` fresh via a join since this
  module only ever has a bare `messageId`, publishes on the existing `conversation:{id}`/`inbox:{id}`
  channels, and swallows its own errors (never lets a realtime hiccup turn a correctly-recorded send into a
  500). `pages/support/index.vue`'s `subscribeConversation` already reloads messages on _any_ event
  regardless of `type`, so no client-side event-type handling was needed for this to work.
- `tests/outbound-delivery.test.ts` and `tests/integration/outbound-delivery.test.ts` updated for the new
  signatures; the integration suite now also asserts `conversationMessage.deliveryStatus`/`deliveryError`
  after each of the four functions, not just the outbox row.

**New this item:** `POST /api/support/conversations/{id}/messages/{messageId}/retry`
(`server/api/support/conversations/[id]/messages/[messageId]/retry.post.ts` — the endpoint SUP-04-3's note
ceded to Agent 2). 409s unless the message is `kind: 'outgoing'` and `deliveryStatus: 'failed'`; finds the
`supportOutboundDelivery` row by `(messageId, kind: 'email')`, calls `resetOutboundDeliveryForRetry`, then
fires `runOutboundDeliveryWorker()` the same fire-and-forget way SUP-04-4 does after the initial send, so a
retry is attempted immediately rather than waiting on the next unrelated reply to piggyback on.

**UI:** `components/support/SupportMessageItem.vue` now renders all five `deliveryStatus` values on an
`outgoing` message (clock/pending, check/sent, check/delivered, alert+Retry/failed, alert/bounced — the
last two of which nothing produces yet without SUP-04-9) and the retry button calls the endpoint above.
`SupportConversationThread.vue` passes `conversationId` down for it.

**Not independently confirmed:** same gap as everything else this stage — the new transaction, the join in
`publishDeliveryStatusChanged`, and the realtime round-trip have not run against a live server or real
Postgres this session (no Docker on this box). The four pure-logic paths are unit-tested; the DB
orchestration and the retry endpoint's own wiring are not, same as SUP-04-4's note above.

---

## SUP-04-8 has landed — two judgment calls for Stage 06, and what SUP-04-11 should assert

Auto-reply fires from `server/api/support/inbound/[provider].post.ts`, reusing `buildOutgoingReply`
(SUP-04-4) via new `server/utils/auto-reply.ts`. All four guards from the stage doc, plus the per-contact
rate limit it separately requires:

1. Never on a detected auto-response — enforced by control flow (the existing `isAutoResponse` check
   already returns before this code runs), not re-checked.
   2/3. Never on an existing conversation, never twice — both collapse into `isNewConversation`:
   `shouldSendAutoReply` only ever returns true on the "new conversation" branch, which happens at most
   once per conversation by definition. Not two separate checks.
2. `Auto-Submitted: auto-replied` — set by `buildAutoReply`.
3. Rate limit — 1 per contact per hour, via the existing `getRateLimitStore()` keyed by `contactId`, not
   the H3Event-bound `checkRateLimit`/`requireRateLimit` wrappers (those key by IP, wrong dimension here).

**Two judgment calls neither `design.md` nor `stage-04-outbound-replies.md` address, made explicitly
rather than silently:**

1. **The auto-reply does not touch `firstResponseAt` or `lastAgentReplyAt`.** A system-generated
   acknowledgment is not a substantive agent response in the Zendesk/Freshdesk sense those SLA fields
   exist to measure, but nothing in this stage's docs says so either way. **Whoever builds Stage 06 should
   confirm this reading deliberately rather than inherit it by default** — if SLA policy should instead
   treat an auto-reply as satisfying first-response time, that is a one-line change here
   (`conversationMessage.metadata.isAutoReply` already marks which messages are auto-replies) but changes
   what every team's FRT metric means.
2. **No sending address, or the inbound message has no Message-ID:** logged and skipped, the customer's
   message is still ticketed normally, and the webhook still returns 200. There is no agent present to
   show an error to — this is a webhook, not a request an agent made — so failing loudly (as SUP-04-4 does
   for the same missing-address case) is not available here. This means a misconfigured inbox can silently
   never auto-reply with nothing surfaced anywhere except the log. Worth a settings-page indicator someday;
   not scoped to this item.

**For SUP-04-11 (E2E), specifically worth asserting:**

- A second inbound email from the same contact, inside the rate-limit window, does **not** produce a
  second auto-reply — the conversation-scoped guard alone would not catch this (it is contact-scoped).
- An inbound message flagged by `isAutoResponse` never triggers one, even on what would otherwise be a
  new conversation.
- The auto-reply's own `channelMessageId` threads correctly if the customer replies to it — same
  bracket-stripping risk as every other threading path this stage, and untested by anything so far.

**Not independently confirmed:** same as everything else this stage — no live server, no real Postgres,
no E2E this session. The guard logic and composition are unit-tested (`tests/auto-reply.test.ts`); the
endpoint wiring and the rate-limit store call are not.

---

## SUP-04-11 has landed — written, not executed this session

`tests/e2e/support-outbound-reply.spec.ts`, following `support-inbound-email.spec.ts`'s guarded pattern
exactly (skips without `SUPPORT_POSTMARK_WEBHOOK_USER`/`PASSWORD`). One `describe.serial` test:

1. Inbound mail creates a ticket, same as Stage 03's own spec.
2. A reply attempt before the inbox has a sending address returns 409 (SUP-04-4's backstop).
3. Sets `emailAddress`/`fromName` via `PUT /inboxes/{id}` (SUP-04-6), then asserts a `note` carrying
   `attachments` is rejected 400 (SUP-04-4's `.superRefine`), then posts a real `outgoing` reply.
4. Asserts `channelMessageId` is set on the response **synchronously** (it's written in the same
   transaction as the insert, before any send is attempted).
5. Polls the message list up to 5s for `deliveryStatus` to leave `'pending'` — **regression coverage for
   the SUP-04-10 bug**: before that fix, this would have polled forever and the assertion would have
   caught it immediately. Tolerates either `'sent'` or `'failed'` as the outcome, since whether SMTP is
   reachable in whatever environment runs this is not what the assertion is checking.
6. Simulates the customer's reply with `In-Reply-To` set to the agent reply's `channelMessageId`, and
   asserts the conversation count is still 1 (not 2) — **the stage's headline risk**, exercised for real
   for the first time this stage rather than only unit-tested on the composition side.
7. Retrying the just-sent message is rejected 409 if it actually sent; only asserted loosely (`[200, 409]`)
   otherwise, since which branch is live depends on real SMTP reachability, not on anything this spec
   controls.

**Deliberately not covered, and why:**

- **Acceptance criterion 1** ("same thread in Gmail and Outlook") — needs real mailboxes at both
  providers; TODO.md already says to verify this by hand.
- **"Contact has no email" → 409** — structurally unreachable through the email channel: every inbound
  delivery carries a `From` address that becomes the contact's email, so there is no way to reach this
  branch from this suite. Only "inbox has no sending address" is exercised.
- **Auto-reply (SUP-04-8)'s own assertions** — the per-contact rate limit, the auto-response guard, and the
  auto-reply's own `channelMessageId` threading are a materially different scenario (an _inbound_ message
  opening a _new_ conversation) from the agent-initiated round trip this spec covers, and are not exercised
  here. They would need their own spec; not written this session.

**Not independently confirmed:** this spec has not been run — no Docker, no reachable Postgres, no
Postmark credentials on this box, same gap as every other guarded suite this stage. It typechecks and
lints clean, and its assumptions about response shapes (`message.channelMessageId`, `message.
deliveryStatus`, the 409/400 status codes) are cross-checked against the actual endpoint code as of this
commit, not run against a live server. Matches SUP-03-14's precedent: written-but-never-executed is an
accepted state here as long as it is said plainly, which this is.

---

## Questions that were open, and their answers

All three were resolved against the code before Agent 2 picked the stage up. **The first one reverses
Agent 1's original inclination**, so it is worth reading rather than skimming.

### 1. The delivery webhook gets its own table. Do not share `supportEmailEvent`.

The proposal originally leaned toward sharing the table and adding a `kind` column to the unique key.
**That is wrong, and `kind` would not have fixed it.**

`extractEventId` is what settles it. Both drivers key on one identifier per _email_:

- Postmark: `MessageID`, its own id for the inbound message.
- Mailgun: the RFC `Message-Id`, because "Mailgun's inbound routes carry no delivery id of their own"
  (`webhook/mailgun.ts:223`), with the signing token deliberately rejected because it changes per retry.

So `supportEmailEvent`'s semantic is **one email, one row** — that collapsing is the entire point, it is
what stops a provider retry becoming a second ticket. Delivery events have the opposite semantic: **one
event, one row.** A single outbound message legitimately produces several — Delivery, then Open, then
possibly Bounce or SpamComplaint — and they all describe the same message.

Key them the way inbound is keyed and only the _first_ event per message is ever recorded. Every later
one is swallowed as a duplicate, **including the hard bounce**. That is precisely the silent delivery
failure acceptance criterion 6 exists to prevent, and it would look like the feature working. Adding
`kind` does not help: all of a message's delivery events would still share one `providerEventId`.

The delivery event also wants columns `supportEmailEvent` has not got — a `messageId` FK to
`conversationMessage`, the record type, the recipient — while `rawStorageKey`, `resultConversationId` and
`inboxId` are dead weight for it.

**Decision:** migration `0025` creates **two** tables — `supportOutboundDelivery` (the outbox) and
`supportDeliveryEvent` (webhook idempotency), the latter keyed per event, not per message. This also
means Stage 03's `claimInboundEvent` and its `onConflict` target are **not touched**, which matters: that
path was just live-verified across 34 checks and altering its unique index for an unrelated event stream
is pure regression risk for no gain.

`design.md` supports the reading — it scopes `supportEmailEvent` to "inbound idempotency and audit", and
the stage doc asks to reuse the _pattern_, which is what a second table does.

**Still to confirm against captured fixtures, not from memory** — exactly which field is per-event for
each provider (Mailgun's `event-data.id` looks right; Postmark's Delivery payload may carry no event id
of its own, in which case the key must be composed from record type + message id + recipient). Stage 03
built its drivers against captured fixtures for this reason; do the same here.

### 2. The `Message-ID` domain comes from the inbox, falling back to `MAIL_FROM`.

`supportInbox.emailAddress` is the sending identity and its domain is the right source — but it is
**nullable** (`schema/support.ts:217`, no `.notNull()`), so it cannot be relied on alone.

**Decision:** use the domain of `supportInbox.emailAddress`; when it is null, fall back to the domain of
the `MAIL_FROM` env var, which is what the transport sends as today. That keeps the `Message-ID` domain
aligned with the `From` domain in both cases, which was the deliverability concern behind the question.

### 3. `SUP-04-6`'s provider-authorization check needs a new `ChannelDriver` method — Agent 1 adds it.

Confirmed by reading the interface: `ChannelDriver` is `name`, `verifySignature`, `extractEventId`,
`parse` (`support-channels/types.ts:72-91`). **It has no outbound surface whatsoever**, so there is
nowhere for "is this address authorized to send" to live today.

**Decision:** Agent 1 adds the driver method as part of SUP-04-1, so SUP-04-6 has something to call.
Agent 2 should consume it and **not** add one from the UI side. Fold in the `isConfigured()` cleanup that
delta D-34 flagged at the same time, since both are the same missing capability surface.

---

## What Stage 03 taught, that applies here

**1. The pinned-signature discipline worked, and the compile-time assertion is why.** SUP-03-1 added an
assertion in `tests/inbound-threading.test.ts` proving `InboundMessage` satisfied the structural type
`resolveThread` accepted — nothing called it across the seam until SUP-03-4, so without the assertion the
seam would have gone unchecked until integration. **Do the same here** for the `channelMessageId` bracket
convention above, which is this stage's equivalent trap.

**2. Crossing into the other agent's file is fine when flagged, and it was.** SUP-03-8 needed `<img>`
allowed in Agent 2's sanitizer; Agent 1 made the edit, and Agent 2 reviewed it and confirmed the anchoring
held. That is the right pattern — the failure mode is the silent edit, not the edit.

**3. A green gate can still mean nothing ran.** `yarn harness:verify` **skips** the E2E, Redis, and
Postgres gates when their services are unreachable rather than failing, so on a box with Docker down
"green" means typecheck, unit tests, and lint only. SUP-03-14's spec sat written-but-never-executed for
exactly this reason. If an item's acceptance criterion says E2E, confirm the spec actually _ran_.

**4. Acceptance criterion 1 cannot be met by this suite.** "Arrives in the same thread in Gmail **and**
Outlook" needs real mailboxes at both providers. Mailpit will not catch client-specific threading quirks —
the stage doc says so itself. Plan to verify this by hand and say plainly that it was manual, or descope it
deliberately. Do not let it be quietly satisfied by a Mailpit assertion.

---

## State at time of writing (`350f5f3`)

Stage 03 **complete, 14/14**; the inbound pipeline is live-verified end to end (34 checks against a real
server, Postgres and MinIO) and the Playwright suite is 37 passed / 1 skipped / 0 failed.

`yarn harness:verify` on `agent1/stage-04` is green: agent docs map, typecheck 54.7s, 198 unit tests, lint
0 errors / 168 warnings. **E2E, Redis and Postgres gates skipped** — Docker is not up on this box, per
finding 3 above.

**Two Stage 04 items are already partly delivered by Stage 02**, which narrows SUP-04-4:

- **`firstResponseAt` is already stamped** in `messages/index.post.ts:83-87`, on the first `outgoing`
  message only and guarded against overwrite. Acceptance criterion 7 is satisfied today; SUP-04-4 needs to
  preserve it, not build it.
- **The realtime publish is already immediate**, after the transaction commits and before any send
  (`messages/index.post.ts:96`). Acceptance criterion 8 is structurally satisfied; the outbox enqueue must
  go inside the existing transaction without moving that publish.

Open cross-cutting items: **SUP-X-3** (build-time OpenAPI scanner), **SUP-X-4** (admin-only module
toggles, deferred — read D-28 first), **SUP-X-6** (format gate + CRLF, and the skipping-gate problem in
finding 3).

**One Stage 03 loose end lands in Agent 1's lap this stage:** delta D-34 flagged that `REQUIRED_ENV` in
`channel-status.get.ts` hard-codes each provider's env vars, and that it belongs on `ChannelDriver` as
`isConfigured()`. Agent 2 could not fix it because `server/services/support-channels/**` was Agent 1's
territory. SUP-04-9 adds a second provider surface to that same map, so it is worth fixing now rather than
duplicating the duplication.
