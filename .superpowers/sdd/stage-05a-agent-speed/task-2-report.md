# SUP-05A-2 report — per-user conversation read state

## TODO item

> **SUP-05A-2** Add per-user conversation read state with the handled-ness supersede rule, manual mark-unread, and unread badges on `Unassigned` and `Assigned to me`

Branch: `agent/SUP-05A-2-read-state`

Commit: `b411689ecf21f17be1bc0877381ebff22376e5c0` (`feat(support): add per-agent conversation read state`)

Base/integration target: `support-platform` at `1a70cb538ad8964b9c2b3184af0fd5e5dbe01f51`. `TODO.md` was not edited and the integration checkout branch was not switched.

## Outcome and scope audit

- Added `conversation_read_state`, keyed by `(user_id, conversation_id)`, with one `last_read_at` cursor per agent and conversation.
- Opening a conversation upserts the current agent's read cursor. Manual **Mark unread** removes only that agent's cursor.
- A conversation is unread when its latest customer signal (`lastCustomerReplyAt`, falling back to `createdAt`) is newer than the viewer's cursor.
- Handled-ness supersedes that cursor comparison: when a conversation has an owner and an outgoing reply (`lastAgentReplyAt`), every non-assignee sees it as read. The assignee still receives unread state from later customer replies.
- Existing inbound replies invalidate every cursor while unassigned, or only the assignee's cursor once owned. A newly created inbound conversation has no cursors and is therefore unread for everyone naturally.
- The list and detail APIs return viewer-specific `lastReadAt` and `isUnread`. The list API additionally returns only the two required badge counts: `unassigned` and `assignedToMe`.
- The UI renders unread rows with stronger type and a subtle row background, shows badges only for **Unassigned** and **Assigned to me**, marks a selected conversation read, and exposes a manual **Mark unread** action.
- Added the protected read-state route to the executable authorization inventory and hand-maintained OpenAPI document, consistent with delta D-23.
- Preserved SUP-05A-1 semantics: this work does not alter claim, auto-claim, note exclusion, handoff, unassign, or reopen behavior. It consumes `assigneeUserId` and `lastAgentReplyAt` as the ownership/handled signals.
- Did not implement the full four-view navigation, saved views, snooze behavior, macros, search, drafts, shortcuts, presence, or any other deferred Stage 05 scope.

## Changed files

- `components/support/SupportConversationList.vue` — two badge contracts and viewer-specific unread row styling.
- `components/support/SupportConversationThread.vue` — manual **Mark unread** action.
- `pages/support/index.vue` — read-on-open, manual unread orchestration, count refresh/reset.
- `server/api/openapi.json.get.ts` — viewer read fields, count response, and read-state route.
- `server/api/support/conversations/[id].get.ts` — viewer-specific detail read state.
- `server/api/support/conversations/[id]/read-state.put.ts` — authenticated, inbox-authorized read/unread mutation.
- `server/api/support/conversations/index.get.ts` — viewer cursor join, handled-ness derivation, two unread counts.
- `server/api/support/inbound/[provider].post.ts` — cursor invalidation at the inbound queue boundary.
- `server/database/schema/support.ts` — `conversationReadState` schema.
- `server/database/migrations/0030_flimsy_grim_reaper.sql` — generated table and constraints.
- `server/database/migrations/meta/0030_snapshot.json` — generated Drizzle snapshot.
- `server/database/migrations/meta/_journal.json` — generated migration journal entry.
- `server/utils/conversation-read-state.ts` — unread derivation, cursor mutation, inbound invalidation.
- `tests/conversation-read-state.test.ts` — list contract and handled-ness unit coverage.
- `tests/integration/conversation-read-state.test.ts` — real-Postgres per-user, manual, handled, and incoming-scope coverage.
- `tests/e2e/support-read-state.spec.ts` — visible read/unread styling, read-on-open, manual unread, and both badge labels.
- `tests/support-route-authorization.test.ts` — read-state endpoint authorization inventory.

## TDD evidence

The recovery began from substantial uncommitted work. No `task-2-report.md` existed, and ordinary shell history contained no SUP-05A-2 transcript. The prior Codex session log was available at `/home/dev/.codex/sessions/2026/09/07/rollout-2026-09-07T21-15-42-01a07dba-1676-72f0-b657-324f1d6bc8a4.jsonl`; it contains the following exact red/green cycles.

### Viewer-specific list state and counts

- RED: `yarn vitest run tests/conversation-read-state.test.ts`
  - 1/1 failed at `tests/conversation-read-state.test.ts:102`.
  - The response lacked every expected `isUnread` field and lacked `unreadCounts`.
- GREEN: the same command after the list projection/derivation/count implementation.
  - 1 file passed, 1/1 test passed.

### Persistent per-user cursor and manual unread

- RED: `PGDATABASE=veerify_sup_05a_2 yarn test:integration tests/integration/conversation-read-state.test.ts`
  - 1 passed, 2 failed out of 3.
  - Both failures expected `setConversationReadState` to be a function and received `undefined`; the already-written pure handled-ness case passed.
- GREEN: the same real-Postgres command after the cursor mutation implementation.
  - 1 file passed, 3/3 tests passed.

### Incoming queue-boundary invalidation

- RED: the fourth test was added and the same focused Postgres command rerun.
  - 3 passed, 1 failed; `reMarkConversationUnreadForIncoming` was `undefined`.
- GREEN: after adding the helper and wiring it into the existing-thread inbound transaction.
  - 1 file passed, 4/4 tests passed.

### Browser regression proof

The prior worker had GREEN browser evidence but added the spec and UI in one patch, so no original browser RED was claimed. During recovery, a controlled mutation temporarily removed the row's `data-unread` signal and ran:

`PLAYWRIGHT_FORCE=1 DATABASE_URL=postgresql://veerify:veerifypassword@localhost:5432/veerify_sup05a2_recovery_20260908 UPLOAD_TOKEN_SECRET=playwright-upload-secret-0123456789abcdef BETTER_AUTH_SECRET=playwright-auth-secret-0123456789abcdef yarn playwright test tests/e2e/support-read-state.spec.ts --workers=1`

- RED: 1/1 failed at the first unread-row assertion. Expected `data-unread="true"`; the attribute was absent. This proves the spec catches loss of the visible unread contract.
- The committed implementation was restored with an inverse patch; `git status --short` and `git diff --check` were clean.
- GREEN: the exact same command then passed 1/1 in 24.1 seconds.

No regression mutation remains in the branch.

## Migration generation, fresh application, and inspection

- The prior worker generated migration `0030_flimsy_grim_reaper.sql` with `yarn db:generate`; it was not hand-written.
- Recovery reran `yarn db:generate`: Drizzle reported `No schema changes, nothing to migrate`, confirming schema and generated metadata are synchronized.
- The worktree compose start encountered a safe environment collision because `veerify-db` and `veerify-valkey` are globally named and already owned by another checkout. Those healthy existing containers were reused; none were removed or reconfigured.
- Created the fresh isolated database `veerify_sup05a2_recovery_20260908` and ran all migrations with:

  `DATABASE_URL=postgresql://veerify:veerifypassword@localhost:5432/veerify_sup05a2_recovery_20260908 yarn db:migrate`

  Result: migrations applied successfully.

- Inspected `\d+ conversation_read_state`, `pg_constraint`, and `pg_indexes` in that database:
  - `conversation_id text NOT NULL`
  - `user_id text NOT NULL`
  - `last_read_at timestamp without time zone NOT NULL`
  - primary key: `(user_id, conversation_id)`
  - `conversation_id` foreign key to `conversation(id)` with `ON DELETE CASCADE`
  - `user_id` foreign key to `user(id)` with `ON DELETE CASCADE`
- SQL review: migration 0030 only creates this table, its composite primary key, and those two foreign keys. It contains no unrelated `DROP`, data rewrite, or alteration of an existing table.
- Seeded the isolated database with `DATABASE_URL=... yarn db:seed` for authenticated browser coverage.

## Commands and final results

### Focused checks

- `yarn vitest run tests/conversation-read-state.test.ts tests/support-route-authorization.test.ts`
  - 2 files passed, 27/27 tests passed.
- `DATABASE_URL=... yarn vitest run -c vitest.integration.config.ts tests/integration/conversation-read-state.test.ts`
  - 1 file passed, 4/4 tests passed against the fresh database.
- Focused forced Chromium command shown above.
  - Final result: 1/1 passed in 24.1 seconds after the controlled RED mutation was restored.
- `yarn typecheck`
  - Passed.
- `yarn db:generate`
  - Passed; no schema drift and nothing new to generate.
- `git diff --check`
  - Passed before commit and after the browser mutation was restored.

### Formatting

- Ran `yarn prettier --write` over every changed non-generated source, API, Vue, and test file.
  - All reported unchanged.
- `server/database/migrations/**` is intentionally ignored by the repository's `.prettierignore`; generated SQL and metadata were preserved exactly as emitted by Drizzle and validated by the no-drift generation check.

### Full harness

Command:

`DATABASE_URL=postgresql://veerify:veerifypassword@localhost:5432/veerify_sup05a2_recovery_20260908 REDIS_URL=redis://localhost:6379 UPLOAD_TOKEN_SECRET=harness-upload-secret-0123456789abcdef BETTER_AUTH_SECRET=harness-auth-secret-0123456789abcdef yarn harness:verify`

Result: exit 0; all validation gates passed in 60.77 seconds.

- Agent docs map: passed.
- Typecheck: passed.
- Unit: 52 files, 584/584 tests passed.
- Lint: passed with 0 errors and 206 repository warnings. This matches the pre-existing warning count documented by SUP-05A-1; no warning cleanup was folded into this item.
- E2E guard: intentionally skipped because the environment was local and this full-harness command did not set `PLAYWRIGHT_FORCE=1`. Exact message: `not running in cloud/CI and PLAYWRIGHT_FORCE is not set to 1`. The required focused browser workflow was forced and passed separately.
- Redis integration: 1 file, 6/6 tests passed.
- Postgres integration: 13 files, 110/110 tests passed against the fresh database, including the 4 new read-state tests and the real two-process Redis reconnect test. No integration test skipped because `REDIS_URL` was explicit.

## Warnings and non-feature artifacts

- Expected test logs include Better Auth's missing optional GitHub credentials, deliberate failure-path warnings/errors in rate-limit and inbound-attachment tests, `NO_COLOR`/`FORCE_COLOR`, and stale Browserslist data. None caused a failed gate.
- The prior worker twice started a full harness with `PLAYWRIGHT_FORCE=1`, which runs the entire 104-test browser suite rather than the requested focused workflow. The preserved `test-results/.last-run.json` recorded unrelated broad-suite failures before that session hit its usage limit. Those artifacts were not treated as feature validation; the scoped forced spec and the normal full harness were run cleanly during recovery.
- The test database is isolated from the default development database and was left available for integration review/reproduction.

## Assumptions

- `lastAgentReplyAt` is the existing durable definition of “has an outgoing reply”; SUP-05A-1 already ensures outgoing replies update it while notes do not.
- Handled-ness truly supersedes manual cursor state for non-assignees. Therefore a non-assignee cannot force another agent's owned-and-replied conversation back into their unread queue by deleting their own cursor.
- Deleting the viewer's row is the manual unread representation so `lastReadAt` remains the sole persisted state; no second boolean source of truth was introduced.
- Badge counts are inbox-wide queue contracts for only `assigneeUserId IS NULL` and `assigneeUserId = current user`. SUP-05A-3 owns fixed-view navigation and final placement/filter controls.
- A new inbound conversation requires no explicit cursor deletion because no read-state rows exist yet; it naturally appears unread to all authorized agents.

## Fix round 1 — review hardening

Commit: `c9b5f18b601da46cbbf0fd7aaf52ad9c029fc442` (`fix(support): harden conversation read state races`)

Review fixes completed:

- Changed unread suppression so any owned conversation is unread only for its assignee after incoming, including before the owner's first outgoing reply. Non-owners now see owned conversations as read because ownership, not `lastAgentReplyAt`, controls queue membership.
- Serialized read-state mutation through a `conversation` row lock and passed the customer signal observed by the read-state API into the cursor helper, so a read that began before inbound cannot advance its cursor past the customer message it actually saw.
- Made read cursors monotonic with `greatest(conversation_read_state.last_read_at, excluded.last_read_at)` and set read cursors to the observed customer signal rather than wall-clock time, which keeps future provider timestamps safe and prevents cursor regression.
- Locked existing inbound conversations before applying inbound updates and read-state invalidation.
- Hid the manual Mark unread action for conversations owned by another agent and replaced it with explanatory disabled copy.
- Added `conversation_read_state_conversation_idx` via `server/database/schema/support.ts` and regenerated Drizzle migration `0031_productive_kang.sql` plus `0031_snapshot.json` with `yarn db:generate`.

### Fix round 1 red/green evidence

- RED, owned-before-first-reply: temporarily changed `isConversationUnread` back to requiring `lastAgentReplyAt` for non-owner suppression, then ran:

  `DATABASE_URL=postgresql://veerify:veerifypassword@localhost:5432/veerify_sup05a2_finish_20260908 yarn vitest run -c vitest.integration.config.ts tests/integration/conversation-read-state.test.ts -t "owned conversation unread only for its assignee"`

  Result: failed 1/9, with agent B receiving `true` where the expected unread state was `false`.

- GREEN, owned-before-first-reply: restored owner-based suppression and reran the full focused Postgres suite:

  `DATABASE_URL=postgresql://veerify:veerifypassword@localhost:5432/veerify_sup05a2_finish_20260908 yarn vitest run -c vitest.integration.config.ts tests/integration/conversation-read-state.test.ts`

  Result: 1 file passed, 9/9 tests passed.

- RED, observed customer signal: temporarily ignored `observedCustomerSignalAt` in the cursor helper, then ran:

  `DATABASE_URL=postgresql://veerify:veerifypassword@localhost:5432/veerify_sup05a2_finish_20260908 yarn vitest run -c vitest.integration.config.ts tests/integration/conversation-read-state.test.ts -t "does not advance a read cursor past"`

  Result: failed 1/9, advancing `lastReadAt` to `2026-09-07T11:00:00.000Z` instead of preserving the pre-inbound observed signal `2026-09-07T09:00:00.000Z`.

- RED, monotonic future cursor: temporarily replaced `greatest(...)` with a direct `excluded.last_read_at` assignment, then ran:

  `DATABASE_URL=postgresql://veerify:veerifypassword@localhost:5432/veerify_sup05a2_finish_20260908 yarn vitest run -c vitest.integration.config.ts tests/integration/conversation-read-state.test.ts -t "future-dated customer signal"`

  Result: failed 1/9, regressing the cursor from `2040-01-01T12:00:00.000Z` to `2040-01-01T11:00:00.000Z`.

- GREEN, focused unit/API:

  `yarn vitest run tests/conversation-read-state.test.ts tests/support-route-authorization.test.ts`

  Result: 2 files passed, 27/27 tests passed.

- GREEN, focused forced Chromium:

  `PLAYWRIGHT_FORCE=1 PLAYWRIGHT_PORT=4799 DATABASE_URL=postgresql://veerify:veerifypassword@localhost:5432/veerify_sup05a2_finish_20260908 UPLOAD_TOKEN_SECRET=playwright-upload-secret-0123456789abcdef BETTER_AUTH_SECRET=playwright-auth-secret-0123456789abcdef yarn playwright test tests/e2e/support-read-state.spec.ts --workers=1`

  Result: 2/2 tests passed in 28.1 seconds. An initial attempt failed because a stale Nuxt dev server was already listening on port `4799` and served a bad dynamic module; stopped only those explicit dev-server PIDs and reran fresh.

### Fix round 1 migration and DB evidence

- `DATABASE_URL=postgresql://veerify:veerifypassword@localhost:5432/veerify_sup05a2_finish_20260908 yarn db:migrate`
  - Result: migrations applied successfully on a fresh isolated database, including `0031`.
- `yarn db:generate`
  - Result: Drizzle reported `No schema changes, nothing to migrate`.
- Migration `0031_productive_kang.sql` contains exactly:

  `CREATE INDEX "conversation_read_state_conversation_idx" ON "conversation_read_state" USING btree ("conversation_id");`

- Fresh DB index inspection:
  - `conversation_read_state_conversation_idx` on `(conversation_id)`.
  - Existing primary key index `conversation_read_state_user_id_conversation_id_pk` on `(user_id, conversation_id)`.
- Fresh DB constraints inspection:
  - primary key `(user_id, conversation_id)`.
  - `conversation_id` FK to `conversation(id)` with `ON DELETE CASCADE`.
  - `user_id` FK to `user(id)` with `ON DELETE CASCADE`.

### Fix round 1 final validation

- `yarn prettier --write components/support/SupportConversationThread.vue server/api/support/conversations/[id]/read-state.put.ts server/api/support/inbound/[provider].post.ts server/database/schema/support.ts server/utils/conversation-read-state.ts tests/e2e/support-read-state.spec.ts tests/integration/conversation-read-state.test.ts`
  - Result: all unchanged.
- `git diff --check`
  - Result: passed.
- Full harness command:

  `DATABASE_URL=postgresql://veerify:veerifypassword@localhost:5432/veerify_sup05a2_finish_20260908 REDIS_URL=redis://localhost:6379 UPLOAD_TOKEN_SECRET=harness-upload-secret-0123456789abcdef BETTER_AUTH_SECRET=harness-auth-secret-0123456789abcdef yarn harness:verify`

  Result: exit 0 in 60.42 seconds.
  - Agent docs map: passed.
  - Typecheck: passed.
  - Unit: 52 files, 584/584 tests passed.
  - Lint: passed with 0 errors and 206 repository warnings.
  - E2E guard: skipped because this local full-harness command did not set `PLAYWRIGHT_FORCE=1`; exact guard reason was `not running in cloud/CI and PLAYWRIGHT_FORCE is not set to 1`.
  - Redis integration: 1 file, 6/6 tests passed.
  - Postgres integration: 13 files, 115/115 tests passed against the fresh isolated database.

## Final state

- Worktree: `/home/dev/code/veerify-support-sup-05a-2`
- Branch: `agent/SUP-05A-2-read-state`
- Commits: `b411689ecf21f17be1bc0877381ebff22376e5c0`, `c9b5f18b601da46cbbf0fd7aaf52ad9c029fc442`
- Worktree status after commit and regression restore: clean.
- Branch pushed to `origin/agent/SUP-05A-2-read-state`.
- Concerns: none. The only harness skip is the documented local broad-Playwright guard; focused forced Chromium coverage passed.
