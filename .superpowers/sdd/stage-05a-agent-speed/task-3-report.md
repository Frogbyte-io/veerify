# SUP-05A-3 Report

## Status

Implemented in isolated worktree `/home/dev/code/veerify-support-sup-05a-3` on branch
`agent/SUP-05A-3-fixed-views`.

Base: `origin/support-platform` at `2fee359ad963b374949b92f8e4abf8a2e64ff10b`.

Commit: `f8ea7c1f4e9705dd9fafc05c363890b6aa3a8e5f`.

## Scope Delivered

- Replaced `/support` sidebar status/assignee/tag filters with the four fixed views:
  `Unassigned`, `Assigned to me`, `Resolved`, `All`.
- Made `Unassigned` the default landing view. The default URL omits `view`; non-default views write
  `?view=assigned-to-me`, `?view=resolved`, or `?view=all`.
- Kept view state scoped to the selected inbox. Initial deep links respect `inboxId` and `view`; selecting
  another inbox resets to `Unassigned`.
- Added a narrow `view` query parameter to `GET /api/support/conversations` while preserving the existing
  `status`, `assigneeUserId`, `contactId`, `tagId`, and `projectId` filters for existing callers.
- Preserved read-state badges for `Unassigned` and `Assigned to me` only, now counted against active
  `open`/`pending` queue membership.
- Kept the existing supervisor tag-creation affordance, but removed tag filtering from the support inbox
  navigation model.

## TDD

- RED: Added `tests/e2e/support-fixed-views.spec.ts`; first behavior run failed because
  `support-view-unassigned` did not exist.
- GREEN: Implemented fixed views and list filtering; focused fixed-view spec passed.
- Regression adjustment: Updated the read-state E2E case that intentionally inspects another agent's
  handled conversation to deep-link to `view=all`.

## Validation

Environment used:

- `PGHOST=localhost`
- `PGPORT=5432`
- `PGUSER=veerify`
- `PGDATABASE=veerify_sup_05a_3`
- `DATABASE_URL=postgres://veerify:veerifypassword@localhost:5432/veerify_sup_05a_3`
- `REDIS_URL=redis://localhost:6379/13`
- `BETTER_AUTH_SECRET=sup-05a-3-secret-000000000000000000000`
- `UPLOAD_TOKEN_SECRET=sup-05a-3-upload-token-secret-000000000000000000`
- `PLAYWRIGHT_PORT=4787`

Fresh DB setup before final harness:

- Dropped and recreated `veerify_sup_05a_3`.
- Flushed Redis logical DB 13 only.
- Ran `yarn db:migrate`.
- Ran `yarn db:seed:e2e`.

Commands run:

- `npx prettier --write pages/support/index.vue components/support/SupportInboxSidebar.vue components/support/SupportConversationList.vue server/api/support/conversations/index.get.ts tests/e2e/support-fixed-views.spec.ts tests/e2e/support-read-state.spec.ts`
- `yarn typecheck` — passed.
- `yarn test` — 52 files, 585 tests passed.
- `yarn lint` — exited 0 with 206 existing warnings.
- Focused forced Playwright:
  `yarn test:e2e tests/e2e/support-fixed-views.spec.ts tests/e2e/support-read-state.spec.ts tests/e2e/support-permissions.spec.ts --grep "fixed views|read state|supervisor manages tags" --project=chromium` — 4 passed.
- Full guarded harness:
  `yarn harness:verify` — passed all gates.

Full harness details:

- Agent docs map passed.
- Typecheck passed.
- Unit tests passed: 585/585.
- Lint passed with warnings only.
- E2E guarded step skipped because local run did not set `PLAYWRIGHT_FORCE=1`.
- Redis integration passed: 6/6 against `redis://localhost:6379/13`.
- Postgres integration passed: 13 files, 115/115 against `veerify_sup_05a_3`.

## Fix Round 1

Review findings addressed on the same branch:

- Replaced the stale `tests/e2e/support-permissions.spec.ts` workflow that expected `/support` reload to
  fetch `/api/support/tags`. The updated coverage now exercises the supported supervisor tag-creation
  flow: POST `/api/support/tags` receives 403, the page runs inbox recovery, and
  `support-inbox-access-error` is rendered without relying on removed tag-list navigation.
- Kept the existing supervisor tag-creation affordance covered by the permissions suite.
- Added fixed-view second-inbox coverage proving that switching inboxes resets the active view to
  `Unassigned`, removes the `view` URL query parameter, and loads the second inbox's unassigned
  conversation.
- Updated the served static OpenAPI spec in `server/api/openapi.json.get.ts` to document the
  `/api/support/conversations` `view` query parameter with enum values
  `unassigned`, `assigned-to-me`, `resolved`, and `all`.
- Added an API-docs E2E assertion for that static `view` query parameter to prevent future drift from
  the handler JSDoc.

Fix-round TDD:

- RED: Added the API-docs assertion and ran
  `yarn test:e2e tests/e2e/api-docs.spec.ts --project=chromium`; it failed because the served
  `/api/openapi.json` parameters for `/api/support/conversations` did not include `view`.
- GREEN: Added the static OpenAPI `view` parameter, then reran focused forced Playwright:
  `yarn test:e2e tests/e2e/api-docs.spec.ts tests/e2e/support-fixed-views.spec.ts tests/e2e/support-permissions.spec.ts --grep "API docs|fixed views|tag creation 403|supervisor manages tags" --project=chromium`
  — 4 passed.

Fix-round validation:

- Formatting:
  `yarn prettier --write tests/e2e/support-permissions.spec.ts tests/e2e/support-fixed-views.spec.ts tests/e2e/api-docs.spec.ts server/api/openapi.json.get.ts`
  — passed.
- Fresh DB setup:
  dropped and recreated `veerify_sup_05a_3`, flushed Redis logical DB 13, and ran `yarn db:seed`
  (which runs migrations then seeds the standard e2e users).
- Focused forced Playwright:
  `yarn test:e2e tests/e2e/api-docs.spec.ts tests/e2e/support-fixed-views.spec.ts tests/e2e/support-permissions.spec.ts --grep "API docs|fixed views|tag creation 403|supervisor manages tags" --project=chromium`
  — 4 passed.
- Full guarded harness:
  `yarn harness:verify` — passed all gates:
  docs map passed; typecheck passed; unit tests 52 files / 585 tests passed; lint exited 0 with
  206 warnings; guarded E2E skipped because this local run did not set `PLAYWRIGHT_FORCE=1`; Redis
  integration 6/6 passed against `redis://localhost:6379/13`; Postgres integration 13 files / 115
  tests passed against `veerify_sup_05a_3`.

## Warnings / Concerns

- A full forced all-E2E run (`PLAYWRIGHT_FORCE=1 yarn harness:verify`) failed in unrelated legacy
  public/settings specs. The support fixed-view, read-state, support conversation flow, and restored
  supervisor tag-control checks passed during that run. I did not change those unrelated suites.
- Playwright web-server logs intermittently reported `EPIPE`/`ECONNRESET` after passing support-focused
  assertions. These did not cause focused support E2E failures.
- Lint still reports the existing repository-wide warning set; this task added no lint errors.
