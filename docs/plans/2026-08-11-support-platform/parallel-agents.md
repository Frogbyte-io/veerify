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
- [ ] **SUP-04-3** `supportOutboundDelivery` table, **migration `0025`**, and the bounded claim/retry worker
- [ ] **SUP-04-4** Wire `messages/index.post.ts` for `kind: 'outgoing'` — in-transaction outbox enqueue, worker delivery-status update
- [ ] **SUP-04-5** Server-side enforcement that `kind: 'note'` never dispatches
- [ ] **SUP-04-8** Auto-reply with all four guards
- [ ] **SUP-04-9** `POST /api/support/delivery/[provider]` delivery and bounce webhooks, keyed on the new `supportDeliveryEvent` table (**not** `supportEmailEvent` — see answered question 1); hard bounce writes an `activity` message

### Agent 2 — composition, identity, UI, E2E

- [x] **SUP-04-2** `lib/support-email.ts` with unit tests for chain assembly and trimming
- [x] **SUP-04-6** Per-inbox From/Reply-To/signature + a settings warning when the address is not provider-authorized
- [ ] **SUP-04-7** Agent attachment upload via the existing presign flow, with size cap and type allowlist
- [ ] **SUP-04-10** Delivery status in the thread UI (pending/sent/failed/bounced) with a retry action
- [ ] **SUP-04-11** E2E: inbound mail → agent reply → customer reply threads back

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
