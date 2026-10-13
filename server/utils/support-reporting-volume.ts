import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'

import { db } from '~/server/database/drizzle'
import { supportMetricDaily } from '~/server/database/schema/support'
import { reportingDayBounds } from '~/server/utils/support-reporting-calendar'

export interface SupportVolumeBucket {
  inboxId: string
  created: number
  resolved: number
  reopened: number
}

export interface SupportVolumeDayInput {
  teamId: string
  date: string
  timezone: string
}

type QueryExecutor = Pick<typeof db, 'execute'>

interface VolumeSourceRow extends Record<string, unknown> {
  inbox_id: string
  created: number | string
  resolved: number | string
  reopened: number | string
}

const METRIC_KEYS = ['conversations_created', 'conversations_resolved', 'conversations_reopened'] as const

function validateInput(input: SupportVolumeDayInput): { bounds: { start: Date; end: Date }; key: string } {
  if (!input || typeof input !== 'object') throw new RangeError('Volume input is required')
  if (typeof input.teamId !== 'string' || input.teamId.length === 0) throw new RangeError('Team is required')
  if (typeof input.date !== 'string' || typeof input.timezone !== 'string') {
    throw new RangeError('Date and timezone are required')
  }

  // This validates both the calendar date and the IANA timezone before any
  // replacement write can occur. The returned interval is half-open UTC.
  const bounds = reportingDayBounds(input.date, input.timezone)
  return {
    bounds,
    key: JSON.stringify(['support-volume-v1', input.teamId, input.date, input.timezone]),
  }
}

async function readSourceCounts(
  executor: QueryExecutor,
  input: SupportVolumeDayInput,
  bounds: { start: Date; end: Date }
): Promise<SupportVolumeBucket[]> {
  const result = await executor.execute<VolumeSourceRow>(sql`
    with created_counts as (
      select c.inbox_id, count(*)::int as created
      from conversation c
      inner join support_inbox source_inbox
        on source_inbox.id = c.inbox_id
       and source_inbox.team_id = c.team_id
      where c.team_id = ${input.teamId}
        and c.created_at >= ${bounds.start}
        and c.created_at < ${bounds.end}
      group by c.inbox_id
    ),
    status_counts as (
      select e.inbox_id,
        count(*) filter (
          where e.from_status in ('open', 'pending', 'snoozed')
            and e.to_status in ('resolved', 'closed')
        )::int as resolved,
        count(*) filter (
          where e.from_status in ('resolved', 'closed')
            and e.to_status in ('open', 'pending', 'snoozed')
        )::int as reopened
      from conversation_status_event e
      inner join conversation c
        on c.id = e.conversation_id
       and c.team_id = e.team_id
       and c.inbox_id = e.inbox_id
      inner join support_inbox source_inbox
        on source_inbox.id = e.inbox_id
       and source_inbox.team_id = e.team_id
      where e.team_id = ${input.teamId}
        and e.occurred_at >= ${bounds.start}
        and e.occurred_at < ${bounds.end}
      group by e.inbox_id
    )
    select owned.id as inbox_id,
      coalesce(created_counts.created, 0)::int as created,
      coalesce(status_counts.resolved, 0)::int as resolved,
      coalesce(status_counts.reopened, 0)::int as reopened
    from support_inbox owned
    left join created_counts on created_counts.inbox_id = owned.id
    left join status_counts on status_counts.inbox_id = owned.id
    where owned.team_id = ${input.teamId}
    order by owned.id asc
  `)

  return result.rows.map((row) => ({
    inboxId: row.inbox_id,
    created: Number(row.created),
    resolved: Number(row.resolved),
    reopened: Number(row.reopened),
  }))
}

export async function readSupportVolumeDay(input: SupportVolumeDayInput): Promise<SupportVolumeBucket[]> {
  const { bounds } = validateInput(input)
  return readSourceCounts(db, input, bounds)
}

export async function recomputeSupportVolumeDay(input: SupportVolumeDayInput): Promise<SupportVolumeBucket[]> {
  const { bounds, key } = validateInput(input)

  return db.transaction(
    async (tx) => {
      // The lock is acquired before the source statement. At READ COMMITTED,
      // the aggregate gets a fresh statement snapshot after any prior holder
      // commits, rather than retaining a snapshot taken while waiting.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
      const buckets = await readSourceCounts(tx, input, bounds)

      const metricSql = sql.join(
        METRIC_KEYS.map((metric) => sql`${metric}`),
        sql`, `
      )
      await tx.execute(sql`
        delete from support_metric_daily
        where team_id = ${input.teamId}
          and date = ${input.date}
          and timezone = ${input.timezone}
          and agent_user_id is null
          and metric in (${metricSql})
      `)

      if (buckets.length > 0) {
        await tx.insert(supportMetricDaily).values(
          buckets.flatMap((bucket) => [
            {
              id: randomUUID(),
              teamId: input.teamId,
              inboxId: bucket.inboxId,
              agentUserId: null,
              date: input.date,
              timezone: input.timezone,
              metric: 'conversations_created',
              value: bucket.created,
              sampleCount: bucket.created,
            },
            {
              id: randomUUID(),
              teamId: input.teamId,
              inboxId: bucket.inboxId,
              agentUserId: null,
              date: input.date,
              timezone: input.timezone,
              metric: 'conversations_resolved',
              value: bucket.resolved,
              sampleCount: bucket.resolved,
            },
            {
              id: randomUUID(),
              teamId: input.teamId,
              inboxId: bucket.inboxId,
              agentUserId: null,
              date: input.date,
              timezone: input.timezone,
              metric: 'conversations_reopened',
              value: bucket.reopened,
              sampleCount: bucket.reopened,
            },
          ])
        )
      }

      return buckets
    },
    { isolationLevel: 'read committed' }
  )
}
