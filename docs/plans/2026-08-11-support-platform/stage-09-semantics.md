# Stage 09 reporting semantics contract

Status: **COMPLETE** (commit `cc37da1`; Luna review passed)

Before materialized rollups, reporting needs two durable definitions: the team calendar used to bucket
dates and the survey scale that gave a response its meaning. Both must survive later settings edits.

## Task 1: Persist reporting timezone and CSAT response scale

1. Add `reportingTimezone` to `supportTeamSettings`, defaulting to `UTC` for existing and new rows.
   Expose it through the team settings GET/PUT routes; validate it as an IANA timezone using the
   reporting calendar utility. Existing clients that only send `autoLinkFeedback` must continue to
   work.
2. Add a scale snapshot to `csatResponse`, populate it from the survey when dispatching a response,
   and make authenticated CSAT summaries read the response snapshot rather than the mutable survey
   scale. Backfill existing rows from their survey in the generated migration; document that this is
   the best available recovery for rows whose survey was edited before the migration.
3. Add focused unit/integration coverage for timezone validation/defaults, UTC+13/DST calendar use,
   response scale snapshot after survey mutation, and summary normalization. No rollup job or UI in
   this slice.
4. Run focused tests, typecheck, and the full harness.

## Constraints

- Use generated Drizzle migrations only.
- Never use a mutable survey scale to reinterpret historical response rows after this change.
- Do not silently fall back to a fixed UTC day in new reporting code; UTC is only the explicit default
  for teams without a settings row.
- Preserve existing settings API callers and public CSAT rating values.
