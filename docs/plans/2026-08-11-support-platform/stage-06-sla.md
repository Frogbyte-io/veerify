# Stage 06 — Business hours + SLA

**Depends on:** Stages 02, 04. **Blocks:** Stage 09.
**Runs in parallel with Stages 05, 07, 08.**

**Goal:** Response and resolution commitments that respect working hours, with visible countdowns and
breach escalation.

> Outline-level detail. Refine into full step detail when this stage is unblocked — the shape below is
> settled, the specifics of escalation policy are not.

## Schema

- **`businessHours`** — `id`, `teamId`, `name`, `timezone`, `weeklySchedule` (jsonb: per-weekday open and
  close windows), `holidays` (jsonb: dated exclusions), `isDefault`, timestamps.
- **`slaPolicy`** — `id`, `teamId`, `name`, `businessHoursId` (nullable — null means 24/7), `conditions`
  (jsonb: inbox, priority, tag, company), `isDefault`, `sortOrder`, timestamps.
- **`slaTarget`** — `id`, `slaPolicyId`, `metric` (`first_response` | `next_response` | `resolution`),
  `priority`, `targetMinutes`.
- **Columns added to `conversation`** — `slaPolicyId`, `firstResponseDueAt`, `nextResponseDueAt`,
  `resolutionDueAt`, `slaBreachedAt`, `slaPausedAt`, `slaPausedMinutes`.

## Behaviour

- Policy is matched on conversation create and re-evaluated when priority or tags change. First match by
  `sortOrder` wins; `isDefault` is the fallback.
- Due timestamps are computed **in business-hours time**, not wall-clock. A ticket arriving Friday 17:30
  against a 9–17 Mon–Fri schedule with a 4-hour target is due Monday 13:00.
- **Timers pause while `status = 'pending'`** (waiting on the customer) and resume on the next customer
  reply, accumulating into `slaPausedMinutes`. This is the behaviour agents expect from Zendesk and
  getting it wrong makes every SLA number wrong.
- `firstResponseAt` is already stamped by Stage 04.
- A breach sweeper runs on the Stage 00 scheduler (every 5 minutes), stamps `slaBreachedAt`, dispatches
  the `sla_breach` notification, and writes an `activity` message.
- Escalation actions on breach: notify assignee, notify a supervisor, raise priority. Configured per
  policy.

## UI

- Business-hours editor with timezone, weekly grid, and holiday list.
- SLA policy builder: conditions, targets per priority, escalation.
- Countdown badge on the conversation list and thread header — green, amber near due, red on breach.
- A "breaching soon" saved-view filter.

## Acceptance criteria

1. A ticket arriving outside business hours is due at the correct time on the next working day, across a
   DST boundary and across a configured holiday.
2. Moving a conversation to `pending` pauses the timer; a customer reply resumes it, and the paused
   minutes are excluded from elapsed time.
3. The sweeper stamps breach exactly once per conversation per metric — re-running it does not duplicate
   notifications.
4. A conversation with no matching policy and no default has null due dates and is never reported as
   breached.
5. `yarn harness:verify` green on `main`.

## TODO items

- [ ] Add `businessHours`, `slaPolicy`, `slaTarget` tables and SLA columns on `conversation`; generate migration
- [ ] Implement business-hours-aware duration arithmetic (timezone, DST, holidays) as a pure module with heavy unit-test coverage
- [ ] Implement policy matching on create and on priority/tag change, with `sortOrder` precedence and default fallback
- [ ] Implement timer pause on `pending` and resume on customer reply, accumulating `slaPausedMinutes`
- [ ] Implement the breach sweeper on the Stage 00 scheduler with once-only stamping, `sla_breach` notification, and activity message
- [ ] Implement escalation actions (notify assignee, notify supervisor, raise priority) configured per policy
- [ ] Build the business-hours editor UI (timezone, weekly grid, holidays)
- [ ] Build the SLA policy builder UI (conditions, per-priority targets, escalation)
- [ ] Add countdown badges to the conversation list and thread header, and a breaching-soon filter

## Risks

- **Business-hours arithmetic is deceptively hard.** DST transitions, holidays, and midnight-spanning
  windows are all real cases. Build it as a pure, exhaustively unit-tested module with no database
  access.
- **Pause semantics drive every SLA number.** If pause is wrong, all reporting in Stage 09 is wrong.
- **Sweeper duplication.** Breach stamping must be idempotent; the sweeper will re-run over the same rows.
