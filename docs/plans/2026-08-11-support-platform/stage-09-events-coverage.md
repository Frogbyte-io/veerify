# Stage 09 status event coverage

Status: **COMPLETE** (commit `02d5553`; Luna review passed; full harness pending)

The initial status-event slice covered the authenticated conversation PATCH route. This follow-up
closes the remaining write paths before reporting rollups consume the event table.

## Task 1: Record all status transitions

1. Record the inbound reopen transition (`resolved` or `pending` → `open`) in the same transaction as
   the conversation update and existing activity message. Inbound processing has no authenticated
   actor, so store `actorUserId: null`. Do not record initial conversation creation as a transition.
2. Make automation `set_status` use the same transition semantics as PATCH, including no-op suppression,
   `resolvedAt` updates, activity text, and a durable status event. Keep the conversation update,
   activity, and event atomic; preserve automation's existing failure/audit behavior.
3. Change status-event actor deletion to `SET NULL` so deleting an agent preserves historical facts.
4. Add unit/integration coverage for inbound reopen, automation status changes and no-ops, rollback,
   denormalized ownership/actor attribution, and actor deletion.
5. Run focused tests, typecheck, and the full harness. Do not implement rollups or reporting UI here.

## Constraints

- Reuse a shared transactional helper or equivalent single implementation; do not duplicate
  `resolvedAt` or no-op semantics in each caller.
- Preserve existing inbound threading, automation cascade, activity, and realtime behavior.
- Initial inbound conversation creation is not a reopen event.
- No UI changes in this slice.
