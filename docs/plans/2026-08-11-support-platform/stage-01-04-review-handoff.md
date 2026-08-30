# Stage 01-04 hardening review handoff

Updated: 2026-08-30

## Repository state

- Working branch: `review/stage-01-04-audit`
- Worktree used for the review: `C:\Users\ananords\.t3\worktrees\veerify\stage-01-04-review`
- Merge base: `83603d24c766631230e3c76501fb08bc3503eab4` (`origin/support-platform` at the start of the review)
- Last completed task commit: `035e237` (`feat(support): clean attachment upload sessions`)
- Integration target: `support-platform`
- The integration target has two later documentation commits (`c3c19b1`, `5b82348`) that are not yet in this review branch. Merge or rebase only after the remaining hardening tasks and final verification are green.

The durable implementation plan is
`docs/plans/2026-08-11-support-platform/stage-01-04-hardening-implementation.md`.
Tasks 1-9 are complete. Task 10 is in progress. Tasks 11-16 and the final whole-branch review remain.

## Completed work

Tasks 1-9 are committed on this branch. The branch contains 31 commits beyond the original merge base, covering:

1. staged hardening schema and migration contracts;
2. ranked inbox access, capability payloads, and route authorization;
3. permission-aware UI and stale-request recovery;
4. authenticated feedback auto-linking with contact-lifecycle serialization;
5. bounded, independently paginated contact timelines;
6. server-owned attachment upload sessions and bounded proxy/direct upload contracts;
7. durable upload reservation/finalization and canonical attachment payloads;
8. leased cleanup, safe attachment downloads, outbound size enforcement, and scheduling.

The latest completed verification, after Task 9, was:

- typecheck: passed;
- unit: 510/510 across 46 files;
- changed-file lint: clean; full lint had 0 errors and 203 warnings, mostly pre-existing;
- attachment cleanup PostgreSQL focus: 12/12;
- PostgreSQL integration: 87/87 across 10 files;
- guarded E2E: skipped because `PLAYWRIGHT_FORCE=1` was not set;
- Redis integration: skipped because Valkey was unreachable at that time.

## Task 10 work in progress

Modified files:

- `components/support/SupportComposer.vue`
- `components/support/SupportMessageItem.vue`
- `tests/e2e/support-outbound-reply.spec.ts`

Implemented behavior:

- client phases for preparing, uploading, completing, ready, failed, and expired;
- XHR byte progress with accessible status/progress semantics;
- 10-file, 10 MB per-file, 25 MB total, MIME, and zero-byte checks;
- opaque `uploadId` submission only; no client-provided storage keys;
- proxy uploads complete on PUT and external uploads call the explicit completion endpoint;
- expiry timers, retry with a fresh presign, conversation-generation guards, and upload abort on removal/switch;
- attachments block switching to internal-note mode, and the attach control is hidden in note mode;
- persisted message attachments render as forced-download chips with filename and readable size;
- non-Postmark-gated API and browser acceptance coverage.

Review fixes already applied to the draft:

- ready uploads now expire at the server-provided deadline;
- retry clears the old timer/session/progress state;
- stale submit completion cannot clear a new conversation's draft;
- proxy detection parses and validates the target URL/path;
- retry/remove controls have accessible names;
- the browser test now asserts that attachments prevent note-mode switching;
- an invalid Playwright `APIResponse.then(...)` call was fixed;
- the browser test explicitly installs and verifies the seed session cookie before navigation;
- direct uploads assert PUT-before-complete ordering.

Current validation state:

- `yarn typecheck`: passed after the Task 10 TypeScript correction;
- changed-file ESLint: passed before the latest browser-fixture-only edits and should be rerun;
- focused serial API browser case: passed (real proxy upload, opaque ID, persisted download payload);
- Postmark round-trip case: correctly skipped without provider credentials;
- focused UI browser case: not green yet.

The current UI failure is deterministic after authentication is fixed: selecting the first file leaves the composer in `Preparing attachment...`; the expected presign request does not complete within the assertion timeout. The test was changed to use the real presign and proxy endpoints for the first upload, with mocks retained only for external-storage failure/retry/expiry. Continue by tracing the browser presign request/response and server handler rather than weakening the state assertion.

## Local runtime findings

The default Windows Nuxt dev process can exhaust its roughly 2 GB V8 heap while compiling `/support`. Symptoms are a zero-byte `/support` response, about 1.7-1.9 GB resident memory, high handle growth, and eventual OOM/restart while transforming the support/Lucide dependency graph. Direct Vue SFC compilation of both changed components is fast and error-free; a clean baseline also needs roughly 55 seconds for its first `/support` response.

Use this local runtime profile on the next machine:

```powershell
$env:NODE_OPTIONS='--max-old-space-size=4096'
$env:DATABASE_URL='postgresql://veerify:veerifypassword@localhost:5432/<isolated-db>'
$env:REDIS_URL='redis://localhost:6379'
$env:BETTER_AUTH_SECRET='<at-least-32-character-local-secret>'
$env:UPLOAD_TOKEN_SECRET='<at-least-32-character-local-secret>'
yarn db:migrate
yarn dev:worktree
```

With the 4 GB heap, the warmed Task 10 worktree returned `/support` with HTTP 200 in 14.45 seconds. T3 collaborative preview could open a blank tab but rejected both environment-port and direct localhost navigation, so serial repository Playwright was used instead.

For focused proof:

```powershell
$env:NODE_OPTIONS='--max-old-space-size=4096'
$env:PLAYWRIGHT_FORCE='1'
yarn test:e2e:worktree -- tests/e2e/support-outbound-reply.spec.ts --workers=1
```

Do not claim `yarn build` green. The existing Nuxt/Nitro 2.11.12 production packaging issue can corrupt transformed third-party Scalar/VueUse code (`Expected ',', got '$1'`), and the default-heap diagnostic build also reproduced V8 OOM while transforming the Lucide dependency graph. Task 14 owns build/deployment hardening.

## Resume order

1. Confirm this branch/worktree and run `yarn harness:context`.
2. Start Postgres and Valkey, migrate an isolated database, and seed `test@preview.local` / `password123`.
3. Start the worktree runtime with a 4 GB Node heap and both required local secrets.
4. Finish the Task 10 presign/browser diagnosis; keep the first upload on the real proxy path.
5. Run Task 10 focused serial Playwright until the non-provider attachment cases pass.
6. Run changed-file lint, typecheck, affected unit/integration suites, then `yarn harness:verify` and record every guarded skip.
7. Request an independent Luna acceptance review, fix all Important/Critical findings, commit Task 10, then continue Tasks 11-16.
8. After Task 16, run the implementation plan's complete verification matrix and whole-branch review before integrating into `support-platform`.

## Other worktrees and branches at handoff

At the time of this note, the three `t3code/*` worktrees and `D:\veerify-agent1` were clean and matched their configured upstreams. The main `support-platform` worktree was two documentation commits ahead of `origin/support-platform`. A disposable detached diagnostic worktree named `stage-01-04-baseline` was created only to compare Nuxt cold-route behavior; it contains no product work and should not be migrated.
