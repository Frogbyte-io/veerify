# Stage 03 — Inbound email

**Depends on:** Stage 02. **Blocks:** Stages 04, 12.
**Read `design.md` first.**

**Goal:** Customer email arrives and becomes a conversation. Replies thread onto the existing
conversation rather than opening a new ticket.

## Scope

**In:** the channel adapter, provider webhook drivers, MIME parsing, threading, contact resolution,
product attribution from the receiving address, attachment ingest, inbox channel configuration UI.

**Out:** sending anything. Stage 04 owns all outbound mail, including auto-replies.

**Out — IMAP.** Inbound is **webhook-only** (delta D-29). There is no polling driver, no scheduled mail
fetch, and no IMAP credential storage. Self-hosted deployments require a webhook-capable mail provider.
If IMAP is ever reinstated it enters as another driver behind the same `InboundMessage` normalization,
which is what the adapter boundary below exists to allow.

## Work

### 1. Channel adapter

`server/services/support-channels/`, mirroring the `DOMAIN_PROVIDER` adapter pattern in
`server/services/domains/`:

- `types.ts` — a normalized `InboundMessage`: `messageId`, `inReplyTo`, `references[]`, `from`, `to[]`,
  `cc[]`, `subject`, `text`, `html`, `attachments[]`, `receivedAt`, `rawHeaders`.
- `webhook/postmark.ts`, `webhook/mailgun.ts` — signature verification plus provider payload →
  `InboundMessage`.
- `index.ts` — driver selection from `SUPPORT_CHANNEL_PROVIDER`.

Every driver produces `InboundMessage`. **Nothing downstream may know which provider it came from.**

### 2. Inbound endpoint

`POST /api/support/inbound/[provider]`

Order of operations matters and is a correctness requirement:

1. Verify the provider signature. Reject 401 on failure.
2. Atomically claim a `supportEmailEvent` row keyed on `(provider, providerEventId)`. It records
   `status` (`processing` | `processed` | `failed`), `attemptCount`, and a lease timestamp. A duplicate
   already `processed` returns 200; a stale or failed claim is safely replayed; an active claim returns
   200 without creating another ticket. Providers retry aggressively, but a crash after claiming an
   event must not permanently lose the email.
3. Archive the raw payload to storage (`rawStorageKey`) before parsing, so a parse failure is
   debuggable and replayable.
4. Parse to `InboundMessage`.
5. Resolve the inbox via `resolveInboxByAddress` against `to[]` and `cc[]`, matching against
   `supportInboxAddress` rows. No match → record the event with an error and return 200; do not 404, or
   the provider will retry forever.
6. Resolve or create the contact.
7. Resolve or create the conversation. On creation, set `conversation.projectId` from the matched
   `supportInboxAddress.projectId` (null when the address is unmapped) — see delta D-27. Never overwrite
   the product on an existing conversation; an agent may have corrected it.
8. Insert the `incoming` message and attachments, update `lastActivityAt` and `lastCustomerReplyAt`,
   publish realtime envelopes.
9. Stamp `processedAt` and `resultConversationId` on the event. On failure, record a sanitized error,
   release or expire the lease, and let provider retry or scheduled replay recover it.

Apply the Stage 00 rate limiter, keyed per inbox.

### 3. Threading

In priority order:

1. `In-Reply-To` or any `References` entry matching an existing `conversationMessage.channelMessageId`.
2. `conversation.channelThreadKey` matching the root of the `References` chain.
3. Fallback heuristic: same contact + same normalized subject (strip `Re:`, `Fwd:`, and locale variants)
   - an open or pending conversation on that inbox within a bounded window (default 7 days,
     configurable per inbox).
4. Otherwise, a new conversation.

The fallback is the risky one. It must be unit-tested against real-world subject mangling, and it must
never merge across contacts.

### 4. Content handling

- **Reply-quote stripping** — remove quoted history and signature blocks so the thread reads as a
  conversation, not nested quotations. Handle the common client patterns (Gmail, Outlook, Apple Mail)
  and keep the unstripped body in `metadata` so nothing is lost.
- **HTML sanitization** — inbound HTML is an active XSS vector rendered straight into the agent UI.
  Sanitize on ingest into `bodyHtml` with a strict allowlist, and render in a **sandboxed iframe**.
  Never `v-html` raw provider output. This extends the hardening already done in
  `lib/email-templates.ts`.
- **Attachments** — stream to storage via `server/utils/storage`, create `conversationAttachment` rows,
  map inline images by `Content-ID` so they render in place. Enforce a per-message size cap.
- **Auto-response detection** — drop or flag messages carrying `Auto-Submitted: auto-*`,
  `X-Autoreply`, or a null return-path, so out-of-office bounces do not reopen tickets or start loops.

### 5. Contact resolution

Look up `contactIdentity` on `(teamId, 'email', fromAddress)`. Create the contact and identity if absent,
using the `From` display name. `cc[]` addresses become `conversationParticipant` rows with `role: 'cc'`,
creating contacts for them as needed.

### 6. Inbox configuration UI

Channel tab on `/support/settings`: provider selection, the `supportInboxAddress` list with each
address's optional product mapping, the forwarding address to point MX or a forwarding rule at, the
webhook signing secret, and a connection test with a clear pass/fail result.

## Acceptance criteria

1. An email to a configured inbox address creates a conversation with the correct contact, subject, and
   body.
2. A reply to that conversation's outbound message threads onto the **same** conversation.
3. Delivering the identical webhook payload twice creates **exactly one** conversation and returns 200
   both times.
4. A simulated crash after an event claim is replayed after its lease expires and still creates exactly
   one conversation.
5. An email with attachments and inline images stores both; inline images render in the thread.
6. A `<script>` tag in inbound HTML does not execute in the agent UI.
7. An out-of-office auto-reply does not reopen a resolved conversation.
8. An email to an unknown address is recorded with an error and returns 200, not 404.
   8b. An email to an inbox whose team has the Support module switched off is recorded and returns 200
   without creating a conversation; existing conversations and contacts are untouched, and re-enabling
   the module resumes normal processing (delta D-32).
9. Quote stripping produces a clean body across Gmail, Outlook, and Apple Mail samples.
10. An email to a product-mapped address creates a conversation with that `projectId`; an email to an
    unmapped address creates one with `projectId` null. A reply to a conversation whose product an agent
    corrected does not revert it.
11. `yarn harness:verify` green on `support-platform`.

## TODO items

- [ ] Add `server/services/support-channels/` with `types.ts` and normalized `InboundMessage`; driver selection from `SUPPORT_CHANNEL_PROVIDER`
- [ ] Implement the Postmark webhook driver with signature verification and payload normalization; unit tests against captured fixtures
- [ ] Implement the Mailgun webhook driver with signature verification and payload normalization
- [ ] Add `supportEmailEvent` claim/replay state (`processing`/`processed`/`failed`, attempts, lease) and a guarded scheduled replay job; add `POST /api/support/inbound/[provider]` with verify → atomic claim → archive raw → parse → resolve inbox → resolve contact → thread → persist → publish → mark processed; per-inbox rate limiting
- [ ] Implement threading resolution (Message-ID/References, then thread key, then bounded subject+contact fallback); unit tests including the never-merge-across-contacts case
- [ ] Implement reply-quote and signature stripping for Gmail/Outlook/Apple Mail; retain the raw body in metadata; unit tests against fixtures
- [ ] Implement inbound HTML sanitization with a strict allowlist and sandboxed-iframe rendering in the thread pane
- [ ] Implement attachment ingest to storage with inline `Content-ID` mapping and a per-message size cap
- [ ] Implement auto-response detection (`Auto-Submitted`, `X-Autoreply`, null return-path) so bounces do not reopen or loop
- [ ] Honour the team's Support module switch: if `teamModuleSettings.supportEnabled` is false for the resolved inbox's team, record the event and return 200 **without** creating a conversation (delta D-32, moved here from SUP-02-13). Do not 404 or error — the sender is a mail provider that would retry forever, the same reasoning already applied to unknown addresses
- [ ] Implement contact and CC-participant resolution from `From` and `Cc`
- [ ] Implement product attribution on conversation creation from the matched `supportInboxAddress.projectId`, never overwriting an existing conversation's product
- [ ] Build the inbox channel configuration UI on `/support/settings` with provider setup, the receiving-address list with per-address product mapping, forwarding address, and a connection test
- [ ] Add E2E coverage: inbound mail creates a ticket, a reply threads onto it, a duplicate delivery does not double it

## Risks

- **Threading is the classic source of duplicate tickets.** Header-based matching first; the subject
  heuristic is bounded and never crosses contacts.
- **Inbound HTML is hostile input.** Sanitize on ingest _and_ sandbox on render. Both, not either.
- **Mail loops.** An auto-reply meeting an auto-reply generates unbounded traffic. Auto-response
  detection ships in this stage even though auto-reply _sending_ is Stage 04 — the detection has to exist
  before anything can be sent.
- **Provider retry storms and crashes.** Completed events return 200 without duplicate processing,
  while failed or expired claims remain replayable. Unknown-address deliveries return 200 only after
  their terminal error is recorded.
