# Stage 09 reporting foundation

This is the first implementation slice of [Stage 09](stage-09-reporting.md).
The complete reporting dashboard remains subsequent work.

Implemented: daily bucket schema and migration `0036_lovely_tattoo`, calendar utilities,
six calendar tests, and four Postgres integration tests. Luna implementation and independent review
completed; the main Stage 09 checklist tracks the remaining jobs, endpoints, and UI.

The follow-up status-event slices are complete in migrations `0037_dazzling_forgotten_one` and
`0038_swift_masque`; they record structured transitions for PATCH, inbound reopen, and automation
status changes in the same transaction as status activity, while preserving events when actors are
deleted.

## Global constraints

- Preserve inbox authorization boundaries when future endpoints consume rollups.
- Historical rollups and today's live window must use the same calendar and metric definitions.
- Never average daily averages or daily percentiles to compute a range metric.
- Store additive values and sample counts. Duration percentiles require a separate distribution design.
- Do not claim historical resolution/reopen events from mutable `conversation.resolvedAt` alone.
- Use generated Drizzle migrations and the repository validation harness.

## Task 1: Persist daily metric buckets and define reporting calendars

Implement the database and pure calendar foundation only. No scheduler, HTTP routes, or UI in this task.

1. Add `supportMetricDaily` in `server/database/schema/support.ts`: text primary-key id;
   teamId and inboxId foreign keys; nullable agentUserId; date using PostgreSQL date in string mode;
   timezone text; metric text; double-precision value; integer sampleCount; createdAt/updatedAt.
   Scope uniqueness by teamId, inboxId, nullable agentUserId, date, timezone, metric. Use separate
   partial unique indexes for null and non-null agent IDs so null-agent buckets cannot duplicate.
   Agent deletion must cascade attributed buckets rather than converting them into colliding null buckets.
   Require nonnegative sampleCount; values must be finite. Include a team/date range index.
2. Generate a migration with `yarn db:generate`, inspect it, and apply to the local dev database
   using `yarn db:migrate`. Do not hand-edit generated migration files.
3. Add `server/utils/support-reporting-calendar.ts`: `reportingDateAt(instant, timezone)` returns
   YYYY-MM-DD; `reportingDayBounds(date, timezone)` returns UTC `start`/`end` for the half-open local
   calendar day. Validate real dates and IANA timezones; explicitly support reporting years 1900–9998.
   Reject instants/dates outside that documented range. Handle DST days with 23/25 hours and UTC+13.
   Reject calendar dates that do not exist in that timezone rather than silently returning another day.
   Use existing installed date utilities if suitable; do not add dependencies without a demonstrated need.
4. Add meaningful unit tests for UTC, UTC+13, DST spring/fall, leap dates, invalid dates/timezones,
   and a skipped calendar day. Add a Postgres integration test proving nullable-bucket uniqueness,
   independent dimensions, sample-count constraints, and a same-key upsert replacing values without
   duplicating buckets. Clean up only test-owned rows.
5. Run focused tests and typecheck. Report changes and test evidence to the controller; do not push.

## Subsequent slices

- Define stable event facts for resolution/reopen and attribution before computing volume history.
- Define a team reporting timezone setting and retain scale-specific CSAT meaning (thumbs ratings are 1/2).
- Correct existing CSAT summary inbox scoping and normalization before exposing it as reporting data.
- Implement bounded, idempotent rollup jobs with concurrency protection and admin recomputation.
- Add inbox-scoped reads merging historical rollups with today's bounded live data.
- Add Support reports and CSV export, then speed/SLA/contact metrics with exact mergeable distributions.
