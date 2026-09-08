# SUP-05A-2 — Per-user conversation read state

Add per-user conversation read state with the handled-ness supersede rule, manual mark-unread, and
unread badges on `Unassigned` and `Assigned to me`.

## Binding behavior

- Persist one `lastReadAt` per `(conversationId, userId)`.
- An owned conversation with an outgoing reply is handled and must not render unread for agents other
  than its assignee.
- A new incoming customer message makes an owned conversation unread only for its assignee.
- A new incoming customer message makes an unassigned conversation unread for every agent.
- Opening/reading a conversation marks it read for the current agent.
- Agents can manually mark a conversation unread for themselves.
- Unread rows render with a visible unread treatment.
- Only the Unassigned and Assigned-to-me queue affordances receive unread badges.
- Preserve SUP-05A-1 ownership semantics and do not add deferred Stage 05 scope.

## Verification

- Generate the schema migration with `yarn db:generate`; never handwrite it.
- Use TDD, including real-Postgres behavior coverage.
- Add focused forced Playwright coverage for user-visible behavior.
- Run `yarn harness:verify` and report every guarded skip reason.
