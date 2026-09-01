# Stage 01-04 hardening review handoff

Updated: 2026-09-01

## Repository state

- Working branch: `review/stage-01-04-audit`
- Current worktree: `/home/dev/code/veerify-stage-01-04-review`
- Merge base: `83603d24c766631230e3c76501fb08bc3503eab4` (`origin/support-platform` at the start of the review)
- Last completed task commit: `47ae7f4` (`fix(support): correlate delivery events through outbox`)
- Saved Task 10/handoff checkpoints: `fc20edf` and `f19de54`
- Remote preservation branch: `origin/review/stage-01-04-audit`
- Integration target: `support-platform`
- The integration target has two later documentation commits (`c3c19b1`, `5b82348`) that are not yet in this review branch and are pushed to `origin/support-platform`. Merge or rebase only after the remaining hardening tasks and final verification are green.

The durable implementation plan is
`docs/plans/2026-08-11-support-platform/stage-01-04-hardening-implementation.md`.
Tasks 1-12 are complete. Tasks 13-16 and the final whole-branch review remain.

## Completed work

Tasks 1-12 are committed on this branch, covering:

1. staged hardening schema and migration contracts;
2. ranked inbox access, capability payloads, and route authorization;
3. permission-aware UI and stale-request recovery;
4. authenticated feedback auto-linking with contact-lifecycle serialization;
5. bounded, independently paginated contact timelines;
6. server-owned attachment upload sessions and bounded proxy/direct upload contracts;
7. durable upload reservation/finalization and canonical attachment payloads;
8. leased cleanup, safe attachment downloads, outbound size enforcement, and scheduling;
9. reactive attachment upload progress, expiry/retry handling, opaque upload submission, and persisted download chips;
10. inbox-scoped RFC threading, explicit collision handling, diagnosed replacement tickets, and the non-unique RFC-ID index cutover.
11. provider-account-aware delivery events, durable outbox correlation, legacy queued-row delivery, and bounce-dominant terminal status handling.

The latest completed verification, after Task 10, was:

- typecheck: passed;
- unit: 510/510 across 46 files;
- full lint: 0 errors and 202 warnings, all non-blocking;
- attachment cleanup PostgreSQL focus: 12/12;
- PostgreSQL integration: 89/89 across 10 files;
- Redis integration: 6/6;
- focused outbound-reply Playwright: 2 passed, 1 provider-credential-gated skip;
- focused inbound-email Playwright with isolated local credentials: 3/3;
- guarded E2E in `yarn harness:verify`: skipped because `PLAYWRIGHT_FORCE=1` was not set for that command.

## Task 10 completed

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

The focused UI failure was caused by mutating the plain attachment object after pushing it into Vue's reactive array. Internal state reached `ready`, but the rendered phase remained `preparing`. Commit `9212e5a` now mutates the array's reactive proxy, preserving the real presign/proxy path and the original browser assertions.

Current validation state:

- `yarn harness:verify`: passed;
- typecheck: passed;
- unit: 510/510 across 46 files;
- lint: 0 errors and 202 warnings;
- Redis integration: 6/6;
- PostgreSQL integration: 87/87 across 10 files;
- focused serial outbound-reply Playwright: 2 passed and 1 Postmark-credential-gated skip.

## Task 11 completed

- RFC Message-ID lookup remains joined to `conversation` and filtered by the receiving inbox.
- The resolver reads at most two matches; two matches return `ambiguous-message-id` even when they belong to one conversation, and no weaker fallback runs.
- Ambiguity creates a new conversation with sanitized `threadingCollision` metadata and identity-only warning logs.
- Generated migration `0028_spotty_captain_universe.sql` replaces the global unique RFC-ID index with a non-unique lookup index after the consumer cutover.
- Cross-team duplicate RFC IDs and same-inbox ambiguity are covered through the real Postmark intake route.
- The older inbound E2E fixture now temporarily promotes and restores the seed membership because the hardened module-toggle route correctly requires a team admin.

Validation:

- focused threading unit: 13/13;
- focused threading/schema PostgreSQL integration: 13/13;
- focused inbound-email Playwright: 3/3;
- `yarn harness:verify`: passed with 510/510 unit, 6/6 Redis integration, and 89/89 PostgreSQL integration tests; guarded E2E skipped because that command did not set `PLAYWRIGHT_FORCE=1`.

## Task 12 completed

- Postmark and Mailgun drivers now expose exact provider correlation headers and normalize provider event/account/message identity, durable correlation metadata, recipient, provider occurrence time, and bounce details.
- Required non-secret provider account keys are reported by the driver-owned channel configuration contract and the inbox-scoped channel-status endpoint.
- Outbound transport results use `{ accepted, providerMessageId?, response }`; claimed legacy rows derive provider/account metadata from their existing idempotency key without rewriting queued JSON.
- Successful sends persist provider diagnostics. Nodemailer's RFC `messageId` is deliberately not stored as a provider ID.
- Delivery correlation resolves the globally unique outbox idempotency key first, then permits only one exact `(provider, providerAccountKey, providerMessageId, recipient)` fallback.
- The delivery route no longer queries `conversationMessage.channelMessageId`, so a provider ID equal to another conversation's RFC Message-ID remains uncorrelated.
- Generated migration `0029_lyrical_ultimo.sql` cuts delivery-event uniqueness over to `(provider, providerAccountKey, providerEventId)` after the consumer change.
- Provider occurrence time is stored separately from local receipt time, and valid unmatched events are recorded and acknowledged.
- Concurrent duplicate claims have one owner; delivered/hard-bounce events are bounce-terminal in either arrival order and under a race, with exactly one visible bounce activity.

Validation:

- focused provider/email/outbox/route unit: 96/96; final full unit: 522/522 across 47 files;
- focused delivery/outbox/schema PostgreSQL integration: 25/25; final full PostgreSQL integration: 95/95 across 10 files;
- Redis integration: 6/6;
- typecheck: passed;
- lint: 0 errors and 204 warnings, all non-blocking;
- `yarn harness:verify`: passed; guarded E2E skipped because `PLAYWRIGHT_FORCE=1` was not set, and Task 12 changed no user-facing UI behavior.

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
4. Start Task 13 with retry scheduling, ownership, and duplicate-risk tests.
5. Continue Tasks 14-16 in implementation-plan order.
6. After Task 16, run the implementation plan's complete verification matrix and whole-branch review before integrating into `support-platform`.

## Other worktrees and branches at handoff

At the time of this note, the main worktree, the three `t3code/*` worktrees, the review worktree, and `D:\veerify-agent1` were clean. The following preservation pushes were completed:

- `review/stage-01-04-audit` to `origin/review/stage-01-04-audit`;
- `support-platform` through `5b82348` to `origin/support-platform`;
- `sleekplan-export` through `bb30ea5` to `origin/sleekplan-export`;
- `agent1/stage-02` through `06d7be2` to `origin/agent1/stage-02`.

Every commit reachable from a local branch is also reachable from at least one remote ref. Local `main` was not pushed because its 25 commits are already preserved on `origin/support-platform`; updating protected/integration `origin/main` would be a separate release decision. Platform-owned `refs/t3/checkpoints/*` were not pushed as product branches. The disposable detached `stage-01-04-baseline` worktree was verified to contain no unique work and removed.
