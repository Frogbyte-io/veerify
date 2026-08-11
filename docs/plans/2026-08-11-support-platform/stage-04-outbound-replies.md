# Stage 04 — Outbound replies

**Depends on:** Stage 03. **Blocks:** Stages 05, 06, 07, 08.
**Read `design.md` first.**

**Goal:** Agent replies leave as real email that threads correctly in the customer's mail client, with
attachments, per-inbox identity, auto-reply, and delivery tracking. **This stage makes the product
usable** — at its exit a team can run real email support end to end.

## Scope

**In:** the outbound email layer, RFC-5322 threading headers, per-inbox From and signature,
attachments, auto-reply, delivery status, bounce handling, CC.

**Out:** macros and canned responses (Stage 05), SLA-driven sends (Stage 06), automation-driven sends
(Stage 07), CSAT emails (Stage 08).

## Work

### 1. Extend the email layer

`lib/email.ts` currently sends fixed transactional templates only. Extend `sendEmail` with an options
bag rather than forking a second sender:

```ts
sendEmail({
  to,
  cc,
  subject,
  html,
  text,
  from, // per-inbox address and display name
  replyTo,
  headers, // Message-ID, In-Reply-To, References
  attachments,
})
```

Existing call sites keep working unchanged — the new fields are optional.

Add `lib/support-email.ts` for the concerns that do not belong in the generic sender: generating a
stable `Message-ID` per outgoing message, assembling the `References` chain, building the quoted-history
block, and appending the inbox signature.

### 2. Threading headers

Every outgoing message must carry:

- `Message-ID` — generated, stored on `conversationMessage.channelMessageId`. This is what makes the
  customer's reply match in Stage 03.
- `In-Reply-To` — the `channelMessageId` of the message being replied to.
- `References` — the accumulated chain, capped at a sane length (keep the first and the most recent
  entries when trimming; mail clients tolerate trimming but not a broken root).

Getting this wrong means every customer reply opens a new ticket, which is the single most visible
failure a helpdesk can have. Test against a real mail client, not only Mailpit.

### 3. Sending a reply

`POST /api/support/conversations/[id]/messages` with `kind: 'outgoing'` now:

1. Inserts the message with `deliveryStatus: 'pending'`.
2. Publishes the realtime envelope immediately — the agent UI must not wait on SMTP.
3. Dispatches the send.
4. Updates `deliveryStatus` to `sent` or `failed` with `deliveryError`, and publishes again.
5. Sets `firstResponseAt` if this is the first agent reply — Stage 06's SLA timers depend on it, so it
   is set here even though SLA does not exist yet.

`kind: 'note'` never sends. Enforce that on the server, not only in the UI.

Recipients: the conversation's contact, plus `conversationParticipant` rows with `role: 'cc'`.

### 4. Per-inbox identity

From name and address, `Reply-To`, and the signature all come from `supportInbox`. The `From` address
must be one the configured provider is authorized to send as — surface a clear warning in inbox settings
when it is not, rather than failing silently at send time.

### 5. Attachments

Agent-side upload reuses the existing presign flow in `server/utils/storage` and
`server/utils/upload-token.ts`. Attach by reference to storage keys; enforce a per-message total size
cap and reject types by allowlist.

### 6. Auto-reply

When `supportInbox.autoReplyEnabled` and the inbound message opens a **new** conversation, send the
configured template. Guards, all required:

- Never auto-reply to a message flagged by Stage 03's auto-response detection.
- Never auto-reply more than once per conversation.
- Set `Auto-Submitted: auto-replied` on the outgoing message so the other end's loop detection works.
- Rate-limit auto-replies per contact per window.

### 7. Delivery status and bounces

Register the provider's delivery/bounce webhook at `POST /api/support/delivery/[provider]`, reusing the
`supportEmailEvent` idempotency pattern. Map events onto `conversationMessage.deliveryStatus`. A hard
bounce writes an `activity` message into the thread so the agent sees that the customer never received
the reply — silent delivery failure is worse than a visible error.

## Acceptance criteria

1. An agent reply arrives at a real mailbox and appears **in the same thread** as the original in Gmail
   and in Outlook.
2. The customer's reply to it lands on the same conversation (round-trip with Stage 03).
3. A note is never sent, even if the client posts `kind: 'note'` with recipients set.
4. Attachments sent by an agent arrive intact and are downloadable.
5. Auto-reply fires once on a new conversation and never on a subsequent reply or on a detected
   auto-response.
6. A hard bounce marks the message `bounced` and writes a visible `activity` line into the thread.
7. `firstResponseAt` is stamped on the first agent reply and not overwritten by later ones.
8. The agent UI shows the message immediately, before the send resolves.
9. `yarn harness:verify` green on `main`.

## TODO items

- [ ] Extend `lib/email.ts` with an optional options bag (from, replyTo, cc, headers, attachments); confirm all existing call sites are unaffected
- [ ] Add `lib/support-email.ts`: Message-ID generation, References chain assembly with trimming, quoted-history block, signature appending; unit tests for chain assembly
- [ ] Wire `POST /api/support/conversations/[id]/messages` for `kind: 'outgoing'`: optimistic insert, immediate realtime publish, async send, delivery status update, `firstResponseAt` stamping
- [ ] Enforce server-side that `kind: 'note'` never dispatches mail
- [ ] Implement per-inbox From/Reply-To/signature with a settings warning when the address is not provider-authorized
- [ ] Implement agent attachment upload via the existing presign flow with size cap and type allowlist
- [ ] Implement auto-reply with once-per-conversation, auto-response, `Auto-Submitted`, and per-contact rate-limit guards
- [ ] Add `POST /api/support/delivery/[provider]` for delivery and bounce webhooks with `supportEmailEvent` idempotency; map to `deliveryStatus` and write an `activity` message on hard bounce
- [ ] Surface delivery status in the thread UI (pending, sent, failed, bounced) with a retry action on failure
- [ ] Add E2E coverage for the full round trip: inbound mail → agent reply → customer reply threads back

## Risks

- **Broken threading headers.** Every customer reply opening a new ticket is the most visible possible
  failure. Verify in a real mail client; Mailpit will not catch client-specific quirks.
- **Mail loops.** Auto-reply is the loop vector. All four guards ship together or auto-reply does not
  ship.
- **Silent send failures.** An agent believing they replied when they did not is worse than a visible
  error. Delivery status is surfaced in the UI, not just stored.
- **Provider `From` restrictions.** Sending as `support@customer.com` requires that domain to be verified
  with the provider. Catch it in settings, not at send time.
