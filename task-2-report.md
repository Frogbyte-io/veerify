## Review Fix: Missing locked conversation error

- Finding addressed: `server/utils/conversation-read-state.ts` threw a plain `Error` when the conversation row vanished between authorization and the `for update` lock.
- Test first: added `tests/conversation-read-state.test.ts` coverage for `setConversationReadStateInTransaction` returning a standardized 404 when the lock query returns no rows.
- RED evidence: `yarn vitest run tests/conversation-read-state.test.ts` failed with `expected Error: Conversation conversation-missing ... to match object { statusCode: 404, ... }`.
- Implementation: replaced the plain `Error` with `createError({ statusCode: 404, statusMessage: 'Not Found', data: createErrorResponse(ErrorCode.NOT_FOUND, 'Conversation not found') })`, preserving the existing transaction/row-lock sequence.
- GREEN/validation evidence:
  - `npx prettier --write server/utils/conversation-read-state.ts tests/conversation-read-state.test.ts` exited 0; both files unchanged by formatting.
  - `yarn vitest run tests/conversation-read-state.test.ts` exited 0; 1 file passed, 2 tests passed.
  - `yarn typecheck` exited 0.
  - `yarn lint` exited 0 with 206 pre-existing warnings and 0 errors.
- Harness evidence:
  - `yarn harness:verify` passed docs, typecheck, unit tests (`52 passed`, `585 passed`), lint (`0 errors`, `206 warnings`), skipped Playwright because the environment is not cloud/CI, `PLAYWRIGHT_FORCE` is unset, and database env is not configured, and passed Redis integration (`1 file passed`, `6 tests passed`).
  - `yarn harness:verify` failed at the guarded Postgres integration step because Postgres was reachable but not migrated: failures reported missing relations including `support_inbox`, `conversation`, `support_email_event`, `contact_link`, and `support_counter`.
