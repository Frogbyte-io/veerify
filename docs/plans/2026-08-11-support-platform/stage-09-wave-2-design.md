# Stage 09 Wave 2 — Reliable volume reporting

Status: deferred out of MVP by user direction. Implementation has not started; do not dispatch.
Retained as a future design reference, not an approved implementation requirement or launch gate.

The MVP does not need a durable reporting queue, source-write invalidation, calendar generations,
or cross-writer reporting locks. Revisit only after actual reporting demand and query-performance
evidence justify them. Keep existing tested foundations; do not build a replacement dashboard now.

Original base: `024cf4d` on `support-platform`. The user previously approved the architectural approach:
PostgreSQL day records, atomic invalidation, authorized reads, and resumable scheduled work.
That approval is superseded by the MVP deferral above. This is a retained design reference only.

## Outcome and boundaries

Agents can request created/resolved/reopened volume for their accessible inboxes. Team admins
can request team-wide reports and queue historical recomputation. A missing or stale calculation
must never look like a measured zero, and recorded status events must not imply complete history.
Changing hosting provider must not lose queued work or require a different reporting algorithm.

Reuse Wave 1's calendar and counting semantics from [the delivery plan](stage-09-delivery-plan.md).
No reporting UI, CSV, duration metrics, new provider adapters, or live infrastructure changes are
included. Critical support jobs retain their existing minute/five-minute schedules.

## Chosen approach

Use PostgreSQL for completion records and pending work, alongside the existing metric buckets.
This makes source writes and invalidation one atomic transaction and needs no additional broker.
Pure live historical queries avoid stale caches but repeat expensive work for every request.
A separate Redis queue adds cross-store consistency and recovery obligations without improving
this first reporting slice. Neither alternative is selected.

Initial operating defaults are a 30-calendar-date automatic backfill, the existing 366-date
request maximum, and a five-minute catch-up poll. These are bounded processing defaults, not
source-data retention limits. Admin requests can queue older ranges in successive bounded requests.

## Persistent state

| Record                  | Identity and responsibilities                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team reporting state    | One row per team; current timezone, monotonic calendar generation, next date to discover, next eligible sweep time, nullable verified status-history start           |
| Volume day              | Unique team/calendar-generation/timezone/local-date/metric-version; pending or complete state, computed timestamp, retry count, next attempt, sanitized failure code |
| Existing metric buckets | The three null-agent metrics for each inbox/date/timezone, published atomically with a completion record                                                             |

Metric version starts at `volume-v1`. A missing day has no record. A pending day with no prior
computed timestamp is unprocessed; pending with a prior computed timestamp is dirty. Complete
means the buckets were successfully calculated, including when there are no inboxes. It does
not assert that all historical source events exist.

The day record itself is the durable queue item; do not add a second queue with duplicate state.
Use team foreign keys with cascade deletion, unique identities, valid-state constraints, and an
index supporting due pending work. Keep the existing bucket ownership constraints. New tables,
constraints, and source indexes require generated migrations owned by one task.

Buckets lack generation/version columns today. A completion record is therefore usable only for
the team's current generation and the running metric version. Calendar changes invalidate all
earlier generations, including a later change back to a previously used timezone. Only the current
generation may publish buckets; historical records are audit state, not reusable cache entries.
Mixed reporting-version workers are not supported in the initial rollout.

## Atomic publication and invalidation

Use one parameterized PostgreSQL advisory transaction lock per team for reporting coordination.
All participating source writers, timezone changes, recomputation, and reporting initialization
acquire it before source-row or existing support coordination locks. For transactions touching
multiple teams, acquire reporting locks in stable team-ID order first. Never acquire a reporting
lock for the first time from a helper after the caller has locked a conversation.

This deliberately serializes a team's source mutations against one-day calculations. It is a
correctness-first choice for the current small-team workload; query-plan evidence and bounded
transactions are required to keep the write delay acceptable. Do not hold this lock during network
calls, provider delivery, or an entire multi-day backfill. A finer-grained protocol requires a
separate concurrency review rather than changing lock order independently in worker tasks.

A source writer reads the current reporting calendar after taking the lock. In the same transaction
as the source change, it upserts affected day records to pending and makes them eligible for retry.
Creation affects the local date of `createdAt`; a transition affects the local date of `occurredAt`.
No-op status patches do not create events or dirty work. A failed source transaction commits neither
the source nor the invalidation. A new invalidation resets failure backoff for that day.

The recomputer takes the team lock, verifies current generation/version, and computes one closed
local day using Wave 1's single source-count statement at read-committed isolation. It atomically
replaces only its three null-agent metrics and marks that day complete. Refactor the Wave 1 service
to accept the caller's transaction; do not publish buckets in one transaction and completion in
another. Every public recompute entry point must use this protocol.

If a source change commits first, recomputation sees it. If recomputation commits first, the later
source change marks the day dirty. Rollback restores both buckets and completion state. No
persisted running state or lease is necessary while one transaction holds the work lock.

### Writer integration map

- Manual creation: `server/api/support/conversations/index.post.ts`.
- Inbound creation/reopen: `server/api/support/inbound/[provider].post.ts`.
- Manual status changes: `server/api/support/conversations/[id].patch.ts`.
- Shared event write: `recordConversationStatusEvent` in `server/utils/conversation-activity.ts`.
- Shared transition caller: automation in `server/utils/automation-engine.ts`; acquire the reporting
  lock at the owning transaction boundary, not after its other locks.
- Timezone changes: `server/api/support/teams/[teamId]/settings.put.ts`; reporting lock precedes
  the existing contact-team lock.

The implementation audit must cover every call to the shared transition helper and every direct
conversation/status-event insert, delete, or ownership/timestamp update before exposing the API.
Current Wave 1 joins status events to conversation ownership: future moves/deletes must invalidate
all affected creation and transition dates in both old and new scopes. Future importers must use
the same transaction contract. Direct SQL imports without invalidation are unsupported.
Inbox lifecycle changes must also preserve completeness: a newly created empty inbox is a known
zero in a complete team-day, while data-bearing moves cannot inherit that zero rule.

## Calendar changes and recovery

Under the same team lock, a timezone change increments the calendar generation, resets discovery
to the default backfill window, and makes the old generation ineligible for reads or execution.
Changing unrelated settings does not reset reporting. Lazy reporting-state initialization uses the
persisted team timezone, or UTC when no settings row exists; it must not race a settings update.

Automatic discovery enumerates actual local calendar dates, skipping nonexistent interior dates.
It persists its cursor in the same transaction as inserting pending day records and never queues
today as a historical day. A restart resumes from that cursor, including after downtime exceeding
30 days; the 30-day default applies only to initial discovery and calendar reset.

The scheduler processes at most 20 day attempts per invocation and stops starting new work after
20 seconds. Each attempt has a five-second database statement timeout; each transaction handles
one date. Use nonblocking team-lock acquisition for background work so a busy team does not hold
up other teams. Rotate teams using persistent next-eligible time and a stable team-ID tie-breaker.
Discovery and processing both use bounded batches; neither scans or materializes every team/date.

Failed calculations stay pending, with exponential retry starting at one minute and capped at
one hour. Store error codes, not raw SQL, credentials, or message content. Record failure metadata
only if the same generation is still pending; never overwrite another worker's successful result.
A process crash rolls back publication and leaves retryable work. A permanently failing date must
not prevent other due dates or teams from progressing. Log attempted/completed/failed counts.

Register the same five-minute task through the existing scheduler abstraction, Nitro adapter, and
authenticated cron HTTP adapter. Add both deployment manifests' wiring and parity tests. One
scheduler owner remains the deployment rule; database coordination additionally makes duplicate
invocations safe. Daily aggregates do not mean every support job should run once per day.

## Authorized API and response semantics

`GET /api/support/teams/[teamId]/reports/volume` accepts optional `from`, `to`, and `inboxId`.
Use `requireAuth`, `requireSupportTeamRole(..., 'agent')`, and current inbox membership/ownership.
Team admins may read all team inboxes. Everyone else is limited to their assigned inboxes,
regardless of their highest role in another inbox. Reject an explicit foreign or inaccessible
inbox; do not silently substitute all inboxes. Re-evaluate permissions on every request and
disable shared response caching. A request begun after revocation must not retain old access.

Resolve dates with Wave 1's range helper against one captured `now` and the persisted timezone;
clients cannot select arbitrary timezone or metric version. Translate validation failures to
structured 400 responses. Read authorization, reporting state, completion rows, and buckets from
one consistent database snapshot. Filter every data query to authorized inboxes, not only the
final response. Do not issue one live historical query per requested day.

Return `timezone`, `from`, `to`, `generatedAt`, per-date/per-inbox values, scoped totals, and coverage:

- Historical complete days provide numeric counts; absent or dirty calculations provide null
  values and an explicit `missing` or `dirty` calculation state. Never serve old dirty numbers as
  current data. A complete team-day with no row for an inbox created after that day's computation
  contributes zero only when no later source invalidation exists. Missing rows for an older inbox
  are incomplete data, not zero; require all three metric rows before returning its numbers.
- Today uses the shared source query with exclusive end `min(dayEnd, now)`, without writing buckets.
  Label it `live`. Never add a persisted today bucket to the live result.
- Totals sum available values and are explicitly labeled partial when requested days are missing
  or dirty. Include available/requested day counts; an entirely unavailable total is null, not zero.
- Calculation coverage and source-history coverage are separate. Creation counts measure retained
  conversation rows. Resolution/reopen counts measure recorded transitions. Before a verified
  status-history start, mark those metrics `recorded-only`, even for successfully calculated days.
  For a date straddling the coverage start, retain the partial-history label for the whole day.

The verified history start is nullable and is never inferred from the earliest event or migration
timestamp. Setting it requires release evidence that all production writers use the audited event
and invalidation paths with old instances stopped. Until then, recorded-only reporting is usable
but must not claim complete status history. Imported historical completeness is outside this wave.

`POST /api/support/teams/[teamId]/reports/recompute` requires `requireTeamAdmin`, validates the same
date range, and atomically enqueues at most 366 closed dates for the current calendar. It returns
202 with accepted range/timezone and queued-day count after commit; today is excluded and reported
as live-only. Repeated requests coalesce onto the same day records rather than duplicate jobs.
Apply the existing strict rate-limit policy per user/team. Return structured failures, not a
successful response when enqueueing failed. GET coverage is the initial progress interface.

## Verification and release gates

1. Generated migration validation, uniqueness/ownership checks, and representative seeded
   `EXPLAIN (ANALYZE, BUFFERS)` for creation, status, bucket, and pending-work queries. Add the missing
   conversation team/created-date index if the measured query requires it; do not force index use.
2. Real-Postgres tests for source-before-worker and worker-before-source races, rollback after
   bucket deletion, duplicate invocations, busy-team fairness, failure backoff, and restart cursors.
3. Timezone A → B → A, concurrent settings/source writes, DST, skipped dates, empty teams, new empty
   inboxes, and source changes dated outside the default window.
4. Route tests for unauthenticated callers, revoked memberships, foreign inbox IDs, malformed ranges,
   non-admin recompute, duplicate enqueue, all-missing/partly-missing results, and today counted once.
5. Coverage tests proving a complete calculation does not invent pre-event history. Mixed-generation
   buckets and completion records must never be combined into an apparently complete response.
6. Scheduler adapter/auth tests, generated API documentation where required, and the full repository
   harness after each sequential integration. No UI changes are planned; report guarded skips.

Deploy the additive schema before new code. Keep reporting exposure disabled until writer hooks,
coordination, and query-plan gates are all integrated. Stop old writers before enabling the new
reporting process. Introduce `SUPPORT_REPORTING_ENABLED`, default false, as a server-side exposure
gate: disabled report routes return 503 and the reporting scheduler does no work. Writer invalidation
remains active regardless of this flag. Document the variable in `.env.example` during implementation;
never use it to disable other support workers. Rollback to old writers invalidates completion assumptions: disable reporting
exposure and reinitialize the generation before re-enabling it. No live rollout is authorized by
this specification alone.

## Implementation ownership and review handoff

The implementation plan will sequence four reviewable slices: schema/state and index evidence;
atomic writer hooks and day publication; authorized reads/enqueue; bounded scheduler/recovery.
Luna workers use high reasoning and isolated worktrees. One owner controls schema/migrations,
shared transaction interfaces, and lock ordering. Only genuinely disjoint work runs in parallel;
integration and database validation are sequential on `support-platform`, never `main`.

This document defines the design, not completed implementation tasks. Written-spec review precedes
the executable implementation plan and worker dispatch.
