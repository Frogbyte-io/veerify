# SUP-05A-4 Report — Local Draft Persistence

## Status

Complete on branch `agent/SUP-05A-4-drafts`.

Commits:

- `8ae0c2fde09efe806d8d90a7c2b962e2b65bd226` — `feat(support): persist local conversation drafts`
- `716928cf0ea542d7210ad96de454226caab832d7` — `fix(support): clear submitted draft after stale send`

Base:

- Created sibling worktree `/home/dev/code/veerify-support-sup-05a-4` from latest `origin/support-platform`
  at `9960b587a0b04fb93022d69cd51c50d4c6fc4e5b`.

## Scope Delivered

- Added local client-side draft persistence in `SupportComposer.vue`.
- Drafts are keyed by `(conversationId, mode)` using browser storage keys:
  - `veerify:support:draft:<conversationId>:reply`
  - `veerify:support:draft:<conversationId>:note`
  - `veerify:support:draft:<conversationId>:mode` for the last restorable draft mode.
- Reply and internal-note drafts coexist for the same conversation.
- Selecting a conversation restores the mode associated with its saved draft.
- Switching composer modes swaps to that mode's saved draft instead of carrying text across reply/note.
- Successful send clears only the matching `(conversationId, mode)` draft.
- Conversation list rows show a visible amber `Draft` marker and expose `data-has-draft`.
- Parent `/support` page derives row indicators from browser storage and updates them immediately from composer events.

## Scope Deliberately Not Added

- No server-side draft table, API, sync, expiry, or undo-send.
- No changes to `components/ui`.
- No changes to fixed views, search, canned responses, attachments, or server message persistence.
- No TODO.md edits.
- No subagents spawned.

## TDD Evidence

Added `tests/e2e/support-drafts.spec.ts` before production changes.

RED:

- Command:
  `PGHOST=localhost PGPORT=5432 PGUSER=veerify PGPASSWORD=veerifypassword PGDATABASE=veerify_sup_05a_4 DATABASE_URL=postgres://veerify:veerifypassword@localhost:5432/veerify_sup_05a_4 REDIS_URL=redis://localhost:6379 BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef UPLOAD_TOKEN_SECRET=abcdef0123456789abcdef0123456789 BETTER_AUTH_URL=http://localhost:4388 BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:4388,http://127.0.0.1:4388 PLAYWRIGHT_BASE_URL=http://localhost:4388 PLAYWRIGHT_PORT=4388 PLAYWRIGHT_FORCE=1 yarn test:e2e --project=chromium tests/e2e/support-drafts.spec.ts`
- Result: failed as expected before implementation.
- Intended failure: row lacked `data-has-draft`; Playwright received no attribute for `support-conversation-<id>`.

GREEN:

- Same command after implementation and formatting.
- Result: `2 passed`.
- Covered:
  - reply and note drafts coexist;
  - navigating away/back restores the note draft and note mode when that was the last edited draft;
  - switching back to reply restores the reply draft;
  - sending a note clears only the note draft and leaves the reply draft plus row indicator;
  - sending the reply clears the final draft and removes the row indicator.

## Validation

Fresh DB setup:

- Existing shared local containers were already running:
  - `veerify-db` on `localhost:5432`
  - `veerify-valkey` on `localhost:6379`
- The shared `veerifydb` had a stale migration state, so I created a task-specific fresh database:
  - `veerify_sup_05a_4`
- Ran migrations and seed:
  - `yarn db:migrate` — migrations applied successfully.
  - `yarn db:seed:e2e` — created `test@preview.local`, `personal@preview.local`, Preview Org, Default team, projects/categories, and seed feedback.

Focused checks:

- `yarn prettier --write components/support/SupportComposer.vue components/support/SupportConversationList.vue pages/support/index.vue tests/e2e/support-drafts.spec.ts` — completed, touched files stable.
- `yarn typecheck` — passed.
- `yarn test` — 52 files passed, 585 tests passed.
- `yarn lint` — exit 0, 206 warnings, all pre-existing warning classes; no warning in touched files after the local file-input `prettier-ignore`.
- Forced focused Playwright:
  - `PLAYWRIGHT_FORCE=1 yarn test:e2e --project=chromium tests/e2e/support-drafts.spec.ts`
  - `2 passed`.

Full harness on fresh migrated DB with explicit env:

- Command:
  `PGHOST=localhost PGPORT=5432 PGUSER=veerify PGPASSWORD=veerifypassword PGDATABASE=veerify_sup_05a_4 DATABASE_URL=postgres://veerify:veerifypassword@localhost:5432/veerify_sup_05a_4 REDIS_URL=redis://localhost:6379 BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef UPLOAD_TOKEN_SECRET=abcdef0123456789abcdef0123456789 BETTER_AUTH_URL=http://localhost:4388 yarn harness:verify`
- Result: all validation gates passed.
- Harness details:
  - Agent docs map: passed.
  - Typecheck: passed.
  - Unit tests: 52 files passed, 585 tests passed.
  - Lint: exit 0 with 206 warnings.
  - E2E guarded: skipped.
  - Redis integration: 1 file passed, 6 tests passed.
  - Postgres integration: 13 files passed, 115 tests passed.

Exact guarded E2E skip:

```text
[playwright] Skipping e2e run: not running in cloud/CI and PLAYWRIGHT_FORCE is not set to 1.
[playwright] Runs require cloud/CI or PLAYWRIGHT_FORCE=1 and a reachable configured database.
```

Redis/Postgres guarded integrations did not skip because `REDIS_URL`, `DATABASE_URL`, and `PG*` were explicitly set and reachable.

## Review Fix Round 1

Addressed review finding:

- After a successful message POST, `SupportComposer.vue` now clears the captured `(submitConversationId, submitMode)` draft before the stale-current-conversation/generation guard.
- The UI reset and `posted` event remain guarded, so a late response from the previous conversation cannot mutate the currently selected conversation composer.
- Failed POST still retains the draft and row indicator.

TDD RED:

- Added regression coverage in `tests/e2e/support-drafts.spec.ts` before changing production code.
- Command:
  `PGHOST=localhost PGPORT=5432 PGUSER=veerify PGPASSWORD=veerifypassword PGDATABASE=veerify_sup_05a_4 DATABASE_URL=postgres://veerify:veerifypassword@localhost:5432/veerify_sup_05a_4 REDIS_URL=redis://localhost:6379 BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef UPLOAD_TOKEN_SECRET=abcdef0123456789abcdef0123456789 BETTER_AUTH_URL=http://localhost:4388 BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:4388,http://127.0.0.1:4388 PLAYWRIGHT_BASE_URL=http://localhost:4388 PLAYWRIGHT_PORT=4388 PLAYWRIGHT_FORCE=1 yarn test:e2e --project=chromium tests/e2e/support-drafts.spec.ts`
- Result: failed as expected before the fix.
- Failure: delayed successful send left the old submitted conversation row at `data-has-draft="true"` instead of clearing it.

TDD GREEN:

- Same focused draft command after the fix: `4 passed`.
- Regression coverage now proves:
  - delayed successful send clears the old submitted draft;
  - delayed successful send does not reset or overwrite the new selected conversation composer;
  - failed send retains the draft and row indicator.

Additional focused validation:

- `yarn prettier --write components/support/SupportComposer.vue tests/e2e/support-drafts.spec.ts` — completed.
- `yarn typecheck` — passed after fixing the test-only narrowing issue for the delayed POST release callback.
- Forced related support Playwright:
  - Command:
    `PGHOST=localhost PGPORT=5432 PGUSER=veerify PGPASSWORD=veerifypassword PGDATABASE=veerify_sup_05a_4 DATABASE_URL=postgres://veerify:veerifypassword@localhost:5432/veerify_sup_05a_4 REDIS_URL=redis://localhost:6379 BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef UPLOAD_TOKEN_SECRET=abcdef0123456789abcdef0123456789 BETTER_AUTH_URL=http://localhost:4388 BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:4388,http://127.0.0.1:4388 PLAYWRIGHT_BASE_URL=http://localhost:4388 PLAYWRIGHT_PORT=4388 PLAYWRIGHT_FORCE=1 yarn test:e2e --project=chromium tests/e2e/support-drafts.spec.ts tests/e2e/support-read-state.spec.ts tests/e2e/support-fixed-views.spec.ts tests/e2e/support-conversation-flow.spec.ts`
  - Result: `8 passed`.

Fresh DB full harness after review fix:

- Recreated `veerify_sup_05a_4`, ran `yarn db:migrate`, and ran `yarn db:seed:e2e`.
- Command:
  `PGHOST=localhost PGPORT=5432 PGUSER=veerify PGPASSWORD=veerifypassword PGDATABASE=veerify_sup_05a_4 DATABASE_URL=postgres://veerify:veerifypassword@localhost:5432/veerify_sup_05a_4 REDIS_URL=redis://localhost:6379 BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef UPLOAD_TOKEN_SECRET=abcdef0123456789abcdef0123456789 BETTER_AUTH_URL=http://localhost:4388 yarn harness:verify`
- Result: all validation gates passed.
- Harness details:
  - Agent docs map: passed.
  - Typecheck: passed.
  - Unit tests: 52 files passed, 585 tests passed.
  - Lint: exit 0 with 206 warnings.
  - E2E guarded: skipped.
  - Redis integration: 1 file passed, 6 tests passed.
  - Postgres integration: 13 files passed, 115 tests passed.

Exact guarded E2E skip:

```text
[playwright] Skipping e2e run: not running in cloud/CI and PLAYWRIGHT_FORCE is not set to 1.
[playwright] Runs require cloud/CI or PLAYWRIGHT_FORCE=1 and a reachable configured database.
```

Redis/Postgres guarded integrations did not skip in the review-fix harness because `REDIS_URL`, `DATABASE_URL`, and `PG*` were explicitly set and reachable.

## Notes / Concerns

- The broad harness E2E gate was intentionally left unforced so the harness reported the normal local guard skip; SUP-05A-4 UI behavior was covered by the forced focused Playwright spec.
- The repo has a Prettier/Vue-lint disagreement around HTML void-element self-closing. `SupportComposer.vue` already had an `<input>` in the affected area; I added `<!-- prettier-ignore -->` around that existing file input so formatting does not introduce a local lint warning.
- Browser storage access is best-effort and guarded with `import.meta.client` plus `try/catch`; if storage is unavailable, drafts do not crash the support UI and row indicators simply do not persist.
