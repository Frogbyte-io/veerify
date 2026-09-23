# Stage 09 first-wave implementation plan

> **Status: COMPLETE.** The reporting-range service shipped in `7da2e12` and the daily-volume
> service shipped in `8612896`. This is a historical execution plan; do not dispatch its unchecked
> task lists again. Wave 2 remains deferred as recorded in the Stage 09 delivery plan.

**Goal:** Establish tested date-range and daily-volume services for the reporting API's next slice.

**Architecture:** Pure calendar parsing is independent of a database-backed daily volume service.
The volume service reads existing immutable status events and replaces only its three null-agent
metrics in one transaction. No scheduler, route, or UI is exposed in this wave.

**Tech Stack:** TypeScript, Drizzle/PostgreSQL, Vitest, existing reporting calendar utilities.

**Spec:** `docs/plans/2026-08-11-support-platform/stage-09-delivery-plan.md`.

## Global constraints

- Base all work on the explicit integration commit supplied by the coordinator; never `main`.
- Workers own only their task files, never TODO, schema, migrations, or shared runtime configuration.
- Use existing dependencies; no fake historical facts, current-assignee attribution, or message scans.
- Use half-open local-day UTC boundaries from `reportingDayBounds`.
- Run focused tests and the full harness, report skips honestly, commit conventional messages.
- Use separate worktrees, no nested subagents; coordinator reviews and integrates sequentially.

## Review focus

- DST and skipped calendar dates must not misbucket source data (task 1 and task 2).
- A terminal-to-terminal transition is not a resolution; repeated reopen cycles count separately (task 2).
- Retry/concurrent recomputation must not double counts or erase unrelated metrics (task 2).
- Forged or inconsistent team/inbox ownership must not contaminate a rollup (task 2).
- Missing buckets and missing pre-event history must not be presented as complete reports (deferred
  exposure to wave 2; neither first-wave service is an authorized public interface).

### Task 1: SUP-09-1 strict reporting ranges

**Files:** Create `server/utils/support-reporting-range.ts` and `tests/support-reporting-range.test.ts`.

**Interface:** Export `resolveReportingRange(input: { from?: string; to?: string; timezone: string;
now?: Date }): ReportingRange`. Export `ReportingRange` with `from`, `to`, `timezone` strings,
`start`, `end` Dates, and `days: Array<{ date: string; start: Date; end: Date }>`.
`end` is the exclusive end of the requested last day, not clipped to now; later live reads clip it.
No database or request-handler imports.

- [ ] Write failing tests for exact `YYYY-MM-DD`, impossible/leap dates, reversed ranges, invalid
      timezone/now, future end dates, inclusive 366-day limit and rejection at 367 days, year bounds,
      UTC+13, 23/25-hour days, and Apia's absent 2011-12-30 as endpoint versus interior date.
      Default `to` is local today; default `from` is 29 civil dates before the resolved `to`.
      An inferred endpoint that is itself absent is rejected just like an explicit endpoint.
      One supplied endpoint leaves the other subject to these defaults and normal validation.

```ts
const range = resolveReportingRange({
  from: '2026-03-08',
  to: '2026-03-08',
  timezone: 'America/New_York',
  now: new Date('2026-03-10T12:00:00Z'),
})
expect(range.start.toISOString()).toBe('2026-03-08T05:00:00.000Z')
expect(range.end.toISOString()).toBe('2026-03-09T04:00:00.000Z')
expect(range.days.map((day) => day.date)).toEqual(['2026-03-08'])
```

- [ ] Run `yarn vitest run tests/support-reporting-range.test.ts` and confirm the missing behavior.
- [ ] Implement using `reportingDateAt`/`reportingDayBounds`. Validate date strings before using
      UTC calendar arithmetic to enumerate labels (not instants). Count the 366 limit in civil date
      labels before omitting nonexistent interior dates. Do not swallow arbitrary RangeErrors as
      skipped dates. Utility validation errors are `RangeError`, matching the existing calendar helper;
      future API wrappers will translate them to structured 400 responses.
- [ ] Run focused tests, format the two files, run `yarn harness:verify`, and commit
      `feat(reports): validate reporting calendar ranges`. Report exact counts and guard skips.

### Task 2: SUP-09-2 daily volume service

**Files:** Create `server/utils/support-reporting-volume.ts` and
`tests/integration/support-reporting-volume.test.ts`. No schema or scheduler changes.

**Interface:** Export `readSupportVolumeDay(input: { teamId: string; date: string;
timezone: string }): Promise<SupportVolumeBucket[]>` and
`recomputeSupportVolumeDay(input: { teamId: string; date: string; timezone: string }):
Promise<SupportVolumeBucket[]>`. Export `SupportVolumeBucket` with `inboxId: string`,
`created: number`, `resolved: number`, `reopened: number`. Stable ascending inbox-ID order.
Return each currently owned inbox, including zero counts; no API authorization is implied.

Storage metric keys are exactly `conversations_created`, `conversations_resolved`,
`conversations_reopened`, with `agentUserId: null`, `value: count`, `sampleCount: count`.
The reader performs no writes. The recomputer uses the same source counting implementation with
its transaction executor; do not import task 1's range module.

- [ ] Seed unique test-owned organizations/teams/inboxes/contacts/conversations and status events.
      Demonstrate date-boundary exclusion, another team's rows, zero inboxes, zero-valued owned inboxes,
      terminal-group semantics, two complete resolve/reopen cycles, null initial events, and source
      rows whose denormalized team disagrees with the inbox or conversation. Such rows must not count.

```ts
const result = await recomputeSupportVolumeDay({ teamId, date: '2026-03-08', timezone: 'America/New_York' })
expect(result).toEqual([{ inboxId, created: 1, resolved: 2, reopened: 1 }])
// Repeat and run concurrently, then assert exactly three null-agent stored rows with these counts.
// Add an unrelated metric and an agent bucket first: both must survive recomputation.
```

- [ ] Run the focused integration test with reachable local Postgres; confirm missing behavior.
- [ ] Implement grouped SQL counts in bounded date predicates, joining owned inboxes and, for
      status events, the conversation's matching team/inbox. Created counts use conversation.createdAt.
      Status counts use occurredAt and the metric definitions in the delivery plan. Do not read message
      bodies or load individual source rows into JavaScript. Return numeric counts, not PG count strings.
- [ ] Recompute inside a transaction. Acquire `pg_advisory_xact_lock(hashtextextended(key, 0))`
      with a parameterized unambiguous key such as `JSON.stringify(['support-volume-v1', teamId,
date, timezone])` before reading sources and writing. Use read-committed isolation and a single
      SQL source-count statement (grouped subqueries/CTEs) after acquiring the lock, so all counts share
      a statement snapshot without retaining a stale snapshot while waiting for the lock.
      Replace only these metric keys, for this team/date/timezone and
      null agent. Atomic delete+insert is acceptable; preserve other metrics, agents, dates, timezones,
      and teams. Validate bounds before deleting anything. A failure must roll back the replacement.
- [ ] Test successive source changes, concurrent identical requests, unrelated-bucket preservation,
      invalid-date rejection leaving existing data intact, a UTC+13 or DST boundary, and clean up only
      fixture-owned rows. The runtime reader must not create daily buckets.
- [ ] Format task files; run focused integration and `yarn harness:verify`; commit
      `feat(reports): recompute daily conversation volume`. Report exact counts and guard skips.

## Integration and handoff

Both tasks are independent and may run concurrently in separate worktrees. Review their actual
diffs and test evidence, integrate task 1 then task 2, run the harness after each integration, and
check off SUP-09-1/2 only after passing. This completes wave 1, not the reporting stage. Wave 2 owns
API exposure, authorization, coverage metadata, missing-day markers, scheduling, and invalidation.
