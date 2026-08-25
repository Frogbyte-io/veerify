# Task 4 implementation report

## Scope

Implemented capability-aware support navigation and settings for team admin,
inbox admin, supervisor, agent, and unassigned team members. The UI consumes
server capability payloads, keeps privileged controls hidden for lower roles,
adds accessible labels/focusable controls and purposeful empty/error states,
and recovers from a forbidden deep link without exposing the rejected inbox
name.

The live permission workflow also exposed and fixed a pre-existing server bug:
the non-admin inbox list used inferred Drizzle join keys, so valid memberships
could be filtered out. The route now uses an explicit `{ inbox, role }`
projection and strict role parsing in a separate non-admin branch.

## Changed files

- `pages/support/index.vue`
- `pages/support/settings.vue`
- `components/support/SupportInboxSidebar.vue`
- `server/api/support/inboxes/index.get.ts`
- `tests/support-inbox-list.test.ts`
- `tests/e2e/helpers/selectors.ts`
- `tests/e2e/helpers/support-permissions.ts`
- `tests/e2e/support-conversation-flow.spec.ts`
- `tests/e2e/support-permissions.spec.ts`

## Browser setup and TDD evidence

- `npx` prerequisite verified at `C:\nvm4w\nodejs\npx.ps1`, version `11.6.2`.
- Isolated database: `127.0.0.1:5432/veerify_task4_20260825`; migrated and
  seeded, and verified distinct from the default `veerifydb` database.
- The required guarded prerequisite ran real Playwright with
  `PLAYWRIGHT_FORCE=1` and printed `Running 87 tests using 8 workers`; no
  guard skip was accepted as browser proof.
- Focused RED was established with 6 tests discovered: the first assertion
  failed at the missing `support-team-policy` locator after fixture setup,
  login, and page rendering completed.
- Focused unit RED/GREEN for the join projection was captured during the route
  diagnosis; final `tests/support-inbox-list.test.ts` is GREEN at 7/7.
- Fixture creates unique users through public signup, inserts fixed team and
  inbox memberships through Drizzle, self-checks every expected membership,
  uses fresh browser contexts with programmatic login/session assertions, and
  cleans owned IDs in reverse FK order.

## Validation

- `yarn typecheck`: passed.
- `yarn test`: passed, 42 files / 457 tests.
- `yarn lint`: passed, 0 errors / 188 warnings (existing repository debt).
- Focused permission Playwright, serial `--workers=1`: passed, 6/6 in 18.7s
  against `http://127.0.0.1:4913` and the isolated database.
- Forced broad Playwright prerequisite/stress run: real run, 87 discovered;
  39 passed, 36 failed, 5 skipped, 7 did not run. It is not a pass; failures
  are unrelated broad-suite contention/environment failures (including the
  parallel permission fixture receiving `Missing or null Origin`).
- Existing `support-conversation-flow.spec.ts`, serial: failed before the
  affected workflow at inbox creation (`expect(inboxResponse.ok()).toBeTruthy`,
  response body not asserted); this is separate from the 6/6 Task 4 workflow.
- `yarn harness:verify` with explicit isolated `DATABASE_URL` and
  `PLAYWRIGHT_FORCE=0`: passed all non-browser gates. E2E explicitly skipped
  with the documented local guard reason; Redis passed 1 file / 6 tests;
  Postgres passed 6 files / 42 tests.
- The forced harness run did execute Playwright and failed its broad stage, so
  the final harness result is recorded as stress evidence rather than a green
  release gate.

## Commits

## Reviewer hardening round 1

Implemented the reviewer follow-up from `025d205`: settings channel status is
queried with the selected `inboxId`; index and settings share generic 403
recovery; stale inbox-scoped state is cleared during team/inbox switches; and
stale responses are ignored with a monotonic request token. Self-removal now
has explicit loss-of-access confirmation, remove controls name their target,
and unassigned users see only the intentional no-assignment state. The
permission fixture tracks partial ownership, cleans verification and auth rows
in reverse-FK order, and proves owned users/inboxes are gone. Auth requests use
one origin/referer helper and browser tests use one programmatic page login with
session identity assertions.

The conversation-flow fixture asserts the intended agent receives a 403 and
`FORBIDDEN` body when creating an inbox, creates the inbox through a unique
explicit team-admin setup identity, grants the agent inbox access, and removes
all owned setup rows in `finally`.

### Round evidence

- Server/browser target: `http://localhost:4913`, with explicit isolated
  database `postgres://veerify:veerifypassword@127.0.0.1:5432/veerify_task4_20260825`.
- Before each focused browser invocation, the guard printed real Playwright
  execution (`Running 90 tests using 8 workers`); the broad guard was then
  terminated as prerequisite proof and never counted as a focused pass.
- `tests/e2e/support-permissions.spec.ts --workers=1`: 9/9 passed, including
  channel query binding, self-removal confirmation, deep-link recovery,
  unassigned controls, and deterministic revocation between list/detail.
- `tests/e2e/support-conversation-flow.spec.ts --workers=1`: 1/1 passed.
- `yarn typecheck`: passed.
- `yarn test`: 42 files / 457 tests passed.
- `yarn lint`: passed with 0 errors / 188 warnings (repository warning debt).
- `yarn harness:verify` with explicit isolated `DATABASE_URL` and
  `PLAYWRIGHT_FORCE=0`: passed. Its guarded E2E stage explicitly skipped for
  the local non-cloud guard; Redis passed 1 file / 6 tests; Postgres passed 6
  files / 42 tests.
- The earlier forced broad 8-worker run remains separate stress evidence and
  is not claimed as a pass; the controller recorded 36 failed test IDs.

- `5e071f8` — `fix(support): preserve joined inbox access`
- `025d205` — `feat(support): reflect inbox permissions in the UI`

## Reviewer hardening round 2

Round 2 closes the remaining stale-context and recovery findings from
`task-4-rereview.md`. The index now carries a monotonic context generation
through team, inbox, member, conversation, contact, and recovery requests.
Settings mutations and status reads carry request/team/inbox snapshots, and
recovery-mode status 403s clear the rejected context through the central
handler. Auth fixtures share one base URL helper, claim unique emails before
signup and recover ambiguous created IDs, and cleanup asserts that owned auth,
membership, contact, conversation, and inbox rows are gone. The self-removal
test uses the non-team-admin inbox-admin identity so its loss-of-access copy is
accurate.

### Round 2 TDD and validation evidence

- `npx` prerequisite remains verified at `C:\nvm4w\nodejs\npx.ps1`; the
  isolated server returned HTTP 200 for `/login` before browser runs.
- Every focused browser invocation was preceded by the forced guard, which
  printed real Playwright execution (`Running 93`/`94 tests using 8 workers`);
  no guard skip was accepted as browser proof.
- RED: the recovery-mode status regression first reached the generic access
  alert but left the stale settings cards rendered; the first failing
  assertion was `support-permissions.spec.ts:289` on the missing
  `support-no-assignment` state. GREEN followed by clearing selected inbox
  state and rendering the intentional no-assignment card.
- GREEN: permission workflow serial `--workers=1`: 13/13 passed.
  This includes delayed old-team index response, team-policy 403 recovery,
  recovery-mode status 403, delayed mutation reload after inbox switch,
  revocation between list/detail, all five roles, deep links, and self-removal.
- GREEN: `support-conversation-flow.spec.ts --workers=1`: 1/1 passed.
- GREEN: `yarn typecheck`; `yarn test`: 42 files / 457 tests; `yarn lint`:
  0 errors / 188 warnings.
- The broad forced Playwright run remains separate stress evidence and is not
  claimed as a pass. The normal explicit-DB harness and Redis/Postgres guard
  totals remain those recorded above; guarded local E2E is reported as a skip
  when `PLAYWRIGHT_FORCE=0`.

### Round 2 changed files

- `pages/support/index.vue`
- `pages/support/settings.vue`
- `tests/e2e/helpers/auth.ts`
- `tests/e2e/helpers/support-permissions.ts`
- `tests/e2e/support-permissions.spec.ts`

### Round 2 commit

`2e74a5b` — `fix(support): close stale context recovery races`

## Reviewer hardening round 3 (final)

Final review fixes add ownership checks before settings 403 recovery or stale
cleanup, make recovery generation-owned through its `finally`, and refresh
team settings/capabilities after a team-policy 403. Index conversation detail,
messages, contact/timeline/previous-conversation reads, and support mutations
now validate team/inbox/conversation snapshots before success, error, recovery,
and cleanup writes. The settings mutation regression now fulfills a
distinguishable `STALE OLD RESPONSE` payload and asserts it never appears.

### Round 3 evidence

- Isolated target remained `postgres://veerify:veerifypassword@127.0.0.1:5432/veerify_task4_20260825`, with the ready worktree server at `http://localhost:4913`.
- Each focused browser invocation was preceded by a forced guard that printed
  real Playwright execution (`Running 94 tests using 8 workers`); guard output
  was prerequisite evidence only.
- Focused policy-capability regression: 1/1 passed; recovery now receives a
  refreshed `canManageTeamSupport: false` payload and the policy card is absent.
- Strengthened stale mutation regression: 1/1 passed with the explicit stale
  response assertion.
- Full permission workflow serial `--workers=1`: 13/13 passed.
- Conversation-flow serial `--workers=1`: 1/1 passed.
- Final harness with explicit isolated `DATABASE_URL` and `PLAYWRIGHT_FORCE=0`:
  all gates passed; unit 42 files / 457 tests, Redis 1 file / 6 tests,
  Postgres 6 files / 42 tests, typecheck passed, lint 0 errors / 188 warnings.
  Guarded local E2E explicitly skipped. The prior broad forced parallel stress
  result remains separate and is not claimed as a pass.

## Reviewer hardening round 4

This round addresses the three Important findings in the acceptance
re-review. Tag-list 403 recovery now uses the current team/inbox snapshot and
cannot reference an undefined conversation ID. Contact-panel 403 recovery now
requires the conversation snapshot to remain current, so a delayed request
from conversation A cannot clear a newly selected conversation B. Settings
recovery now owns a token, rechecks that token and team before every fallback,
query, selection, form, and context write, and resets recovery ownership when
`initPage` starts a new team/context generation.

### Round 4 TDD and validation evidence

- Added three deterministic Playwright regressions to
  `tests/e2e/support-permissions.spec.ts`: tag 403 recovery, delayed
  contact-panel 403 after conversation switch, and team switch during settings
  recovery.
- Initial browser proof was environment-blocked while the dev server warmed.
  After restarting with the correct origin, secrets, and isolated database,
  the failing ownership test was reproduced: route interception was installed
  before the page's mounted initialization finished, so the initial request
  received the switched-team fixture and recovery never started for the
  original team. The test now waits for the initial policy control before
  installing switched-team routes, asserts the switched inbox through the
  form value, and proves ownership reset with a second switched-team recovery
  list request.
- Focused settings ownership test, serial: 1/1 passed in 5.6s.
- Full `support-permissions.spec.ts`, serial `--workers=1`: 16/16 passed in
  40.8s.
- `support-conversation-flow.spec.ts`, serial `--workers=1`: 1/1 passed in
  3.6s.
- `yarn typecheck`: passed.
- `yarn test`: passed, 42 files / 457 tests.
- `yarn lint`: passed, 0 errors / 188 warnings (existing repository warning
  debt).
- Broad forced Playwright stress and the guarded harness remain separate from
  this round and are not claimed as broad green evidence.

### Round 3 commit

## Reviewer hardening round 5 (final fidelity fix)

The delayed contact-panel 403 regression now observes both sides of the
race. The test counts inbox-list calls separately from the initial load and
fails if the stale conversation-A response starts any recovery request. It
holds conversation B's contact response until conversation A's delayed 403
has completed, then releases B and waits for that request to complete before
reasserting B's selected `bg-accent` class. It also asserts that neither the
generic inbox-access alert nor the no-assignment recovery state appears.

### Round 5 evidence

- Focused delayed contact-panel regression, serial: 1/1 passed against the
  fixed source at `http://localhost:4913`, using isolated database
  `veerify_task4_20260825` and matching `BETTER_AUTH_URL`/trusted origin.
- Full permission workflow, serial: 16/16 passed (45.3s).
- Conversation flow, serial: 1/1 passed (4.0s).
- `yarn typecheck`: passed.
- `yarn test`: 42 files / 457 tests passed.
- `yarn lint`: 0 errors / 188 existing warnings.
- `yarn harness:verify`: all gates passed with isolated `DATABASE_URL`;
  Redis 1 file / 6 tests and PostgreSQL 6 files / 42 tests passed. Guarded
  E2E was intentionally skipped because `PLAYWRIGHT_FORCE=0`; the focused
  and serial browser runs above supplied browser evidence.
- A targeted source mutation removing the conversation-current guard was
  applied and restored without being staged. The mutation run was blocked by
  Nuxt dev-server `/support` navigation aborts during HMR, and a clean
  production-build mutation attempt was interrupted while Nitro generated
  its server bundle; therefore no mutation RED result is claimed. The final
  worktree has the guard unchanged and only the test/report files modified.

### Round 5 changed files

- `tests/e2e/support-permissions.spec.ts`
- `.superpowers/sdd/stage-01-04-hardening-implementation/task-4-report.md`

`8fa5d7c` — `fix(support): guard final stale recovery writes`
