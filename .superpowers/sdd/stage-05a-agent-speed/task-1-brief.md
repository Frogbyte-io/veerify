# SUP-05A-1 — Claim and assignment

Implement claim, auto-claim on first `outgoing` reply (notes excluded), unassign, and
assign-to-another-agent, each writing an `activity` message; reopen preserves assignee.

## Binding behavior

- Add a Claim button in the conversation header.
- Auto-claim an unassigned conversation to the replying agent on the first outgoing reply.
- Internal notes never claim.
- A reply must not steal a conversation already assigned to another agent.
- Support release back to the unassigned pool and handoff to another agent through a plain dropdown.
- Explicit claim, release, and handoff each write exactly one activity message through the existing
  conversation activity path.
- A customer reply that reopens a resolved conversation preserves its assignee.
- Do not add round-robin, availability, presence, snooze, macros, or other deferred Stage 05 scope.

## Verification

- Follow TDD with focused unit/integration coverage.
- Update affected Playwright workflow coverage for the user-facing controls.
- Run `yarn harness:verify` and report every guarded skip reason.
