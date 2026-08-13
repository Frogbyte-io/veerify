# Stage 12 — Social channels

**Depends on:** Stages 03, 11. **Blocks:** nothing.

**Goal:** WhatsApp Business, Facebook and Instagram DM, and X as additional inbox types.

> Outline-level detail. Refine when unblocked. **Each channel is independently dispatchable** — treat
> them as separate sub-stages rather than one unit of work.

## Why this is cheap by now

Everything structural already exists: `supportInbox.type` discriminates channels, the Stage 03 channel
adapter normalizes inbound messages, `contactIdentity` accommodates new identifier kinds, and the agent
UI renders channel-agnostic messages. Each channel is an adapter plus an OAuth flow plus a webhook
endpoint. **No schema changes to `conversation` or `conversationMessage` should be needed.** If one
appears necessary, the abstraction from Stage 03 is wrong and should be fixed rather than worked around.

## Per-channel work

Each channel needs: an OAuth or token connection flow in inbox settings, a webhook receiver reusing the
`supportEmailEvent` idempotency pattern (rename it if the generalization is worth it), inbound
normalization to the Stage 03 `InboundMessage` shape, an outbound sender, and channel-specific
capability flags.

**Channel-specific constraints that shape the work:**

| Channel                 | Constraint                                                                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WhatsApp Business       | **24-hour customer service window** — outside it you may only send pre-approved template messages. The composer must reflect this, or agents write replies that silently fail |
| Facebook / Instagram DM | 7-day messaging window with similar tagging rules; strict app review for the required permissions                                                                             |
| X                       | API access tier and cost; DM rate limits are aggressive                                                                                                                       |

Capability flags on the inbox (`supportsAttachments`, `supportsRichText`, `messagingWindowHours`,
`requiresTemplateOutsideWindow`) let the composer disable or warn rather than fail at send time. Build
this before the first channel, not after the second one exposes the need.

## Acceptance criteria

Per channel:

1. Connecting the channel in inbox settings completes OAuth and stores credentials encrypted.
2. An inbound message creates or threads onto a conversation with the right contact.
3. An agent reply is delivered on the channel.
4. Duplicate webhook delivery does not duplicate the message.
5. The composer reflects the channel's messaging window and capabilities, warning before send rather
   than failing after.
6. `yarn harness:verify` green on `support-platform`.

## TODO items

- [ ] Add inbox capability flags (`supportsAttachments`, `supportsRichText`, `messagingWindowHours`, `requiresTemplateOutsideWindow`) and surface them in the composer
- [ ] Generalize the Stage 03 webhook idempotency and inbound pipeline for non-email channels, and route outbound sends through Stage 04's durable `supportOutboundDelivery` outbox
- [ ] Implement the WhatsApp Business channel: connection flow, webhook, inbound normalization, outbound send, 24-hour window handling with template messages
- [ ] Implement the Facebook and Instagram DM channel: connection flow, webhook, inbound, outbound, 7-day window handling
- [ ] Implement the X channel: connection flow, webhook, inbound, outbound, DM rate limit handling
- [ ] Add per-channel E2E or contract tests against provider sandboxes where available

## Risks

- **Provider approval timelines.** WhatsApp and Meta app review can take weeks and are not under your
  control. Start the approval process before the implementation work, not after.
- **Messaging windows.** Silently failing sends outside a channel's window will look like a product bug
  and erode agent trust. Surface the window in the composer.
- **Credential handling.** Long-lived channel tokens are high-value secrets. Encrypt at rest and support
  rotation.
- **Abstraction leakage.** If a channel forces schema changes to `conversation`, stop and fix the Stage 03
  abstraction instead.
