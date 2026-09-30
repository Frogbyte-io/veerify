import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'

import { db } from '../../server/database/drizzle'
import { organization, team, user } from '../../server/database/schema/auth'
import { supportInbox, supportMetricDaily } from '../../server/database/schema/support'

const ids = {
  organization: `reporting_org_${randomUUID()}`,
  team: `reporting_team_${randomUUID()}`,
  otherOrganization: `reporting_org_${randomUUID()}`,
  otherTeam: `reporting_team_${randomUUID()}`,
  inbox: `reporting_inbox_${randomUUID()}`,
  secondInbox: `reporting_inbox_${randomUUID()}`,
  otherInbox: `reporting_inbox_${randomUUID()}`,
  agent: `reporting_agent_${randomUUID()}`,
}
const now = new Date()

beforeAll(async () => {
  await db.insert(organization).values({
    id: ids.organization,
    name: 'Reporting Org',
    slug: `reporting-${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(team).values({
    id: ids.team,
    name: 'Reporting Team',
    slug: `reporting-${randomUUID()}`,
    organizationId: ids.organization,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(organization).values({
    id: ids.otherOrganization,
    name: 'Other Reporting Org',
    slug: `reporting-${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(team).values({
    id: ids.otherTeam,
    name: 'Other Reporting Team',
    slug: `reporting-${randomUUID()}`,
    organizationId: ids.otherOrganization,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(user).values({
    id: ids.agent,
    name: 'Reporting Agent',
    email: `reporting-${randomUUID()}@example.com`,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(supportInbox).values({
    id: ids.inbox,
    teamId: ids.team,
    name: 'Reporting Inbox',
    slug: `reporting-${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(supportInbox).values({
    id: ids.secondInbox,
    teamId: ids.team,
    name: 'Reporting Inbox 2',
    slug: `reporting-${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(supportInbox).values({
    id: ids.otherInbox,
    teamId: ids.otherTeam,
    name: 'Other Reporting Inbox',
    slug: `reporting-${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
  })
})

afterAll(async () => {
  await db.delete(user).where(sql`${user.id} = ${ids.agent}`)
  await db.delete(organization).where(sql`${organization.id} = ${ids.organization}`)
  await db.delete(organization).where(sql`${organization.id} = ${ids.otherOrganization}`)
})

afterEach(async () => {
  await db.delete(supportMetricDaily).where(eq(supportMetricDaily.teamId, ids.team))
})

const bucket = (id: string, agentUserId: string | null = null) => ({
  id,
  teamId: ids.team,
  inboxId: ids.inbox,
  agentUserId,
  date: '2026-01-02',
  timezone: 'UTC',
  metric: 'volume',
  value: 2.5,
  sampleCount: 2,
  createdAt: now,
  updatedAt: now,
})

async function expectCheckViolation(operation: Promise<unknown>, constraint: string) {
  try {
    await operation
    throw new Error(`Expected ${constraint} to reject`)
  } catch (error) {
    const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : undefined
    const postgresError =
      cause && typeof cause === 'object'
        ? (cause as Record<string, unknown>)
        : error && typeof error === 'object'
          ? (error as Record<string, unknown>)
          : undefined
    expect(postgresError?.code).toBe('23514')
    expect(postgresError?.constraint).toBe(constraint)
  }
}

async function expectForeignKeyViolation(operation: Promise<unknown>, constraint: string) {
  try {
    await operation
    throw new Error(`Expected ${constraint} to reject`)
  } catch (error) {
    const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : undefined
    const postgresError =
      cause && typeof cause === 'object'
        ? (cause as Record<string, unknown>)
        : error && typeof error === 'object'
          ? (error as Record<string, unknown>)
          : undefined
    expect(postgresError?.code).toBe('23503')
    expect(postgresError?.constraint).toBe(constraint)
  }
}

describe('support metric daily (integration)', () => {
  it('keeps null and attributed buckets unique independently', async () => {
    await db
      .insert(supportMetricDaily)
      .values([bucket(`bucket_${randomUUID()}`), bucket(`bucket_${randomUUID()}`, ids.agent)])
    await expect(db.insert(supportMetricDaily).values(bucket(`bucket_${randomUUID()}`))).rejects.toThrow()
    await expect(db.insert(supportMetricDaily).values(bucket(`bucket_${randomUUID()}`, ids.agent))).rejects.toThrow()
  })

  it('allows independent dimensions and enforces metric value constraints', async () => {
    await db.insert(supportMetricDaily).values(bucket(`bucket_${randomUUID()}`, null))
    await db.insert(supportMetricDaily).values({
      ...bucket(`bucket_${randomUUID()}`),
      inboxId: ids.secondInbox,
      agentUserId: ids.agent,
      date: '2026-01-03',
      timezone: 'America/New_York',
      metric: 'resolution',
    })
    await expectCheckViolation(
      db
        .insert(supportMetricDaily)
        .values({ ...bucket(`bucket_${randomUUID()}`), metric: 'negative-samples', sampleCount: -1 }),
      'support_metric_daily_sample_count_check'
    )
    await expectCheckViolation(
      db.insert(supportMetricDaily).values({ ...bucket(`bucket_${randomUUID()}`), metric: 'nan', value: Number.NaN }),
      'support_metric_daily_finite_value_check'
    )
    await expectCheckViolation(
      db
        .insert(supportMetricDaily)
        .values({ ...bucket(`bucket_${randomUUID()}`), metric: 'positive-infinity', value: Number.POSITIVE_INFINITY }),
      'support_metric_daily_finite_value_check'
    )
    await expectCheckViolation(
      db
        .insert(supportMetricDaily)
        .values({ ...bucket(`bucket_${randomUUID()}`), metric: 'negative-infinity', value: Number.NEGATIVE_INFINITY }),
      'support_metric_daily_finite_value_check'
    )
  })

  it('does not allow a bucket to pair an inbox from another team', async () => {
    await expectForeignKeyViolation(
      db.insert(supportMetricDaily).values({
        ...bucket(`bucket_${randomUUID()}`),
        inboxId: ids.otherInbox,
      }),
      'support_metric_daily_team_inbox_ownership_fk'
    )
  })

  it('keeps the agent foreign key cascading instead of nulling attribution', async () => {
    const constraint = await db.execute<{ delete_action: string }>(sql`select pg_constraint.confdeltype as delete_action
      from pg_constraint join pg_class on pg_class.oid = pg_constraint.conrelid
      where pg_class.relname = 'support_metric_daily' and pg_constraint.conname = 'support_metric_daily_agent_user_id_user_id_fk'`)
    expect(constraint.rows[0]?.delete_action).toBe('c')
  })

  it('updates a same-key bucket using a partial-index upsert', async () => {
    const date = '2026-01-03'
    const first = bucket(`bucket_${randomUUID()}`)
    await db.insert(supportMetricDaily).values({ ...first, date })
    await db.execute(sql`insert into support_metric_daily (id, team_id, inbox_id, date, timezone, metric, value, sample_count, created_at, updated_at)
      values (${`bucket_${randomUUID()}`}, ${ids.team}, ${ids.inbox}, ${date}, 'UTC', 'volume', 9, 4, now(), now())
      on conflict (team_id, inbox_id, date, timezone, metric) where agent_user_id is null
      do update set value = excluded.value, sample_count = excluded.sample_count, updated_at = excluded.updated_at`)
    const rows = await db.execute<{ value: number; sample_count: number }>(
      sql`select value, sample_count from support_metric_daily where team_id = ${ids.team} and inbox_id = ${ids.inbox} and date = ${date} and timezone = 'UTC' and metric = 'volume' and agent_user_id is null`
    )
    expect(rows.rows).toEqual([{ value: 9, sample_count: 4 }])
  })
})
