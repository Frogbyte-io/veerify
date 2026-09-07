# SUP-05A-1 implementation report

## TODO text

`SUP-05A-1 Implement claim, auto-claim on first outgoing reply (notes excluded), unassign, and assign-to-another-agent, each writing an activity message; reopen preserves assignee`

## Status and branch

- Status: DONE
- Branch: `agent/SUP-05A-1-claim-assignment`
- Base: `origin/support-platform` at `56484fe65f87838497ae97fa50f5b6763e9dc777`
- Commit: `20df161292b5bbc12da23ebcd5a7e68f5ae5c837` — `feat(support): add conversation claim assignment`
- Remote: `origin/agent/SUP-05A-1-claim-assignment` points to the same commit.

## Implementation

- Added an explicit Claim action for unassigned conversations. It assigns the authenticated user through the existing conversation PATCH route.
- Kept the existing assignee selector as the handoff and unassign control, including a `You` fallback for authenticated team administrators who are not listed as inbox members.
- Auto-claims an unassigned conversation in the same database transaction as the first outgoing reply and its outbox record. The database-level `assignee_user_id IS NULL` condition makes concurrent claims single-winner; only the winner writes one assignment activity.
- Internal notes do not auto-claim, and an outgoing reply never steals a conversation already assigned to another agent.
- Refreshes conversation detail, messages, and list after a post so an auto-claim is immediately visible.
- Reopens a resolved conversation on a strongly threaded inbound reply, records the single status activity, and deliberately omits `assigneeUserId` from the update so ownership is preserved.
- Reused the settled PATCH/activity implementation for direct claim, unassign, and handoff; no schema change or deferred Stage 05A feature was added.

## Changed files

- `components/support/SupportConversationThread.vue`
- `pages/support/index.vue`
- `server/api/support/conversations/[id]/messages/index.post.ts`
- `server/api/support/inbound/[provider].post.ts`
- `server/utils/conversation-activity.ts`
- `server/utils/inbound-threading.ts`
- `server/utils/support-attachment-finalization.ts`
- `tests/conversation-activity.test.ts`
- `tests/e2e/support-conversation-flow.spec.ts`
- `tests/e2e/support-permissions.spec.ts`
- `tests/inbound-threading.test.ts`
- `tests/integration/conversation-assignment.test.ts`

`TODO.md` was not modified. No database schema or generated migration changed.

## Red/green TDD evidence

### Assignment transaction

- RED: `DATABASE_URL=postgresql://veerify:veerifypassword@localhost:5432/veerify_stage05a_baseline yarn test:integration tests/integration/conversation-assignment.test.ts`
  - Result: 2 failed / 2 passed. The outgoing reply left `assigneeUserId` null, including in the concurrent-reply case.
- GREEN: the same focused real-Postgres suite after implementing the conditional transactional claim.
  - Result: 4/4 passed, covering outgoing auto-claim and exact activity, note exclusion, no stealing, and a concurrent single-claim race.
- Final combined Postgres focus: `DATABASE_URL=postgresql://veerify:veerifypassword@localhost:5432/veerify_sup05a1_e2e yarn test:integration tests/integration/conversation-assignment.test.ts tests/integration/support-attachment-finalization.test.ts`
  - Result: 14/14 passed.

### Reopen ownership

- RED: `yarn vitest run tests/inbound-threading.test.ts`
  - Result: 1 failed / 13 passed because `updatesForInboundReply` did not exist.
- GREEN: `yarn vitest run tests/inbound-threading.test.ts tests/conversation-activity.test.ts`
  - Result: 33/33 passed; a resolved inbound thread reopens without an assignee update, and generic reopen retains the same invariant.

### Claim UI

- The first browser attempts exposed environment setup issues before reaching the assertion: a missing `UPLOAD_TOKEN_SECRET`, then Nuxt/Vite rejecting a symlinked external `node_modules`. The worktree received local hard-linked dependencies and the required test secrets; neither setup change is tracked.
- The initial role-based button selector matched unrelated row text. It was replaced with the exact `support-thread-claim` test ID before recording UI red/green evidence.
- RED: with the Claim block temporarily removed, the targeted Playwright test failed waiting for `getByTestId('support-thread-claim')`.
- GREEN: after restoring the implemented block, the same target passed 1/1. It verifies the visible Claim action, its PATCH to the authenticated user, the owner selection update, and the button disappearing.
- Final affected browser command against isolated migrated database `veerify_sup05a1_e2e`, serial workers:
  - `PLAYWRIGHT_FORCE=1 DATABASE_URL=postgresql://veerify:veerifypassword@localhost:5432/veerify_sup05a1_e2e yarn playwright test tests/e2e/support-permissions.spec.ts --grep "claims an unassigned conversation" tests/e2e/support-conversation-flow.spec.ts --workers=1`
  - Result: 2/2 passed in 10.0s.
- The live conversation-flow test also proves: note leaves the ticket unassigned; outgoing reply auto-claims; handoff, unassign, and reclaim each emit the expected one activity; resolving and reopening preserve the owner; a no-op does not append activity.

## Commands and results

### Required context and isolated setup

- Read `AGENTS.md`, `CLAUDE.md`, `.agents/CLAUDE.md`, `docs/plans/2026-08-11-support-platform/stage-05-decisions.md`, `stage-05a-agent-speed.md`, relevant support sections in `design.md`, `deltas.md`, and the SUP-05A-1 entry in `TODO.md`.
- Read the worktree, TDD, and completion-verification skill instructions.
- `yarn harness:context` in the integration checkout: completed; `support-platform` was clean at `56484fe`.
- `git fetch origin`: completed.
- `git worktree add -b agent/SUP-05A-1-claim-assignment /home/dev/code/veerify-support-sup-05a-1 origin/support-platform`: completed from the required remote base.
- `yarn install`: reported current but did not materialize a usable local dependency tree in the worktree. A temporary symlink was rejected by Vite, so it was removed and dependencies were hard-linked locally with `cp -al`; `yarn nuxt prepare` then completed. These are ignored environment files only.
- Baseline `yarn test`: 51 files / 582 tests passed.
- Created isolated database `veerify_sup05a1_e2e`, then ran project migrations and seed successfully for browser and final Postgres verification. The default local database was not used because its support tables were stale/unmigrated; this matches the controller's baseline note.

### Formatting and focused checks

- Ran Prettier on every changed file, and reran it on the final three touched files: passed.
- `git diff --check`: passed.
- `yarn typecheck`: passed.
- Focused ESLint initially reported one unused test import; the import was removed. Final lint through the harness passed.
- Final `yarn test`: 51 files / 583 tests passed.
- Final focused unit tests: 33/33 passed.
- Final focused assignment and attachment-finalization Postgres tests: 14/14 passed.
- Final focused Playwright workflows: 2/2 passed in 10.0s.

### Full validation gate

- `DATABASE_URL=postgresql://veerify:veerifypassword@localhost:5432/veerify_sup05a1_e2e yarn harness:verify`
  - Exit 0; all harness gates passed.
  - Context/docs map: passed.
  - Typecheck: passed.
  - Unit: passed (51 files / 583 tests, confirmed by the standalone final run).
  - Lint: passed.
  - Guarded E2E: skipped with the exact guard output: `[playwright] Skipping e2e run: not running in cloud/CI and PLAYWRIGHT_FORCE is not set to 1.` and `[playwright] Runs require cloud/CI or PLAYWRIGHT_FORCE=1 and a reachable configured database.` Focused forced Playwright coverage passed separately as recorded above.
  - Redis integration: 1 file / 6 tests passed.
  - Postgres integration: 11 files / 104 tests passed; 1 file / 1 test skipped. Exact nested skip reason: `[realtime-two-process] Skipping: REDIS_URL is not set.` The separately guarded Redis suite passed.

### Git completion

- `git add` was restricted to the 12 implementation/test paths listed above.
- `git diff --cached --check`: passed.
- `git commit -m "feat(support): add conversation claim assignment"`: created `20df161292b5bbc12da23ebcd5a7e68f5ae5c837`.
- `git push -u origin agent/SUP-05A-1-claim-assignment`: passed and configured the upstream.
- Final `git status --short --branch`: clean, tracking the pushed branch.
- Local and remote branch SHAs both resolve to `20df161292b5bbc12da23ebcd5a7e68f5ae5c837`.

## Assumptions and design choices

- "First outgoing reply" means the first outgoing reply while the conversation is unassigned. If it already has an owner, replies preserve that owner; if it becomes unassigned later, the next outgoing reply claims it.
- The existing authenticated PATCH route remains the canonical path for explicit claim, handoff, and unassign, including its single exact activity behavior.
- Strong inbound threading is the only route allowed to reopen a resolved conversation. Weak subject fallback still excludes resolved tickets as already settled.
- The inbound reopen activity has no human actor because the state transition is triggered by customer mail; assignment is unchanged.

## Blockers and concerns

- Blockers: none.
- Concerns: none. The only skips are the documented local Playwright guard in the full harness and the nested two-process realtime integration test's missing `REDIS_URL`; focused browser coverage ran and the dedicated Redis guard passed.

## Fix round 1 — explicit-claim atomicity and browser workflow coverage

### Status and commits

- Status: DONE.
- Original implementation: `20df161292b5bbc12da23ebcd5a7e68f5ae5c837` — `feat(support): add conversation claim assignment`.
- Fix commit: `b94c2e71e988c8abaa09a8f307f5ba6d8567135b` — `fix(support): make explicit claims atomic`.
- Branch: `agent/SUP-05A-1-claim-assignment`.
- Final local HEAD, upstream, and `origin/agent/SUP-05A-1-claim-assignment` all resolve to `b94c2e71e988c8abaa09a8f307f5ba6d8567135b`.

### RED evidence from review

- Explicit Claim was not atomic at `20df161`: `git show 20df161:components/support/SupportConversationThread.vue` showed the Claim button calling the generic `PATCH` path with `@click="onUpdate('assigneeUserId', currentUserId)"`. Inspection of `server/api/support/conversations/[id].patch.ts` showed that route deriving `changes` from a pre-transaction snapshot and then updating by conversation ID alone. Two agents could therefore both observe `null`, both update, overwrite the owner, and each write an assignment activity. The real-Postgres suite had concurrent outgoing-reply coverage but no concurrent explicit-claim case.
- The Playwright workflow was API-only at `20df161`: `git show 20df161:tests/e2e/support-conversation-flow.spec.ts` contained the explicit comment `Deliberately API-level` and performed note, outgoing reply, handoff, unassign, and reclaim with `request.post`/`request.patch`. `support-permissions.spec.ts` mocked only a successful generic PATCH. It did not prove that the composer refreshes the displayed owner or that the actual assignee dropdown performs handoff and release.

### GREEN implementation and evidence

- Explicit Claim now uses `POST /api/support/conversations/[id]/claim`. `claimConversationForAgent` performs `UPDATE ... WHERE id = ? AND assignee_user_id IS NULL RETURNING` and writes the assignment activity inside the same Postgres transaction. A losing caller cannot overwrite the winner and returns the committed current owner with `claimed: false`; only the winning conditional update records activity.
- The new real-Postgres test starts two `claimConversationForAgent` calls with `Promise.all` and asserts one winner, one loser, the same final owner in both results, and one matching activity.
- The browser workflow now logs in and uses the visible note/reply composer controls, observes the refreshed assignee after the outgoing reply, uses the real assignee `<select>` for handoff and release, and uses the Claim button to reclaim. The permission-aware browser test additionally exercises the lost-race response and displays the winning owner.

Focused Postgres command:

`DATABASE_URL=postgresql://veerify:veerifypassword@localhost:5432/veerify_sup05a1_e2e yarn test:integration tests/integration/conversation-assignment.test.ts`

- Result: exit 0; 1 file passed, 5/5 tests passed. This includes the concurrent explicit-claim proof.

Focused forced Playwright command:

`PLAYWRIGHT_FORCE=1 DATABASE_URL=postgresql://veerify:veerifypassword@localhost:5432/veerify_sup05a1_e2e UPLOAD_TOKEN_SECRET=playwright-upload-secret-0123456789abcdef BETTER_AUTH_SECRET=playwright-auth-secret-0123456789abcdef yarn playwright test tests/e2e/support-conversation-flow.spec.ts tests/e2e/support-permissions.spec.ts --grep 'create, reply, note, assign, status change, and activity message|agent sees the winning owner when an explicit claim loses a race' --workers=1`

- Result: exit 0; 2/2 Chromium tests passed in 27.6s (28.40s command time).
- Environment RED before that run: omitting `UPLOAD_TOKEN_SECRET` caused Nuxt not to become ready and Playwright failed with `Timed out waiting 120000ms from config.webServer`; rerunning with the explicit test-only secrets above reached and passed both assertions.
- Non-failing runtime noise: the local SMTP service was unavailable (`ECONNREFUSED 127.0.0.1:587`), one dev-server `write EPIPE` was logged, and the mocked permission test produced the expected forbidden realtime-subscription warning. Both targeted tests still completed successfully.

### Formatting and full validation

- `yarn prettier --write components/support/SupportConversationThread.vue pages/support/index.vue server/api/support/conversations/[id]/claim.post.ts server/utils/conversation-assignment.ts tests/e2e/support-conversation-flow.spec.ts tests/e2e/support-permissions.spec.ts tests/integration/conversation-assignment.test.ts tests/support-route-authorization.test.ts`
  - Result: all eight fix files unchanged.
- `DATABASE_URL=postgresql://veerify:veerifypassword@localhost:5432/veerify_sup05a1_e2e UPLOAD_TOKEN_SECRET=playwright-upload-secret-0123456789abcdef BETTER_AUTH_SECRET=playwright-auth-secret-0123456789abcdef yarn harness:verify`
  - Result: exit 0; every harness gate passed.
  - Agent docs map and typecheck: passed.
  - Unit tests: 51 files, 583/583 tests passed.
  - Lint: 0 errors and 206 pre-existing warnings.
  - Guarded E2E skip reason: `[playwright] Skipping e2e run: not running in cloud/CI and PLAYWRIGHT_FORCE is not set to 1.` followed by `[playwright] Runs require cloud/CI or PLAYWRIGHT_FORCE=1 and a reachable configured database.` The focused forced browser run passed separately as recorded above.
  - Redis integration: 1 file, 6/6 tests passed.
  - Postgres integration: 11 files passed and 1 skipped; 105/105 executed tests passed, 1 skipped. Exact nested skip reason: `[realtime-two-process] Skipping: REDIS_URL is not set.`

### Final state

- `git status --short --branch`: clean in `/home/dev/code/veerify-support-sup-05a-1`, tracking the pushed remote branch.
- No additional product-code change was needed after inspecting and rerunning `b94c2e7`; the commit resolves both review blockers.
- `TODO.md` was not modified.
- Blockers: none.
- Concerns: none beyond the reported local guard skip and non-failing browser-runtime service warnings.
