# Stage 09 — Reporting

**Depends on:** Stages 02, 06 (and 08 for CSAT metrics). **Blocks:** nothing.

**Goal:** Answer the questions a support lead actually asks — how much volume, how fast, who is
carrying it, and are we hitting our commitments.

Implementation started with the [reporting foundation](stage-09-foundation.md).
The review below identifies prerequisites for the remaining reporting work.

## Plan verification — 2026-09-18

- Daily bucket identity must enforce uniqueness even when agent attribution is null. Store the
  reporting timezone with each date bucket so different calendars cannot silently mix.
- Define one reporting timezone source before enabling jobs or reads. Calendar helpers must handle
  UTC+13, DST, and skipped local dates; fixed 24-hour UTC windows do not meet the acceptance criteria.
- `conversation.resolvedAt` is cleared on reopen. Existing activity messages contain human-readable
  status changes, not structured historical facts. Durable status events are a prerequisite for
  accurate resolved/reopened history; do not infer that history from current state.
- Store additive metric sums and sample counts. Daily averages and percentiles cannot be averaged
  into correct range metrics; speed reporting needs mergeable distributions or retained samples.
- All reporting reads must filter to authorized inboxes, with team admins as the cross-inbox exception.
  The existing CSAT summary checks team support access but does not restrict its rows to accessible inboxes.
- CSAT ratings use 1/2 for thumbs, while the current normalization divides thumbs by 1. Correct that
  definition before using it in rollups. Keep scale-specific distributions and snapshot scale/attribution
  so later survey edits cannot reinterpret historical responses.
- Add source indexes appropriate to each date-bounded job and verify query plans before exposing reads.
  Current message indexes start with conversation ID and do not support arbitrary team/day history scans.

The first slice adds storage and calendar primitives only. Jobs, APIs, dashboard, and export remain open.

## Metrics

| Group    | Metrics                                                                               |
| -------- | ------------------------------------------------------------------------------------- |
| Volume   | Conversations created, resolved, reopened; by inbox, channel, tag, company, over time |
| Speed    | First response time, next response time, resolution time — median and p90, not mean   |
| SLA      | Attainment percentage per policy and per metric; breach count and breach reasons      |
| Agents   | Assigned, resolved, replies sent, median first response, CSAT score                   |
| Contacts | Top contacts and companies by volume; new versus returning                            |
| CSAT     | Score distribution and trend; comment feed                                            |

**Use median and p90, not mean.** One ticket left open over a holiday weekend makes a mean resolution
time meaningless, and support leads know it.

All duration metrics respect business hours and SLA pause, reusing the Stage 06 arithmetic module. There
must be exactly one implementation of "how long did this take" in the codebase.

## Architecture

- **Materialized daily rollups**, not live aggregation. `conversationMessage` is the fastest-growing
  table in the system; a dashboard that scans it will be the first thing to fall over.
- `supportMetricDaily` — `id`, `teamId`, `inboxId`, `agentUserId` (nullable), `date`, `metric`,
  `value`, `sampleCount`. Recomputed nightly on the Stage 00 scheduler, plus an on-demand recompute for
  a date range.
- Today's figures are computed live over a bounded window and merged with historical rollups, so the
  dashboard is current without scanning history.
- CSV export reusing the pattern already established by `server/api/feedback/export.get.ts`.

## UI

Extend the existing `/reports` page with a Support section rather than creating a parallel reporting
surface. Date range picker, inbox and agent filters, and charts. Follow the existing chart conventions in
the codebase; where none exist, keep to a small consistent palette that works in both light and dark
mode.

## Acceptance criteria

1. Dashboard figures match hand-computed values on a seeded dataset, including a conversation spanning a
   business-hours boundary and a paused period.
2. `EXPLAIN` shows no sequential scan on `conversationMessage` for any dashboard query.
3. Rollup recomputation is idempotent — running it twice for the same date yields identical rows.
4. Today's partial data appears without a rollup run.
5. Timezone handling is correct: a team in UTC+13 sees days bucketed by their own calendar.
6. `yarn harness:verify` green on `support-platform`.

## TODO items

- [x] Add `supportMetricDaily` table; generate migration
- [ ] Implement the rollup computation job on the Stage 00 scheduler, reusing the Stage 06 business-hours module; idempotent per date
- [ ] Implement live merge of today's partial window with historical rollups
- [ ] Add volume, speed (median/p90), and SLA attainment metric endpoints
- [ ] Add agent performance and contact/company metric endpoints
- [ ] Add CSAT distribution and trend endpoints
- [ ] Build the Support section on `/reports` with date range, inbox and agent filters, and charts
- [ ] Add CSV export following the existing feedback export pattern
- [ ] Add an on-demand rollup recompute endpoint for a date range, guarded to admins

## Risks

- **Live aggregation.** The single biggest scaling mistake available in this stage. Rollups from the
  start.
- **Duplicate duration logic.** If reporting reimplements business-hours arithmetic, its numbers will
  drift from the SLA badges agents see. Import the Stage 06 module.
- **Timezone bucketing.** Rollups are stored per team calendar day, not UTC day.
