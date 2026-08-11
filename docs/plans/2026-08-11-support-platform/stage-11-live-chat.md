# Stage 11 — Live chat

**Depends on:** Stages 00, 02. **Blocks:** Stage 12.

**Goal:** An embeddable chat widget as a second inbox type — the Chatwoot experience the UI was designed
for from Stage 02.

> Outline-level detail. Refine when unblocked. **Reassess the transport decision at the start of this
> stage** — see Open questions below.

## Scope

Embeddable widget, `type: 'chat'` inbox, presence and typing indicators, agent availability, transcript
email, offline-to-email fallback.

## Why this works without a rewrite

The Stage 02 model was built for it: `supportInbox.type` already discriminates channels,
`contactIdentity` already supports a `chat_token` kind, and `conversationMessage` already carries
`incoming`/`outgoing`/`note`/`activity` without any email-specific assumptions. The Redis broker from
Stage 00 is already in place. This stage adds a channel, not a subsystem.

## Work

- **Widget** — a standalone bundle served from the app, embedded by a script tag. Reuses the embed
  distribution approach already built for the public board iframe embed
  (`components/products/ProductSettingsEmbed.vue`). Must be small, style-isolated from the host page,
  and functional without cookies where possible.
- **Visitor identity** — a `chat_token` `contactIdentity`, upgraded to an email identity when the
  visitor provides one, which is exactly the case `contactIdentity` was designed for.
- **Presence, typing, availability** — Redis data structures with TTL, not pub/sub. Agent availability
  is per inbox and drives routing and the widget's online/offline state.
- **Offline fallback** — when no agent is available, collect an email address and convert the exchange
  into a standard email conversation, so nothing is lost outside working hours.
- **Transcript email** on chat close.
- Realtime channels reuse `conversation:<id>` and `inbox:<id>` from Stage 00, with a distinct
  authorization path for unauthenticated visitors: a visitor may subscribe **only** to their own
  conversation, verified by chat token.

## Open questions to settle before starting

**Does Centrifugo replace the hand-rolled WebSocket layer here?** By this stage the requirements are
presence, typing indicators, channel history, and reconnect-with-replay — all of which Centrifugo
provides out of the box and clusters over the Redis introduced in Stage 00. It self-hosts as one
additional compose service. Against it: on Vercel it must be hosted elsewhere, splitting the cloud
architecture, and it is an additional operational dependency.

Decide explicitly at the start of this stage. Do not drift into a half-built presence implementation
before making the call.

**Vercel WebSocket duration.** Connections close at the function's max duration (300s default, 800s
Pro). Acceptable for agents with the Stage 00 reconnect logic; verify it is acceptable for visitors
mid-conversation, since a dropped socket during an active chat is far more visible than in an agent
inbox.

## Acceptance criteria

1. A visitor opens the widget on a third-party site and exchanges messages with an agent in real time.
2. Typing indicators and presence work across two app instances.
3. A visitor who provides an email is linked to their existing contact if one exists.
4. With no agent available, the widget collects an email and the exchange becomes an email conversation.
5. Widget styling is unaffected by the host page's CSS.
6. A visitor cannot subscribe to any conversation other than their own.
7. `yarn harness:verify` green on `main`.

## TODO items

- [ ] Decide and document the transport question (hand-rolled WS versus Centrifugo) before any implementation
- [ ] Add `type: 'chat'` inbox support and chat-specific `channelConfig`
- [ ] Build the embeddable widget bundle with style isolation and a script-tag embed snippet in inbox settings
- [ ] Implement visitor identity via `chat_token` `contactIdentity` with upgrade-to-email
- [ ] Implement presence, typing indicators, and per-inbox agent availability on Redis with TTL
- [ ] Implement visitor-scoped realtime authorization (own conversation only, verified by chat token)
- [ ] Implement offline fallback: collect email, convert to an email conversation
- [ ] Implement transcript email on chat close
- [ ] Add E2E coverage: visitor-to-agent exchange, typing indicator, offline fallback

## Risks

- **Visitor subscription authorization.** An unauthenticated visitor subscribing to the wrong channel
  leaks another customer's chat. The subscribe-time authorization from Stage 00 must be extended
  carefully, not bypassed for visitors.
- **Widget bundle size and CSS bleed.** It runs on customers' sites; it has to be small and it must not
  inherit or leak styles.
- **Scope creep.** Chat invites co-browsing, bots, and canned chat flows. Ship the channel first.
