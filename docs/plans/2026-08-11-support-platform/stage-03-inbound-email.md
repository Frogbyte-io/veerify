# Stage 03 — Inbound email

**Depends on:** Stage 02. **Blocks:** Stages 04, 12.
**Read `design.md` first.**

**Goal:** Customer email arrives and becomes a conversation. Replies thread onto the existing
conversation rather than opening a new ticket.

## Scope

**In:** the channel adapter, provider webhook driver, IMAP driver, MIME parsing, threading, contact
resolution, attachment ingest, inbox channel configuration UI.

**Out:** sending anything. Stage 04 owns all outbound mail, including auto-replies.

## Work

### 1. Channel adapter

`server/services/support-channels/`, mirroring the `DOMAIN_PROVIDER` adapter pattern in
`server/services/domains/`:

- `types.ts` — a normalized `InboundMessage`: `messageId`, `inReplyTo`, `references[]`, `from`, `to[]`,
  `cc[]`, `subject`, `text`, `html`, `attachments[]`, `receivedAt`, `rawHeaders`.
- `webhook/postmark.ts`, `webhook/mailgun.ts` — signature verification plus provider payload →
  `InboundMessage`.
- `imap.ts` — poll a mailbox, parse MIME, produce the same shape.
- `index.ts` — driver selection from `SUPPORT_CHANNEL_PROVIDER`.

Every driver produces `InboundMessage`. **Nothing downstream may know which provider it came from.**

### 2. Inbound endpoint

`POST /api/support/inbound/[provider]`

Order of operations matters and is a correctness requirement:

1. Verify the provider signature. Reject 401 on failure.
2. Persist a `supportEmailEvent` row keyed on `(provider, providerEventId)`. **On unique-constraint
   violation, return 200 immediately** — the provider is retrying a delivery already processed.
   Providers retry aggressively; a duplicate must never create a second ticket.
3. Archive the raw payload to storage (`rawStorageKey`) before parsing, so a parse failure is
   debuggable and replayable.
4. Parse to `InboundMessage`.
5. Resolve the inbox via `resolveInboxByAddress` against `to[]` and `cc[]`. No match → record the event
   with an error and return 200; do not 404, or the provider will retry forever.
6. Resolve or create the contact.
7. Resolve or create the conversation.
8. Insert the `incoming` message and attachments, update `lastActivityAt` and `lastCustomerReplyAt`,
   publish realtime envelopes.
9. Stamp `processedAt` and `resultConversationId` on the event.

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

### 6. IMAP driver

Register a scheduled task through the Stage 00 scheduler. Poll, fetch unseen messages, feed the same
pipeline, mark seen only after successful processing. Store credentials encrypted in
`supportInbox.channelConfig`.

### 7. Inbox configuration UI

Channel tab on inbox settings: provider selection, inbound address, the forwarding address to point MX
or a forwarding rule at, webhook signing secret, IMAP credentials, and a connection test with a clear
pass/fail result.

## Acceptance criteria

1. An email to a configured inbox address creates a conversation with the correct contact, subject, and
   body.
2. A reply to that conversation's outbound message threads onto the **same** conversation.
3. Delivering the identical webhook payload twice creates **exactly one** conversation and returns 200
   both times.
4. An email with attachments and inline images stores both; inline images render in the thread.
5. A `<script>` tag in inbound HTML does not execute in the agent UI.
6. An out-of-office auto-reply does not reopen a resolved conversation.
7. An email to an unknown address is recorded with an error and returns 200, not 404.
8. Quote stripping produces a clean body across Gmail, Outlook, and Apple Mail samples.
9. `yarn harness:verify` green on `main`.

## TODO items

- [ ] Add `server/services/support-channels/` with `types.ts` and normalized `InboundMessage`; driver selection from `SUPPORT_CHANNEL_PROVIDER`
- [ ] Implement the Postmark webhook driver with signature verification and payload normalization; unit tests against captured fixtures
- [ ] Implement the Mailgun webhook driver with signature verification and payload normalization
- [ ] Add `POST /api/support/inbound/[provider]` with the ordered pipeline: verify → idempotency insert → archive raw → parse → resolve inbox → resolve contact → thread → persist → publish; per-inbox rate limiting
- [ ] Implement threading resolution (Message-ID/References, then thread key, then bounded subject+contact fallback); unit tests including the never-merge-across-contacts case
- [ ] Implement reply-quote and signature stripping for Gmail/Outlook/Apple Mail; retain the raw body in metadata; unit tests against fixtures
- [ ] Implement inbound HTML sanitization with a strict allowlist and sandboxed-iframe rendering in the thread pane
- [ ] Implement attachment ingest to storage with inline `Content-ID` mapping and a per-message size cap
- [ ] Implement auto-response detection (`Auto-Submitted`, `X-Autoreply`, null return-path) so bounces do not reopen or loop
- [ ] Implement contact and CC-participant resolution from `From` and `Cc`
- [ ] Implement the IMAP driver with encrypted credentials and a scheduled poll via the Stage 00 scheduler
- [ ] Build the inbox channel configuration UI with provider setup, forwarding address, and a connection test
- [ ] Add E2E coverage: inbound mail creates a ticket, a reply threads onto it, a duplicate delivery does not double it

## Risks

- **Threading is the classic source of duplicate tickets.** Header-based matching first; the subject
  heuristic is bounded and never crosses contacts.
- **Inbound HTML is hostile input.** Sanitize on ingest _and_ sandbox on render. Both, not either.
- **Mail loops.** An auto-reply meeting an auto-reply generates unbounded traffic. Auto-response
  detection ships in this stage even though auto-reply _sending_ is Stage 04 — the detection has to exist
  before anything can be sent.
- **Provider retry storms.** The idempotency insert precedes all processing, and unknown-address
  deliveries return 200.
