# Stage 09 status event foundation

This slice makes historical status reporting reliable. Current conversation state cannot reconstruct
resolved or reopened history because reopening clears `resolvedAt`; future rollups need immutable,
structured status transitions.

## Task 1: Record durable conversation status events

1. Add `conversationStatusEvent` in `server/database/schema/support.ts` with text id, denormalized
   teamId and inboxId, conversationId, nullable fromStatus, toStatus, nullable actorUserId, occurredAt,
   and createdAt. Foreign keys cascade with their owners. Add time-leading indexes on
   `(teamId, occurredAt)` and `(conversationId, occurredAt)` and a status-transition check allowing
   only the supported conversation statuses. Keep the event append-only; there is no update API.
2. Generate and apply a migration with Drizzle. Never hand-edit generated migration files.
3. Extend the existing conversation status PATCH transaction so each actual status change inserts one
   event with the conversation's team/inbox and actor. No-op patches must not insert events, and the
   event must commit or roll back with the conversation update and activity message.
4. Add unit coverage for the event helper and no-op/change semantics. Add Postgres integration coverage
   proving ordering, tenant/inbox attribution, rollback atomicity, and indexes/constraint behavior.
5. Run focused tests and the full harness. Do not add rollup jobs or UI in this slice.

## Constraints

- Options API rules are unaffected; no UI changes.
- Use existing `diffConversationPatch` semantics so an explicit status change is the single source of truth.
- Preserve existing activity messages and realtime behavior.
- Do not infer historical transitions from activity message text.
