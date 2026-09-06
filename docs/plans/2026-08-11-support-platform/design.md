# Support Platform — Design

**Created:** August 11, 2026
**Status:** Approved for implementation

**Goal:** A Zendesk/Freshdesk-class support platform built into Veerify, presented in a Chatwoot-style
conversation UI, so support and product feedback share one platform, one team model, and one set of
public domains.

---

## Scope decisions

| Decision                    | Choice                                                                        |
| --------------------------- | ----------------------------------------------------------------------------- |
| First channel               | **Email only.** Live chat is Stage 11; social is Stage 12                     |
| Placement in hierarchy      | **Inbox entity**, team-scoped, optionally linked to a product                 |
| Contact ↔ feedback relation | **Separate.** Linked explicitly via `contactLink`, never structurally coupled |
| Conversation statuses       | **Fixed set**, not per-inbox customizable                                     |
| Realtime broker             | **Redis only**, via the Redis wire protocol                                   |
| Mail intake                 | **Adapter**: provider webhook                                                 |
| Knowledge base              | **Deferred**, dropped from this program                                       |
| Mail intake protocol        | **Webhook only.** IMAP polling dropped (delta D-29)                           |
| Inbox per team              | **One shared inbox, many receiving addresses**; product resolved per address  |
| Module enablement           | **Per team**, in a Tools tab in `/settings` (delta D-26)                      |
| Parity target               | Full Zendesk/Freshdesk parity, staged                                         |

### Why email-only first

Email covers the majority of real helpdesk volume, needs no client-side widget, and is entirely
request/response — no realtime dependency in the critical path. The Chatwoot-style _look_ is a rendering
decision and is delivered from Stage 02 regardless of channel.

### Why an inbox entity rather than a product feature toggle

An inbox is one channel endpoint (`support@acme.com`). Teams need more than one (`support@`, `billing@`),
and some want one desk spanning several products. Modelling the inbox as its own entity with a `type`
column means Stage 11 (chat) and Stage 12 (social) are new inbox types rather than a schema rewrite.

### How products map onto one inbox

A team runs **one shared inbox** with **many receiving addresses**. Each address optionally maps to a
product, so `billing@acme.com` attributes to Billing while `support@acme.com` stays unattributed. Agents
work one queue and filter by product; they can override the product on any conversation.

This exists because **email carries no product signal**. With a single address, every email ticket would
arrive unattributed and per-product reporting in Stage 09 would be meaningless. Portal (Stage 10) and
chat (Stage 11) submissions attribute from page context instead and need no address mapping.

`supportInbox.emailAddress` is the primary _sending_ identity; `supportInboxAddress` governs what the
inbox _receives_. See delta D-27.

Products get a Support tab and a `supportEnabled` feature toggle in `ProductSettingsFeatures.vue`
**from Stage 10**, not Stage 02 — the customer-facing entry point they control is the customer portal,
so shipping them earlier would mean a switch that does nothing. Module enablement for the agent-facing
side is per team, in a Tools tab in `/settings`, and is independent of any product toggle (delta D-26).

### Why contacts and feedback stay separate

This reverses an earlier draft that put `contactId` on `feedback` with a backfill. Reasons:

1. **Privacy.** Public feedback is frequently pseudonymous, with the email field optional and used only
   for notifications. A support ticket is a private exchange. Joining those identities structurally
   makes a pseudonymous public post resolvable from a support email, and does so silently.
2. **Erasure.** With `feedback.contactId`, a GDPR erasure request against a contact either cascades into
   feedback or silently orphans it. Kept separate, deleting a contact deletes the contact.
3. **Data quality.** Most public-board feedback is anonymous or email-less. Backfilling it would create
   thousands of empty contact records polluting the agent-facing contact list.
4. **Dependency direction.** It would have made the older, stable feedback subsystem depend on a
   brand-new support table. `contactLink` inverts this: support points at feedback.

**`server/database/schema/feedback.ts` receives no support-related columns and no data migration.**
The single permitted exception is an index on `feedback.authorEmail` (Stage 01), which keeps the
probable-match query cheap without changing the table's shape or contents.

The unified customer view is a **query, not a schema coupling**: given a contact with email `X`, their
probable feedback is `WHERE authorEmail = X OR authorUserId = contact.userId`. Deferring the match to
read time means the heuristic can be improved later without re-migrating anything.

### Why fixed conversation statuses

`open` / `pending` / `resolved` / `snoozed` / `closed`, hardcoded — deliberately unlike the per-project
`feedbackStatus` table. SLA timers ("time to first response", "time to resolution") and automation
conditions require well-known semantics; they are meaningless against user-invented states, and
reporting stops being comparable across teams. Zendesk and Freshdesk both keep statuses fixed for the
same reason. Custom _display labels_ over the fixed set can be added later without a data migration.

---

## Architecture

```
organization → team → supportInbox (type: 'email' | 'chat' | 'whatsapp' | …)
                          ↓ optional link
                       project (product)

team → contact ←── contactIdentity  (email | user | anon_session | chat_token)
         │
         ├── contactLink → feedback / conversation / …   (explicit, agent-confirmed)
         ↓
    conversation → conversationMessage (incoming | outgoing | note | activity)
                        ↓
                 conversationAttachment
```

### Realtime

Vercel supports WebSockets natively (public beta, June 2026) and lists Nitro/Nuxt as a supported stack;
`nuxt.config.ts` already sets `nitro.experimental.websocket: true`. WebSockets require Fluid compute.
Two constraints follow from Vercel's model and shape the design:

- A connection is pinned to one function instance and **closes at the function's max duration**
  (300s default, 800s Pro/Enterprise). Clients must reconnect, resubscribe, and reload state.
- **New connections are not guaranteed to reach the same instance**, and a deploy splits the fleet.
  In-memory fan-out is therefore broken by construction — this is why `server/utils/ws-connections.ts`
  must be rewritten, not merely extended.

**Broker: Redis, written against the Redis wire protocol via `ioredis` — not `@upstash/redis`.**
Cloud points `REDIS_URL` at Upstash or any provider; self-hosted points it at a `valkey/valkey:9`
container. Same driver, same code; the provider is a connection string. Writing against the proprietary
SDK would be the actual lock-in; the protocol is not.

Postgres `LISTEN/NOTIFY` was evaluated and rejected. It is adequate on throughput (~2.9K notifies/sec
naive, ~60K batched, against an expected peak near 50/sec) but `NOTIFY` takes a **global exclusive lock
at commit**, so contention degrades every write in the database, presenting as load spikes with falling
CPU and IOPS. PostgreSQL 19 removes the lock, but it is Beta as of June 2026 and self-hosters will run
14–18 for years. Redis is also required by Stage 11 for presence and typing indicators, which are Redis
data structures rather than pub/sub — so the second driver would have been discarded anyway.

**Thin event envelopes.** `pg`-style broadcast of record contents is not used. Events carry only
`{ v, type, teamId, inboxId, conversationId, messageId }` and the client refetches through the normal
authorized endpoint. Three benefits: reconnect-and-reload is just "refetch the list" (code that exists
anyway), payload size is a non-issue, and **a subscription bug can never leak another tenant's ticket
contents** — which in a multi-tenant support product is the argument on its own.

**Channels:** `team:<id>`, `inbox:<id>`, `conversation:<id>`, `user:<id>`. Authorization is checked **at
subscribe time**, not at publish time.

**Two checks, not one.** Subscribe-time authorization proves a listener _may_ hear a channel; it cannot
prove a payload was meant for it. So publish also verifies that the envelope's scope matches the channel
(`envelopeMatchesChannel`) — otherwise nothing stops a `team:A` event reaching every legitimately
subscribed listener of `team:B`.

**Envelopes are scoped, not necessarily team-scoped.** Each envelope must carry at least one scope id,
and it must match its channel. `teamId` is not universally required: a `user:<id>` event is scoped by the
user, who may belong to several teams. Requiring a team there was an early mistake that blocked
notifications from using the channel system at all — see delta D-01.

**Peers are capped at 50 channels** (`MAX_CHANNELS_PER_PEER`). Unbounded subscribes would mean one
authorization query and one broker subscription per request — a cheap denial-of-service.

**Never spread an envelope into a wire frame.** Nest it: `{ type, channel, event }`. Spreading lets the
envelope's own `type` overwrite the frame type and silently breaks client dispatch (delta D-02).

### Mail intake

`server/services/support-channels/` mirrors the existing `DOMAIN_PROVIDER` adapter pattern in
`server/services/domains/`.

- **`webhook` driver** (Stage 03): provider POSTs parsed MIME to
  `/api/support/inbound/[provider]`. Signature verified, then recorded in `supportEmailEvent` for
  idempotency before any processing — providers retry, and a duplicate delivery must not create a
  second ticket.

**Webhook only.** The IMAP polling driver was dropped (delta D-29), taking with it the scheduled poll,
encrypted IMAP credentials, and the parallel intake path. Self-hosted deployments require a
webhook-capable mail provider. The Stage 00 scheduler is still required by Stages 06, 08, and 09 — only
mail intake stops depending on it.

### Deployment

Self-hosting is the _better_ realtime environment: on the Nitro `node-server` preset, WebSockets have no
duration cap and no instance pinning. But the repo cannot currently self-host at all — there is **no
`Dockerfile`**, and `docker-compose.yml` runs only Postgres, with no app, storage, or mail service.
Stage 00 closes this.

Scheduling differs by mode: Vercel Cron on cloud, Nitro scheduled tasks on VM, behind one interface.
Needed by Stage 06 (SLA sweeper), Stage 08 (CSAT dispatch), and Stage 09 (nightly rollups). Mail intake
does not use it — inbound is webhook-only (delta D-29).

---

## Data model

New file `server/database/schema/support.ts`. All ids are `text('id').primaryKey()`; all timestamps use
`.$defaultFn(() => new Date())`, matching existing schema files.

### Stage 01 — identity

**`contact`** — a customer, scoped to a team.
`id`, `teamId` (FK team, cascade), `name`, `email`, `phone`, `avatarUrl`, `companyId` (FK supportCompany,
set null), `userId` (FK user, set null — set when the contact has a Veerify account), `attributes`
(jsonb, custom fields), `blockedAt`, `mergedIntoContactId` (self FK, set null), `lastSeenAt`,
`createdAt`, `updatedAt`.
Indexes: unique `(teamId, email)`; `(teamId, createdAt)`; `(companyId)`; `(userId)`.

**`contactIdentity`** — the identifiers a contact is known by. Separate table so contact merge is
repointing rows plus a tombstone, not a destructive overwrite, and so new channels add identifier kinds
for free.
`id`, `contactId` (FK, cascade), `teamId`, `kind` (`email` | `user` | `anon_session` | `chat_token`),
`value`, `verifiedAt`, `createdAt`.
Indexes: unique `(teamId, kind, value)`; `(contactId)`.

**`supportCompany`** — the Zendesk "organization" concept, named to avoid collision with the existing
`organization` table.
`id`, `teamId` (FK, cascade), `name`, `domain`, `attributes` (jsonb), `createdAt`, `updatedAt`.
Indexes: unique `(teamId, domain)`; `(teamId, name)`.

**`contactLink`** — explicit, agent-confirmed links from a contact to other entities. Lives in the
support schema and points outward, so `feedback.ts` stays untouched.
`id`, `contactId` (FK, cascade), `entityType` (`feedback` | `conversation`), `entityId`,
`source` (`auto` | `agent`), `createdByUserId` (FK user, set null), `createdAt`.
Indexes: unique `(contactId, entityType, entityId)`; `(entityType, entityId)`.

### Stage 02 — inbox and conversations

**`supportInbox`**
`id`, `teamId` (FK, cascade), `projectId` (FK project, set null), `name`, `slug`, `type` (default
`email`), `channelConfig` (jsonb — provider, inbound address, credential references), `emailAddress`,
`forwardAddress`, `fromName`, `signature`, `autoReplyEnabled`, `autoReplyTemplate`,
`defaultAssigneeUserId` (FK user, set null), `isEnabled`, `createdAt`, `updatedAt`.
Indexes: unique `(teamId, slug)`; unique `(emailAddress)`; `(teamId)`; `(projectId)`.

**`supportInboxAddress`** — the addresses one inbox receives on, and the product each maps to. Teams run
one inbox per team but want several addresses: one per product, plus general team addresses.
`id`, `inboxId` (FK, cascade), `address` (unique), `projectId` (FK project, set null — null means
unattributed), `isPrimary`, `createdAt`.
Indexes: unique `(address)`; `(inboxId)`; `(projectId)`.

**`supportInboxMember`** — inbox-specific support permissions live here. Team module enablement is a
workspace-administration concern and requires `teamMember.role = 'admin'`; this deliberately revises the
earlier deferral in D-28. Day-to-day support permissions remain independent of `teamMember.role`.
`id`, `inboxId` (FK, cascade), `userId` (FK user, cascade), `role` (`agent` | `supervisor` | `admin`),
`createdAt`. Indexes: unique `(inboxId, userId)`; `(userId)`.

**`conversation`**
`id`, `inboxId` (FK, restrict), `teamId` (FK, cascade — denormalized for team-scoped queries and
isolation checks), `contactId` (FK contact, restrict), `projectId` (FK project, set null — the resolved
product, from the receiving address's mapping or an agent override), `displayId` (integer,
human-readable ticket number), `subject`, `status` (`open` | `pending` | `resolved` | `snoozed` |
`closed`), `priority`
(`low` | `normal` | `high` | `urgent`, nullable), `assigneeUserId` (FK user, set null),
`linkedFeedbackId` (FK feedback, set null), `channelThreadKey` (root RFC Message-ID),
`firstResponseAt`, `resolvedAt`, `snoozedUntil`, `lastActivityAt`, `lastCustomerReplyAt`,
`lastAgentReplyAt`, `metadata` (jsonb), `createdAt`, `updatedAt`.
Indexes: unique `(teamId, displayId)`; `(teamId, status, lastActivityAt)`; `(inboxId, status)`;
`(assigneeUserId, status)`; `(contactId, createdAt)`; `(channelThreadKey)`; `(projectId, status)`.

**`supportCounter`** — per-team `displayId` allocation. A row per team incremented with
`SELECT … FOR UPDATE` inside the same transaction as the conversation insert.
`teamId` (PK, FK cascade), `nextConversationDisplayId` (integer).

**`conversationMessage`**
`id`, `conversationId` (FK, cascade), `kind` (`incoming` | `outgoing` | `note` | `activity`), `body`,
`bodyHtml` (sanitized), `senderKind` (`contact` | `agent` | `system`), `senderContactId` (FK, set null),
`senderUserId` (FK user, set null), `isPrivate`, `channelMessageId`, `inReplyTo`, `channelHeaders`
(jsonb), `deliveryStatus` (`pending` | `sent` | `delivered` | `failed` | `bounced`), `deliveryError`,
`metadata` (jsonb), `createdAt`.
Indexes: `(conversationId, createdAt)`; non-unique `(channelMessageId)`; `(deliveryStatus)`. RFC-ID
resolution always joins through `conversation.inboxId`; an ambiguous same-inbox match never selects a
thread. See `stage-01-04-hardening-design.md`.

`kind = 'activity'` stores system events ("assigned to Bob", "status → resolved") as messages rather
than in a side table. This is what lets the Chatwoot-style thread render actions inline with replies
from a single ordered query.

**`conversationAttachment`**
`id`, `messageId` (FK, cascade), `storageKey`, `fileName`, `contentType`, `sizeBytes`, `isInline`,
`contentId`, `createdAt`. New outbound attachments reach this table only through the server-owned
`supportAttachmentUpload` session/finalization flow; clients never submit trusted storage keys or file
metadata. Existing inbound and legacy attachment rows remain readable. See
`stage-01-04-hardening-design.md`.

**`conversationParticipant`** — CCs and watchers.
`id`, `conversationId` (FK, cascade), `contactId` (FK, cascade, nullable), `userId` (FK user, cascade,
nullable), `role` (`cc` | `follower`), `createdAt`. Indexes: unique `(conversationId, contactId)`,
unique `(conversationId, userId)`.

**`supportTag`** / **`conversationTag`** — team-scoped tags and their join table.

**`supportEmailEvent`** — inbound idempotency and audit.
`id`, `inboxId` (FK, cascade), `provider`, `providerEventId`, `rawStorageKey`, `status`
(`processing` | `processed` | `failed`), `attemptCount`, `leaseExpiresAt`, `processedAt`,
`resultConversationId`, `error`, `createdAt`. Index: unique `(provider, providerEventId)`. A unique key
is not enough: a failed claim must be replayable without duplicating a processed event.

**`supportOutboundDelivery`** — durable outbound-delivery outbox (Stage 04).
`id`, `messageId` (FK conversationMessage, cascade), `kind`, `payload` (jsonb with storage/credential
references only), `idempotencyKey`, `status`, `attemptCount`, `leaseExpiresAt`, `lastError`, timestamps.
Unique `(messageId, kind)`. Message insertion and outbox enqueue are one transaction; a worker claims
and retries delivery. Later CSAT and social-channel sends reuse it.

### Later stages

Introduced by the stage that needs them: `businessHours`, `slaPolicy`, `slaTarget`, `slaBreach` and the SLA columns on
`conversation` (Stage 06); `cannedResponse`, `macro` (Stage 05); `automationRule`, `automationRuleRun`
(Stage 07); `csatSurvey`, `csatResponse` (Stage 08).

---

## Changes to the existing system

| #   | Change                                                                                                                                                                    | Stage | Why                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Split `schema/feedback.ts` (564 lines) into `feedback.ts`, `notifications.ts`, `imports.ts`, `changelog.ts`; add `support.ts`                                             | 00    | Four domains in one file. Support extends notifications and imports, so both boundaries get touched regardless. No migration — definitions move, SQL is unchanged                 |
| 2   | New `server/services/realtime/` with `redis` (ioredis) and `memory` drivers; rewrite `ws-connections.ts` to channel subscriptions with subscribe-time authorization       | 00    | In-memory fan-out is broken across instances on both Vercel and any multi-instance self-host                                                                                      |
| 3   | `Dockerfile` + production `docker-compose.yml` with `app`, `valkey`, `minio`, and Caddy                                                                                   | 00    | There is no Dockerfile today and prod compose runs only Postgres — self-hosting is currently impossible. Caddy on-demand TLS is what makes `project.customDomain` work off-Vercel |
| 4   | Store adapter for `server/utils/rate-limit.ts` (`memory` \| `redis`), reusing the same Redis                                                                              | 00    | Same in-memory flaw, already flagged in `TODO.md`. Inbound webhooks need throttling that holds across instances                                                                   |
| 5   | Scheduler abstraction (Vercel Cron \| Nitro scheduled task)                                                                                                               | 00    | Needed by the SLA breach sweeper (06), CSAT dispatch (08), and nightly rollups (09). Not by mail intake — inbound is webhook-only                                                 |
| 6   | New `server/utils/support-access.ts`: `requireInboxAccess`, `requireConversationAccess`, `requireContactAccess`, `resolveInboxByAddress`                                  | 02    | Mirrors `project-access.ts`. Support permissions go on `supportInboxMember.role`; **`teamMember` semantics unchanged**                                                            |
| 7   | `AppSidebar.vue`: existing mis-named `Support` group renamed to `System`; new `Support` group with Inbox and Contacts; `/support` added to `protectedRoutes`              | 02    | Route-guard rule 10 in `.agents/CLAUDE.md`. The old group holds only Settings; the name is needed for the real module (delta D-26)                                                |
| 7b  | New per-team **Tools** tab in `/settings` with Feedback/Roadmap/Changelog/Support module toggles driving sidebar visibility                                               | 02    | Feature toggles are per-project today, but an inbox is team-scoped. Also replaces the hardcoded `disabled: true` Roadmap/Changelog placeholders in `AppSidebar.vue`               |
| 7c  | `supportEnabled` added to `ProductSettingsFeatures.vue` and a product Support tab                                                                                         | 10    | Deferred from 02: the customer-facing entry point these control is the Stage 10 portal, so shipping them earlier means a switch that does nothing                                 |
| 8   | New notification types in `server/utils/notifications.ts` (`conversation_assigned`, `conversation_mention`, `sla_breach`) + preference toggles in `SettingsNotifications` | 02/06 | Reuses shipped notification infrastructure rather than building a parallel one                                                                                                    |
| 9   | Extend `lib/email.ts` with an options bag (custom From/Reply-To, `In-Reply-To`/`References`/`Message-ID`, attachments); add `lib/support-email.ts`                        | 04    | Today it only sends fixed transactional templates. Without real RFC-5322 threading every reply opens a new ticket                                                                 |
| 10  | Register support routes in `server/utils/openapi.ts`                                                                                                                      | 02+   | Public API docs are published at `/api-docs`                                                                                                                                      |
| 11  | Add `docs/plans/2026-08-11-support-platform/` and the support paths to `docs/agent/context-map.md`                                                                        | 00    | `yarn harness:docs` gates on the context map staying current                                                                                                                      |

**Explicitly not changed:** `server/database/schema/feedback.ts` gains no columns and no data migration.
`teamMember.role` semantics are untouched. `components/ui/` is not hand-edited.

---

## Testing strategy

- **Unit (`vitest`)** — pure logic, the highest-value target: MIME parsing and reply-quote stripping,
  RFC-5322 threading resolution, SLA timer arithmetic against business hours, automation condition
  evaluation, contact-merge repointing, realtime envelope authorization.
- **Integration** — inbound webhook idempotency (duplicate delivery creates exactly one conversation),
  `displayId` allocation under concurrent inserts, cross-tenant isolation on every new endpoint.
- **E2E (`playwright`)** — agent replies to a ticket; a customer reply threads onto the same
  conversation; two agents see each other's messages live; conversation converts to feedback.
- **Every stage must leave `yarn harness:verify` green on `support-platform` until the program lands on `main`.**

## Risks

| Risk                                                               | Mitigation                                                                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Email threading is the classic source of duplicate tickets         | Message-ID/References first, subject+contact heuristic as fallback, `supportEmailEvent` idempotency ahead of any processing |
| Inbound HTML email is a live XSS vector rendered into the agent UI | Sanitize on ingest into `bodyHtml`, render in a sandboxed iframe, never `v-html` raw provider output                        |
| Open WebSockets bill as active function time on Vercel             | Idle-disconnect after ~5 min of tab inactivity with refetch-on-focus; model against concurrent-agent count before rollout   |
| Stage 00 blocks everything and is mostly infrastructure            | Keep it strictly scoped; it must not grow support features. Its acceptance test is two app instances exchanging one event   |
| Fan-out of stages 05–08 causes merge conflicts in the agent UI     | Assign at most one of those stages per agent at a time and integrate sequentially, per the harness                          |

## Open questions

None blocking. Two to revisit at their stage boundary:

- **Stage 11** — whether Centrifugo replaces the hand-rolled WS layer once presence, typing indicators,
  and channel history are all required. It self-hosts as one compose service and clusters over the Redis
  already introduced in Stage 00, but on Vercel it must live elsewhere, splitting the cloud architecture.
- **Stage 09** — whether confirmed `contactLink` rows should be materialized into a rollup for
  cross-surface analytics, once there is real data on how often agents link tickets to feedback.
