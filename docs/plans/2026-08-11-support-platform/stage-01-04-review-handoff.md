# Stage 01-04 hardening review handoff

Updated: 2026-09-03

## Repository state

- Working branch: `review/stage-01-04-audit`
- Current worktree: `/home/dev/code/veerify-stage-01-04-review`
- Merge base: `83603d24c766631230e3c76501fb08bc3503eab4` (`origin/support-platform` at the start of the review)
- Last completed task commit: `3375287` (`fix(support): resolve the review gate's minor findings`)
- Saved Task 10/handoff checkpoints: `fc20edf` and `f19de54`
- Remote preservation branch: `origin/review/stage-01-04-audit`
- Integration target: `support-platform`
- The integration target has two later documentation commits (`c3c19b1`, `5b82348`) that are not yet in this review branch and are pushed to `origin/support-platform`. Merge or rebase only after the remaining hardening tasks and final verification are green.

The durable implementation plan is
`docs/plans/2026-08-11-support-platform/stage-01-04-hardening-implementation.md`.
**All sixteen tasks are complete, and the Final Review Gate has run.** Its three Important findings are fixed. What remains is integration into `support-platform`.

## Completed work

Tasks 1-14 are committed on this branch, covering:

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
12. due-time retry scheduling, attempt-owned completion/failure, concurrency-safe manual retry, and explicit duplicate-send confirmation.
13. compile-only builds, explicit deployment migrations, lifecycle regression coverage, and isolated cold/warm build profiling.

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

## Task 13 completed

- Retry due times use exponential delays from 60 seconds through a 15-minute cap with deterministic 0.8-1.2 multiplier jitter.
- Claims now require `nextAttemptAt <= now`; retryable failure persists its due time instead of becoming immediately reclaimable in the same worker pass.
- Completion and failure mutate only the still-owned `(deliveryId, messageId, attemptCount)` claim, and return `false` after a newer worker reclaims the lease.
- Concurrent workers have one owner, stale outcomes cannot alter the newer attempt, and one scheduler pass processes a retryable row only once.
- The fifth owned failure is terminal. Manual retry is allowed only from terminal `failed`, is concurrency guarded, becomes due immediately, and preserves RFC/correlation identities.
- The retry endpoint reports `previousSubmissionAttempted`; the failed-message UI requires confirmation with the exact duplicate-risk warning before making the request.
- The outbound browser contract now distinguishes a durably scheduled pending attempt from an untouched row and uses a phase-scoped attachment retry locator.

Validation:

- focused retry/scheduler/authorization unit: 43/43;
- focused outbound PostgreSQL integration: 12/12;
- forced Playwright prerequisite confirmed a 102-test run; the broad suite was stopped after unrelated existing public-board/settings UI failures;
- focused serial outbound-reply Playwright: 3/3;
- final full unit: 524/524 across 47 files;
- final full PostgreSQL integration: 98/98 across 10 files;
- Redis integration: 6/6;
- typecheck: passed;
- lint: 0 errors and 205 warnings, all non-blocking;
- `yarn harness:verify`: passed; its guarded E2E subcommand skipped because that command did not set `PLAYWRIGHT_FORCE=1`.

## Task 14 completed

- `yarn build` is compile-only: the implicit `postbuild` migration/seed hook was removed and a controlled lifecycle test proves only Nuxt runs.
- `yarn db:migrate:deploy` is the explicit release migration command. Vercel runs it before compilation, Docker still migrates explicitly at container startup, and CI uses the same named command.
- Seed operations remain explicit development/test commands and are absent from build and install hooks.
- CI and Docker now use the ordinary `yarn build` path instead of bypassing package lifecycle behavior.
- The build profiler owns a validated OS-temp directory, isolates both Nuxt and Nitro output, measures the complete process tree, reports phase timing/exit/peak RSS, reuses one directory for warm passes, and cleans it in `finally`.
- Self-hosted Nitro builds disable external dependency tracing because Nitro 2.11.12 recreated recursive Yarn symlink chains and failed with `ELOOP`. The runtime image already includes `node_modules`; cloud/Vercel builds retain normal tracing.

Validation:

- focused build lifecycle: 2/2;
- explicit deployment migration: passed against the isolated audit database;
- normal production build: passed in 39.25 seconds with a 4 GiB heap;
- cold profile: 40.155 seconds, 3600.1 MiB peak RSS;
- warm profiles: 39.920 seconds / 3585.5 MiB and 40.406 seconds / 3616.5 MiB;
- profiler-owned temporary directories: cleaned; tracked worktree output: untouched by profiling;
- built server artifact: started and reached its database boundary with external dependencies resolved; local request completion remains incompatible with the repository's existing production-only PostgreSQL SSL requirement;
- typecheck: passed;
- full unit: 526/526 across 48 files;
- lint: 0 errors and 205 warnings, all non-blocking;
- Redis integration: 6/6;
- PostgreSQL integration: 98/98 across 10 files;
- `yarn harness:verify`: passed; its guarded E2E subcommand skipped because `PLAYWRIGHT_FORCE=1` was not set.

## Task 15 completed

Commits: `ac95c41` (task), `ec8937f` and `0ac0472` (two adjacent fixes found in the same working tree).

- `tests/integration/realtime-two-process.test.ts` launches two independent Nuxt processes on
  distinct ports against one shared Redis and Postgres, subscribes an authorized WebSocket client
  to the same conversation on each, and asserts `message.created` and `message.delivery-status`
  cross the process boundary. It then kills every Redis pubsub client and proves the subscription
  resumes and still delivers.

**The test found a real production defect, and not where Step 2 expected it.** The Redis driver's
`ready` handler already re-subscribes its whole handler map, and the reconnect leg passes against it
unchanged -- retained as evidence, no correction needed there. The defect was in auth:
`server/routes/_ws.ts` authenticates by passing `Authorization: Bearer <session-token>` to
`auth.api.getSession()`, but no bearer plugin was registered, so Better Auth only ever read cookies
and closed every WebSocket with 4001. Confirmed by reverting the plugin and re-running the test,
which fails at `WebSocket did not authenticate`.

**Realtime has therefore never worked in any deployment.** `NotificationBell`'s 30s polling fallback
masked it -- which is exactly why SUP-00-9 warned that fallback was load-bearing. No prior test
caught it because every one of them drove the driver or the channel authorizer directly; this is the
first that drives a real socket against a real running server. Worth assuming, until re-checked, that
anything else validated only at unit level across that seam is equally unproven.

Two adjacent fixes were in the same uncommitted working tree and are committed separately:

- `ec8937f` pins `advanced.useSecureCookies`. Better Auth otherwise picks the `__Secure-` cookie
  prefix from the request protocol, so route-issued cookies and programmatic
  `auth.api.getSession()` calls disagree on the cookie name behind a TLS-terminating proxy. **As
  found in the working tree this regressed production**: it read `baseURL.startsWith('https://')`
  alone, dropping the default chain's `NODE_ENV === 'production'` fallback, so a deploy that left
  BETTER_AUTH_URL unset or HTTP would silently downgrade to plain cookies -- and unlike
  BETTER_AUTH_SECRET, that variable has no production guard. The committed version keeps the
  production fallback explicitly. Covered by `tests/auth-secure-cookie.test.ts` (3 tests: HTTPS
  base URL, plain-HTTP dev, and the production fail-safe).
- `0ac0472` replaces a hardcoded personal Tailscale hostname in `nuxt.config.ts` with
  `NUXT_DEV_ALLOWED_HOSTS`, documented in `.env.example`.

**Gate fragility fixed while here.** The new suite needs Postgres _and_ Redis, but it is collected by
the Postgres guard, which probes only Postgres -- so `harness:verify` would have hard-failed on a
machine with one dependency and not the other, the all-or-nothing outcome the two separate guard
scripts exist to avoid. The suite now self-probes and skips with a stated reason. Both the skip path
(unreachable Redis) and the run path were exercised deliberately.

Validation:

- `yarn harness:verify`: passed;
- typecheck: passed;
- unit: 529/529 across 49 files (up from 526/526 -- the three secure-cookie tests);
- lint: 0 errors and 205 warnings, all non-blocking;
- Redis integration: 6/6;
- PostgreSQL integration: 99/99 across 11 files (up from 98/98 across 10);
- focused two-process realtime: 1/1, and 1 skipped on the deliberate unreachable-Redis path;
- `prettier --check --end-of-line=auto`: clean on every changed file;
- guarded E2E: skipped, because `harness:verify` does not set `PLAYWRIGHT_FORCE=1`. Task 15 changed
  no user-facing UI, but it did change auth plugin registration -- see the resume order.

## Task 16 completed

Commits: `6a89fe2` (observability), `1069580` (the E2E harness defects it uncovered).

- `server/utils/support-observability.ts` is now the only sanctioned way to emit a support metric.
  All eight names are wired: delivery queued/sent/delivered/failed/bounced/uncorrelated and
  attachment expired/cleanup_failed.
- Counters come from logs (no metrics backend here; both target platforms build log-based counters),
  so the log line is a contract: closed metric-name set, allowlisted fields, validated at the
  boundary, never throwing. `recipient` is deliberately excluded -- it looks harmless, it is contact
  PII, and no counter needs it.
- Counting sits where state actually changed. Delivered/bounced are behind the guarded update, so a
  redelivered provider event cannot double-count; sent/failed are guarded on claim ownership, so a
  worker that lost its lease cannot count another attempt's outcome. `queued` fires inside the
  caller's transaction and is an upper bound under rollback -- stated in the code, not hidden.
- `tests/delivery-route-observability.test.ts` is beyond the planned file list, added because
  `support.delivery.uncorrelated` is an alert rather than a statistic and nothing proved the route
  counted its own result.

Validation: harness:docs valid; typecheck passed; unit **577/577 across 51 files**; lint **0 errors,
206 warnings**; Redis integration **6/6**; PostgreSQL integration **99/99 across 11 files**;
`yarn build` green in 39.4s; `git diff --check` clean; `yarn harness:verify` all gates passed.

### The E2E gate now actually runs

Support suite: **28 passed, 2 skipped, 0 failed**, via the full documented path, repeatable. Getting
there required fixing that path, and the defects are worth knowing about:

1. **The worktree base URL was `127.0.0.1`.** Better Auth scopes session cookies to
   `Domain=.localhost`, and a client correctly discards that cookie for a bare IP. Sign-in returned
   200 and everything after it was unauthenticated. Reproduced with curl: `localhost` 200,
   `127.0.0.1` 401.
2. **`dev:worktree` never bound the worktree port.** Nuxt ignores PORT/NUXT_PORT here and yarn was
   not forwarding `--port`, so an orphaned worker from an earlier run held the port while each new
   server landed on 3001, 3002, 3003 — meaning **tests can run against another worktree's code and
   another database while appearing to pass**. Fixed via a `%PORT%` substitution in `worktree-run`.
3. **`helpers/auth.ts` defaulted to port 4913**, which matches no configured port anywhere.

**Two specs executed for the first time ever and pass:** `support-conversation-flow.spec.ts`
(SUP-02-17, blocked by delta D-33) and the `support-outbound-reply.spec.ts` round trip (SUP-04-11,
always credential-skipped). The latter needed the same team-admin promote/restore the inbound spec
got in Task 11 — it failed the moment it first ran.

**Every E2E failure encountered was environmental; none were code defects.** The decisive signal came
only from a freshly created and seeded database — a long-lived audit database accumulates fixture
residue that produces failures which look like regressions. Recreate the database before trusting an
E2E result.

**Provider validation is entirely unexecuted.** See
[`stage-01-04-provider-checklist.md`](stage-01-04-provider-checklist.md): every row is `pending` or
`unavailable`. None of the numbers above are evidence that email works against a real provider.

## Final Review Gate completed

Full detail is in the implementation plan's "Final Review Gate — outcome" section. In short:

**0 Critical, 3 Important, 6 Minor.** All three Important fixed in `ddb1716`, plus one Minor that
contradicted a contract this branch introduced. The three Important were: the attachment upload proxy
holding a pooled connection across a 10 MB body and two storage calls (ten slow uploads exhaust the
default 10-connection pool); a delivery killed on its final attempt stranded beyond the reach of both
the claim predicate and manual retry; and — my own regression from `ac95c41` — the global `bearer()`
plugin turning the realtime session token, which the client puts in a WebSocket URL query string, into
a credential for the entire API.

**Two caveats on the gate itself, both worth carrying forward.** The reviewer ran on an available model
because the plan's `gpt-5.6-luna` does not exist here, so independence is lower than specified. And the
reviewer explicitly did not examine the Vue UI changes (~2,500 lines), the E2E suites, Task 14's Docker
and CI changes, or the OpenAPI surface. Those are unreviewed, not cleared.

**All five Minor findings are also fixed** (`3375287`): the capability payload no longer defaults an
unassigned member to `agent`, the shared tag list requires support-team access, contact locking moved
from a `team` row `FOR UPDATE` to `pg_advisory_xact_lock` (the row lock conflicted with the
`FOR KEY SHARE` twelve child tables take on FK checks), and an insecure-cookie configuration now warns
at startup.

**One is resolved as documentation, deliberately.** The delivery-correlation fallback is dead by
construction — the outbox's operator-chosen account key and the provider's own reported identifier
come from unrelated sources, and `providerMessageId` is never populated on the SMTP path. Fixing it
blind would replace a dead fallback with a wrong one, so `.env.example` states the requirement and
checklist rows 2.3a/2.3b/3.1a verify it. **That finding is closed only when those rows pass against a
live account.**

Post-fix: `yarn harness:verify` green (unit 582/582 across 51 files, Redis 6/6, PostgreSQL 101/101
across 11 files), support E2E 28 passed / 2 skipped / 0 failed, run twice consecutively on a fresh
database.

**Known test-isolation weakness, not a product bug.** `support-contact-timeline.spec.ts` keys fixtures
on the shared seed email, so an aborted run leaves residue that fails the _next_ run and then clears —
an alternating fail/pass that reads like product flakiness. It predates this branch. Recreate the
database before trusting any E2E result, and treat a single failure in that spec as suspect until
reproduced from a clean database.

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

`yarn build` is green with `NODE_OPTIONS=--max-old-space-size=4096`. The earlier transformed third-party-code failure did not reproduce on this machine. A separate Nitro 2.11.12/Yarn dependency-tracing `ELOOP` was reproduced in normal and profiler builds, then corrected for self-hosted output while leaving cloud tracing enabled.

## Resume order

Tasks 1-16 and the Final Review Gate are done. What remains is integration.

1. Confirm this branch/worktree and run `yarn harness:context`.
2. Start Postgres and Valkey. **Create a fresh database rather than reusing one** — residue in a
   long-lived database causes failures that look like regressions.
3. Before any E2E run, check nothing is listening on the worktree port (`ss -ltnp | grep <port>`) and
   kill orphaned workers — killing the `nuxi.mjs` parent leaves the `_dev` child holding the socket.
4. Merge or rebase onto `support-platform`. The target has two later documentation commits
   (`c3c19b1`, `5b82348`) not yet in this branch. Run `yarn harness:verify` after.
5. Decide on the five deferred Minor findings recorded in the implementation plan.
6. Carry `stage-01-04-provider-checklist.md` to whoever has provider credentials. It is the only
   remaining validation, it is entirely unexecuted, and one deferred finding is blocked on it.

## Other worktrees and branches at handoff

At the time of this note, the main worktree, the three `t3code/*` worktrees, the review worktree, and `D:\veerify-agent1` were clean. The following preservation pushes were completed:

- `review/stage-01-04-audit` to `origin/review/stage-01-04-audit`;
- `support-platform` through `5b82348` to `origin/support-platform`;
- `sleekplan-export` through `bb30ea5` to `origin/sleekplan-export`;
- `agent1/stage-02` through `06d7be2` to `origin/agent1/stage-02`.

Every commit reachable from a local branch is also reachable from at least one remote ref. Local `main` was not pushed because its 25 commits are already preserved on `origin/support-platform`; updating protected/integration `origin/main` would be a separate release decision. Platform-owned `refs/t3/checkpoints/*` were not pushed as product branches. The disposable detached `stage-01-04-baseline` worktree was verified to contain no unique work and removed.
