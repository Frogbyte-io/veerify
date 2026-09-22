# Stage 09 delivery plan

Date: 2026-09-21. Base: `41587d1` on `support-platform`.

## Scope and execution order

The reporting foundation, status events, reporting timezone, and CSAT scale snapshot are implemented.
The dashboard is not. This plan preserves the complete Stage 09 scope while breaking delivery into
reviewable slices. Only wave 1 below is dispatched now; subsequent waves depend on its reviewed
interfaces and the historical-facts gate. Stage 09 remains incomplete until all acceptance criteria
in `stage-09-reporting.md` pass.

The coordinator owns this document, `TODO.md`, shared schema/migrations, scheduler configuration,
and integration. Luna workers use `high` reasoning, isolated worktrees based on an explicit
`support-platform` commit, and non-overlapping files. Integrate one reviewed task at a time, run
`yarn harness:verify`, and only then check off the corresponding TODO. Do not merge into `main`.

## Metric definitions

- Calendar: inclusive `from`/`to` local dates in the persisted team reporting timezone; database
  predicates use half-open UTC intervals. Default to 30 local calendar dates ending today, maximum
  366 dates per request. Reject future end dates, reversed ranges, timestamps in place of date
  strings, invalid dates, and skipped endpoint dates. Interior dates absent from the timezone are
  omitted. Never derive calendar days by subtracting 24-hour intervals from an instant.
- Created: count conversations by `createdAt`; this works for conversations predating status events.
- Resolved: count recorded transitions from `open`, `pending`, or `snoozed` into `resolved` or
  `closed`. `resolved -> closed` is not a second resolution. Initial events with null `fromStatus`
  do not prove a historical resolution and are excluded.
- Reopened: count recorded transitions from `resolved` or `closed` into `open`, `pending`, or
  `snoozed`. Count transitions, not distinct tickets; a ticket may resolve twice after a reopen.
- Team/inbox totals use null-agent buckets. Never sum those with agent-attributed buckets.
- Actor is not assignee: `conversationStatusEvent.actorUserId` identifies who performed a change,
  and cannot supply historical ownership. Do not attribute old resolutions to today's assignee.
- First response: initial incoming message to first successful public human-agent response.
  Next response: first incoming message in each subsequent unanswered customer burst to the next
  successful public human-agent response. Exclude notes, activities, auto-replies, failed sends,
  and delivery retries. Attribute by response completion date and responding agent.
- Resolution duration: creation/reopen to the next terminal-group entry; exclude pending intervals
  within that cycle. Use Stage 06 business-hours arithmetic, with persisted policy/calendar snapshots.
- Durations: minutes, median and p90 using linear interpolation at `(n - 1) * p`. Empty distributions
  return null, never zero. Retain exact samples with stable source identities; never average daily
  percentiles. Business-hours and pause history must be captured before claiming historical accuracy.
- SLA attainment: evaluated successful obligations / all evaluated obligations, separately per policy
  and metric. Open not-yet-due obligations are excluded, breached obligations count once. Capture
  each next-response cycle; the current single breach row per conversation/metric cannot represent
  all historical cycles. Do not interpret absence of a breach row as success.
- CSAT: use response scale snapshots and `respondedAt`; retain scale-specific distributions and
  existing normalization. Late responses invalidate the appropriate historical date.
- Dimensions: inbox and agent initially; channel, tag, contact, and company require event-time
  snapshots or explicit current-dimension labeling. Missing historical attribution is unknown, not
  silently reconstructed from mutable current state.

## Delivery waves and gates

| Wave | Deliverable                                                                       | Depends on                 | Acceptance gate                                                                                    |
| ---- | --------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------- |
| 1    | Strict calendar range helper; transactional daily volume reader/recompute         | Existing foundation        | Unit boundary tests and real-Postgres idempotency/concurrency/isolation tests                      |
| 2    | Authorized volume API, historical/live merge, admin recompute, scheduled catch-up | 1                          | Permission revocation, missing buckets, timezone changes, overlap/restarts, no cross-inbox leakage |
| 3    | Immutable response/SLA/assignment/dimension facts and exact duration samples      | Semantic definitions above | Review all writer paths; generated migrations; old data explicitly marked partial                  |
| 4    | Speed, SLA, agent, contact/company, CSAT reads and rollups                        | 2, 3                       | Seeded hand-calculated figures, retained-sample percentiles, indexed bounded queries               |
| 5    | Support reports UI and CSV export                                                 | 4                          | Playwright filters/team-switch/error/empty states; CSV quoting and formula protection              |

### Wave 2 contracts

The [Wave 2 design](stage-09-wave-2-design.md) specifies persistent state, concurrency,
coverage semantics, and recovery. Its architectural approach is approved; written-spec review
and the executable implementation plan remain before dispatch.

Before API exposure, review the volume query's source indexes (including conversation team/date
filtering), generate any required migration under single-owner schema control, and record
`EXPLAIN (ANALYZE, BUFFERS)` on representative seeded volumes. Wave 1 proves counting correctness,
not production-scale query performance; do not defer this gate until the later metric families.

Routes under `/api/support/teams/[teamId]/reports/`: `volume.get.ts` and `recompute.post.ts`.
Use `requireAuth`, `requireSupportTeamRole`, and explicit inbox ownership/access checks following
the existing CSAT summary. Ordinary agents see only their member inboxes; team admins can see
all team inboxes. Return scoped totals and per-date values with `timezone`, `from`, `to`,
`generatedAt`, and `coverage` metadata. Response shape must distinguish missing historical
coverage from a measured zero. Expose creation counts independently of status-history completeness.

Recompute requires team-admin authority, validates the same range, and queues bounded persistent
work instead of running a year inside an HTTP request. A persistent completion record is required
even for empty dates. Store timezone and metric-definition version in completion identity.
Historical reads consume only completed buckets; today is computed live up to one captured `now`,
never also added from a historical bucket. Invalidation from late events/imports/settings changes
must mark completed dates dirty; scheduler catch-up processes dirty/missing dates with a persisted
cursor and a bounded batch. Retry work after restart. Use the existing scheduler abstraction in
both deployment modes, with one scheduler owner. A periodic catch-up poll can execute daily
rollups when each team's local day completes; it is not a once-daily UTC assumption.

### Historical-facts gate before waves 3–4

The next schema owner must define and review one immutable event/sample contract and enumerate
every writer (manual replies/status/assignment, inbound reopen, automation, future portal/imports).
Current `slaPausedMinutes`, current policy/calendar rows, current tags/company, and mutable
`resolvedAt` are insufficient historical sources. Backfill only facts that can be proven; record a
coverage start/version and return partial coverage for earlier periods. Do not parse activity prose.
Use additive, generated migrations with an explicit deployment lock/backfill assessment.

Own `server/database/schema/support.ts` and `server/database/migrations/**` in one task at a time.
Add source indexes for the actual date/inbox query shapes and inspect `EXPLAIN (ANALYZE, BUFFERS)`
on representative seeded volumes; do not disable sequential scans to manufacture passing evidence.
Business-hours subtraction must reuse `businessMinutesBetween`; pause intervals must be clipped,
unioned, and measured using the same captured calendar before subtracting.

### UI/export contract for wave 5

Extend `pages/reports/index.vue` with a `components/support/SupportReports.vue` section using
Options API. Dates, inbox, and agent filters share the API's semantics; existing feedback reports
remain available. Show real skeleton, retry, empty, and partial-coverage states. Stale responses
must not overwrite a newer team/filter selection. CSV uses the same authorized reporting service,
not independent source queries, and includes timezone, metric units, and coverage information.

## First-wave implementation

See [the executable first-wave plan](stage-09-wave-1-implementation.md). Its tasks have disjoint
file ownership and no new dependency on each other. They intentionally expose no API or UI until
wave 2 supplies authorization and coverage semantics.

## Later stages

09b remains an outline needing task decomposition. Stage 10 needs a reviewed contact-session and
public inbox-routing design. Stage 11 needs the transport/visitor-identity decision after the
hosting choice. Stage 12 needs provider-specific requirements and sandbox access before adapters.
Stage 13 must build the missing import framework before adapters. None of these is dispatched by
this reporting wave.
