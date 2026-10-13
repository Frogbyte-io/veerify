import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { asc, eq, sql } from 'drizzle-orm'
import { db } from '../../server/database/drizzle'
import { organization, team, user } from '../../server/database/schema/auth'
import {
  contact,
  conversation,
  conversationStatusEvent,
  supportInbox,
  supportMetricDaily,
} from '../../server/database/schema/support'
import { readSupportVolumeDay, recomputeSupportVolumeDay } from '../../server/utils/support-reporting-volume'

const randomUuidMock = vi.hoisted(() => {
  const generate = () => globalThis.crypto.randomUUID()
  return { fn: vi.fn(generate) }
})

vi.mock('node:crypto', async () => ({
  ...(await vi.importActual<typeof import('node:crypto')>('node:crypto')),
  randomUUID: randomUuidMock.fn,
}))

const suffix = globalThis.crypto.randomUUID()
const ids = {
  organization: `volume_org_${suffix}`,
  team: `volume_team_${suffix}`,
  otherOrganization: `volume_other_org_${suffix}`,
  otherTeam: `volume_other_team_${suffix}`,
  inbox: `volume_inbox_${suffix}`,
  zeroInbox: `volume_zero_inbox_${suffix}`,
  otherInbox: `volume_other_inbox_${suffix}`,
  contact: `volume_contact_${suffix}`,
  otherContact: `volume_other_contact_${suffix}`,
  conversation: `volume_conversation_${suffix}`,
  outsideConversation: `volume_outside_conversation_${suffix}`,
  mismatchedConversation: `volume_mismatched_conversation_${suffix}`,
  otherConversation: `volume_other_conversation_${suffix}`,
  agent: `volume_agent_${suffix}`,
  otherTeamMetric: `volume_other_team_metric_${suffix}`,
  otherDateMetric: `volume_other_date_metric_${suffix}`,
  otherTimezoneMetric: `volume_other_timezone_metric_${suffix}`,
}

const date = '2026-03-08'
const timezone = 'America/New_York'

const metricKeys = ['conversations_created', 'conversations_resolved', 'conversations_reopened'] as const

function sourceConversation(
  id: string,
  teamId: string,
  inboxId: string,
  contactId: string,
  displayId: number,
  createdAt: string
) {
  return {
    id,
    teamId,
    inboxId,
    contactId,
    displayId,
    status: 'open',
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
  }
}

function statusEvent(
  id: string,
  conversationId: string,
  teamId: string,
  inboxId: string,
  fromStatus: string | null,
  toStatus: string,
  occurredAt: string
) {
  return {
    id,
    conversationId,
    teamId,
    inboxId,
    fromStatus,
    toStatus,
    actorUserId: null,
    occurredAt: new Date(occurredAt),
    createdAt: new Date(occurredAt),
  }
}

describe('support reporting volume (real Postgres)', () => {
  beforeAll(async () => {
    await db.insert(organization).values([
      { id: ids.organization, name: 'Volume Org', slug: `volume-${suffix}` },
      { id: ids.otherOrganization, name: 'Other Volume Org', slug: `other-volume-${suffix}` },
    ])
    await db.insert(team).values([
      { id: ids.team, name: 'Volume Team', slug: `volume-${suffix}`, organizationId: ids.organization },
      {
        id: ids.otherTeam,
        name: 'Other Volume Team',
        slug: `other-volume-${suffix}`,
        organizationId: ids.otherOrganization,
      },
    ])
    await db.insert(user).values({
      id: ids.agent,
      name: 'Volume Agent',
      email: `volume-${suffix}@example.com`,
    })
    await db.insert(supportInbox).values([
      { id: ids.inbox, teamId: ids.team, name: 'Volume Inbox', slug: `volume-${suffix}` },
      { id: ids.zeroInbox, teamId: ids.team, name: 'Zero Inbox', slug: `zero-${suffix}` },
      { id: ids.otherInbox, teamId: ids.otherTeam, name: 'Other Inbox', slug: `other-${suffix}` },
    ])
    await db.insert(contact).values([
      { id: ids.contact, teamId: ids.team, name: 'Volume Contact' },
      { id: ids.otherContact, teamId: ids.otherTeam, name: 'Other Contact' },
    ])
    await db.insert(conversation).values([
      // 06:00Z is 01:00 local on the DST transition date and is included.
      sourceConversation(ids.conversation, ids.team, ids.inbox, ids.contact, 1, '2026-03-08T06:00:00.000Z'),
      // 04:59Z is before the local date and is excluded.
      sourceConversation(ids.outsideConversation, ids.team, ids.inbox, ids.contact, 2, '2026-03-08T04:59:00.000Z'),
      // This row disagrees with its inbox's denormalized team and is excluded.
      sourceConversation(
        ids.mismatchedConversation,
        ids.team,
        ids.otherInbox,
        ids.contact,
        3,
        '2026-03-08T07:00:00.000Z'
      ),
      // Another team's source row is excluded.
      sourceConversation(
        ids.otherConversation,
        ids.otherTeam,
        ids.otherInbox,
        ids.otherContact,
        4,
        '2026-03-08T07:00:00.000Z'
      ),
    ])
    await db.insert(conversationStatusEvent).values([
      statusEvent(
        `${ids.conversation}_initial`,
        ids.conversation,
        ids.team,
        ids.inbox,
        null,
        'resolved',
        '2026-03-08T06:10:00.000Z'
      ),
      statusEvent(
        `${ids.conversation}_resolve_1`,
        ids.conversation,
        ids.team,
        ids.inbox,
        'open',
        'resolved',
        '2026-03-08T07:00:00.000Z'
      ),
      // resolved -> closed stays in the terminal group and is not another resolution.
      statusEvent(
        `${ids.conversation}_close_1`,
        ids.conversation,
        ids.team,
        ids.inbox,
        'resolved',
        'closed',
        '2026-03-08T07:10:00.000Z'
      ),
      statusEvent(
        `${ids.conversation}_reopen`,
        ids.conversation,
        ids.team,
        ids.inbox,
        'closed',
        'pending',
        '2026-03-08T08:00:00.000Z'
      ),
      statusEvent(
        `${ids.conversation}_resolve_2`,
        ids.conversation,
        ids.team,
        ids.inbox,
        'pending',
        'closed',
        '2026-03-08T09:00:00.000Z'
      ),
      // This event's denormalized team disagrees with its conversation and is excluded.
      statusEvent(
        `${ids.conversation}_wrong_team`,
        ids.conversation,
        ids.otherTeam,
        ids.inbox,
        'closed',
        'open',
        '2026-03-08T10:00:00.000Z'
      ),
      // This event's denormalized inbox disagrees with its conversation and is excluded.
      statusEvent(
        `${ids.conversation}_wrong_inbox`,
        ids.conversation,
        ids.team,
        ids.otherInbox,
        'closed',
        'open',
        '2026-03-08T10:01:00.000Z'
      ),
      // This source row belongs to the other team and is excluded.
      statusEvent(
        `${ids.otherConversation}_resolve`,
        ids.otherConversation,
        ids.otherTeam,
        ids.otherInbox,
        'open',
        'resolved',
        '2026-03-08T07:00:00.000Z'
      ),
    ])
  })

  afterAll(async () => {
    await db
      .delete(supportMetricDaily)
      .where(
        sql`${supportMetricDaily.id} in (${ids.otherTeamMetric}, ${ids.otherDateMetric}, ${ids.otherTimezoneMetric})`
      )
    await db.delete(supportMetricDaily).where(eq(supportMetricDaily.teamId, ids.team))
    await db
      .delete(conversation)
      .where(
        sql`${conversation.id} in (${ids.conversation}, ${ids.outsideConversation}, ${ids.mismatchedConversation}, ${ids.otherConversation}, ${`volume_added_${suffix}`})`
      )
    await db.delete(contact).where(sql`${contact.id} in (${ids.contact}, ${ids.otherContact})`)
    await db.delete(supportInbox).where(sql`${supportInbox.id} in (${ids.inbox}, ${ids.zeroInbox}, ${ids.otherInbox})`)
    await db.delete(user).where(eq(user.id, ids.agent))
    await db.delete(team).where(sql`${team.id} in (${ids.team}, ${ids.otherTeam})`)
    await db.delete(organization).where(sql`${organization.id} in (${ids.organization}, ${ids.otherOrganization})`)
  })

  it('recomputes owned inbox volume with DST bounds and preserves unrelated buckets', async () => {
    await db.insert(supportMetricDaily).values([
      {
        id: `unrelated_${suffix}`,
        teamId: ids.team,
        inboxId: ids.inbox,
        agentUserId: null,
        date,
        timezone,
        metric: 'unrelated_metric',
        value: 42,
        sampleCount: 7,
      },
      {
        id: `agent_${suffix}`,
        teamId: ids.team,
        inboxId: ids.inbox,
        agentUserId: ids.agent,
        date,
        timezone,
        metric: 'conversations_created',
        value: 99,
        sampleCount: 99,
      },
      {
        id: ids.otherTeamMetric,
        teamId: ids.otherTeam,
        inboxId: ids.otherInbox,
        agentUserId: null,
        date,
        timezone,
        metric: 'conversations_created',
        value: 11,
        sampleCount: 11,
      },
      {
        id: ids.otherDateMetric,
        teamId: ids.team,
        inboxId: ids.inbox,
        agentUserId: null,
        date: '2026-03-07',
        timezone,
        metric: 'conversations_created',
        value: 12,
        sampleCount: 12,
      },
      {
        id: ids.otherTimezoneMetric,
        teamId: ids.team,
        inboxId: ids.inbox,
        agentUserId: null,
        date,
        timezone: 'UTC',
        metric: 'conversations_created',
        value: 13,
        sampleCount: 13,
      },
    ])

    const result = await recomputeSupportVolumeDay({ teamId: ids.team, date, timezone })
    expect(result).toEqual([
      { inboxId: ids.inbox, created: 1, resolved: 2, reopened: 1 },
      { inboxId: ids.zeroInbox, created: 0, resolved: 0, reopened: 0 },
    ])

    const beforeRead = await db
      .select()
      .from(supportMetricDaily)
      .where(eq(supportMetricDaily.teamId, ids.team))
      .orderBy(asc(supportMetricDaily.id))
    expect(await readSupportVolumeDay({ teamId: ids.team, date, timezone })).toEqual(result)
    expect(
      await db
        .select()
        .from(supportMetricDaily)
        .where(eq(supportMetricDaily.teamId, ids.team))
        .orderBy(asc(supportMetricDaily.id))
    ).toEqual(beforeRead)

    await Promise.all([
      recomputeSupportVolumeDay({ teamId: ids.team, date, timezone }),
      recomputeSupportVolumeDay({ teamId: ids.team, date, timezone }),
    ])
    const replaced = await db
      .select({
        inboxId: supportMetricDaily.inboxId,
        metric: supportMetricDaily.metric,
        value: supportMetricDaily.value,
        sampleCount: supportMetricDaily.sampleCount,
      })
      .from(supportMetricDaily)
      .where(
        sql`${supportMetricDaily.teamId} = ${ids.team} and ${supportMetricDaily.date} = ${date} and ${supportMetricDaily.timezone} = ${timezone} and ${supportMetricDaily.agentUserId} is null`
      )
    const replacementRows = replaced.filter((row) => metricKeys.includes(row.metric as (typeof metricKeys)[number]))
    expect(replacementRows).toHaveLength(6)
    expect(replacementRows.filter((row) => row.inboxId === ids.inbox)).toEqual(
      expect.arrayContaining([
        { inboxId: ids.inbox, metric: 'conversations_created', value: 1, sampleCount: 1 },
        { inboxId: ids.inbox, metric: 'conversations_resolved', value: 2, sampleCount: 2 },
        { inboxId: ids.inbox, metric: 'conversations_reopened', value: 1, sampleCount: 1 },
      ])
    )
    expect(replacementRows.filter((row) => row.inboxId === ids.zeroInbox)).toEqual(
      expect.arrayContaining(
        metricKeys.map((metric) => ({
          inboxId: ids.zeroInbox,
          metric,
          value: 0,
          sampleCount: 0,
        }))
      )
    )
    expect(
      await db
        .select({ metric: supportMetricDaily.metric })
        .from(supportMetricDaily)
        .where(eq(supportMetricDaily.id, `unrelated_${suffix}`))
    ).toEqual([{ metric: 'unrelated_metric' }])
    expect(
      await db
        .select({ value: supportMetricDaily.value })
        .from(supportMetricDaily)
        .where(eq(supportMetricDaily.id, `agent_${suffix}`))
    ).toEqual([{ value: 99 }])
    expect(
      await db
        .select({ id: supportMetricDaily.id, value: supportMetricDaily.value })
        .from(supportMetricDaily)
        .where(
          sql`${supportMetricDaily.id} in (${ids.otherTeamMetric}, ${ids.otherDateMetric}, ${ids.otherTimezoneMetric})`
        )
    ).toEqual(
      expect.arrayContaining([
        { id: ids.otherTeamMetric, value: 11 },
        { id: ids.otherDateMetric, value: 12 },
        { id: ids.otherTimezoneMetric, value: 13 },
      ])
    )

    const beforeFailedReplacement = await db
      .select()
      .from(supportMetricDaily)
      .where(eq(supportMetricDaily.teamId, ids.team))
      .orderBy(asc(supportMetricDaily.id))
    randomUuidMock.fn.mockImplementationOnce(() => `unrelated_${suffix}`)
    await expect(recomputeSupportVolumeDay({ teamId: ids.team, date, timezone })).rejects.toThrow()
    expect(
      await db
        .select()
        .from(supportMetricDaily)
        .where(eq(supportMetricDaily.teamId, ids.team))
        .orderBy(asc(supportMetricDaily.id))
    ).toEqual(beforeFailedReplacement)

    await db
      .insert(conversation)
      .values(
        sourceConversation(`volume_added_${suffix}`, ids.team, ids.inbox, ids.contact, 5, '2026-03-08T11:00:00.000Z')
      )
    expect(await readSupportVolumeDay({ teamId: ids.team, date, timezone })).toEqual([
      { inboxId: ids.inbox, created: 2, resolved: 2, reopened: 1 },
      { inboxId: ids.zeroInbox, created: 0, resolved: 0, reopened: 0 },
    ])
    const updated = await recomputeSupportVolumeDay({ teamId: ids.team, date, timezone })
    expect(updated[0]).toEqual({ inboxId: ids.inbox, created: 2, resolved: 2, reopened: 1 })
    await db.delete(conversation).where(eq(conversation.id, `volume_added_${suffix}`))

    const storedBeforeInvalid = await db
      .select()
      .from(supportMetricDaily)
      .where(eq(supportMetricDaily.teamId, ids.team))
      .orderBy(asc(supportMetricDaily.id))
    await expect(recomputeSupportVolumeDay({ teamId: ids.team, date: '2026-02-30', timezone })).rejects.toThrow()
    expect(
      await db
        .select()
        .from(supportMetricDaily)
        .where(eq(supportMetricDaily.teamId, ids.team))
        .orderBy(asc(supportMetricDaily.id))
    ).toEqual(storedBeforeInvalid)
  })
})
