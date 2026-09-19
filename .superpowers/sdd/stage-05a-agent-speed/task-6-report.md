# SUP-05A-6 Report — Scoped Search

Branch: `agent/SUP-05A-6-search`

Base: `origin/support-platform` at `3943c07`

## Summary

- Added `search` to `GET /api/support/conversations`, scoped by `inboxId` and authorized via the existing `requireInboxAccess` boundary.
- Search matches conversation `subject`, contact `name`, contact `email`, and bare numeric `displayId` exactly.
- Non-empty search bypasses the fixed `view` filter so resolved or assigned tickets can be found from `Unassigned`; explicit legacy filters such as `status`, `assigneeUserId`, `contactId`, `tagId`, and `projectId` still apply.
- Search joins `contact` only and never queries `conversationMessage`.
- Added a compact conversation-list search box, debounced loading, `search` URL query hydration, clear-search behavior, and preservation of selected conversation deep links.
- Added focused unit and Playwright coverage for global search from `Unassigned`, contact search, exact ticket-number search, clear behavior, URL hydration, inbox scoping, and no message-table query access.

## Files Changed

- `server/api/support/conversations/index.get.ts`
- `components/support/SupportConversationList.vue`
- `pages/support/index.vue`
- `tests/conversation-read-state.test.ts`
- `tests/e2e/support-search.spec.ts`

## Validation

- `yarn test tests/conversation-read-state.test.ts` — passed, 3/3 tests.
- `yarn typecheck` — passed.
- `yarn lint` — passed with the existing repo warning set, 0 errors / 206 warnings.
- `PGHOST=localhost PGPORT=5432 PGUSER=veerify PGPASSWORD=veerifypassword PGDATABASE=veerify_sup_05a_6_search BETTER_AUTH_SECRET=... UPLOAD_TOKEN_SECRET=... PLAYWRIGHT_FORCE=1 PLAYWRIGHT_PORT=4998 yarn test:e2e tests/e2e/support-search.spec.ts` — passed, 1/1 Chromium test.
- `PGHOST=localhost PGPORT=5432 PGUSER=veerify PGPASSWORD=veerifypassword PGDATABASE=veerify_sup_05a_6_search BETTER_AUTH_SECRET=... UPLOAD_TOKEN_SECRET=... yarn test` — passed, 593/593 tests.
- `PGHOST=localhost PGPORT=5432 PGUSER=veerify PGPASSWORD=veerifypassword PGDATABASE=veerify_sup_05a_6_search BETTER_AUTH_SECRET=... UPLOAD_TOKEN_SECRET=... yarn test:e2e:if-available` — guard-skipped: `not running in cloud/CI and PLAYWRIGHT_FORCE is not set to 1`.

## Notes

- Created and seeded isolated local database `veerify_sup_05a_6_search` for focused Playwright validation.
- The first focused Playwright attempt without explicit secrets exited unsuccessfully while booting the dev server; the rerun with explicit test env passed.
- No schema changes were needed.
- `TODO.md` and the Stage 05A progress ledger were not edited by this worker.
