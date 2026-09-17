import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { teamMember, organization, team, user } from '../../server/database/schema/auth'
import {
  automationRule,
  automationRuleRun,
  contact,
  conversation,
  conversationTag,
  supportCompany,
  supportInbox,
  supportTag,
} from '../../server/database/schema/support'
import { runAutomationRules, runTimeBasedAutomationSweep } from '../../server/utils/automation-engine'

const ids = {
  org: `automation_engine_org_${randomUUID()}`,
  team: `automation_engine_team_${randomUUID()}`,
  user: `automation_engine_user_${randomUUID()}`,
  inbox: `automation_engine_inbox_${randomUUID()}`,
  company: `automation_engine_company_${randomUUID()}`,
  contact: `automation_engine_contact_${randomUUID()}`,
  conversation: `automation_engine_conversation_${randomUUID()}`,
  tag: `automation_engine_tag_${randomUUID()}`,
  matchRule: `automation_engine_match_rule_${randomUUID()}`,
  dryRunRule: `automation_engine_dry_run_rule_${randomUUID()}`,
  loopRule: `automation_engine_loop_rule_${randomUUID()}`,
  failureRule: `automation_engine_failure_rule_${randomUUID()}`,
  timeRule: `automation_engine_time_rule_${randomUUID()}`,
}

const now = new Date()

beforeAll(async () => {
  await db.insert(organization).values({
    id: ids.org,
    name: 'Automation engine test org',
    slug: `automation-engine-${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(team).values({
    id: ids.team,
    name: 'Automation engine test team',
    slug: `automation-engine-team-${randomUUID()}`,
    organizationId: ids.org,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(user).values({
    id: ids.user,
    name: 'Automation engine agent',
    email: `automation-engine-${randomUUID()}@example.com`,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(teamMember).values({
    id: `automation_engine_membership_${randomUUID()}`,
    teamId: ids.team,
    userId: ids.user,
    role: 'member',
    createdAt: now,
  })
  await db.insert(supportInbox).values({
    id: ids.inbox,
    teamId: ids.team,
    name: 'Automation engine inbox',
    slug: `automation-engine-inbox-${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(supportCompany).values({
    id: ids.company,
    teamId: ids.team,
    name: 'Enterprise Co',
    domain: `automation-${randomUUID()}.example.com`,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(contact).values({
    id: ids.contact,
    teamId: ids.team,
    companyId: ids.company,
    name: 'Automation Customer',
    email: `automation-customer-${randomUUID()}@example.com`,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(supportTag).values({
    id: ids.tag,
    teamId: ids.team,
    name: 'Escalated',
    createdAt: now,
  })
  await db.insert(conversation).values({
    id: ids.conversation,
    inboxId: ids.inbox,
    teamId: ids.team,
    contactId: ids.contact,
    displayId: 1,
    status: 'open',
    priority: 'high',
    subject: 'Automation test conversation',
    createdAt: now,
    updatedAt: now,
  })
})

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, ids.org))
})

describe('automation engine (real Postgres)', () => {
  it('matches company and priority, applies actions, and audits the run', async () => {
    await db.insert(automationRule).values({
      id: ids.matchRule,
      teamId: ids.team,
      inboxId: ids.inbox,
      name: 'Enterprise escalation',
      trigger: 'conversation_created',
      conditions: {
        all: [
          { field: 'company', value: ids.company },
          { field: 'priority', value: 'high' },
        ],
      },
      actions: [
        { type: 'set_status', status: 'pending' },
        { type: 'add_tag', tagId: ids.tag },
      ],
      createdAt: now,
      updatedAt: now,
    })

    const result = await runAutomationRules({
      conversationId: ids.conversation,
      trigger: 'conversation_created',
    })
    const [updated] = await db
      .select({ status: conversation.status })
      .from(conversation)
      .where(eq(conversation.id, ids.conversation))
    const [tag] = await db
      .select({ tagId: conversationTag.tagId })
      .from(conversationTag)
      .where(and(eq(conversationTag.conversationId, ids.conversation), eq(conversationTag.tagId, ids.tag)))
    const [run] = await db.select().from(automationRuleRun).where(eq(automationRuleRun.ruleId, ids.matchRule))

    expect(result.evaluations.find((evaluation) => evaluation.ruleId === ids.matchRule)?.status).toBe('applied')
    expect(updated?.status).toBe('pending')
    expect(tag?.tagId).toBe(ids.tag)
    expect(run?.status).toBe('applied')
  })

  it('dry-runs actions without changing conversation state or writing runs', async () => {
    await db.insert(automationRule).values({
      id: ids.dryRunRule,
      teamId: ids.team,
      inboxId: ids.inbox,
      name: 'Dry run tag',
      trigger: 'conversation_updated',
      conditions: {},
      actions: [{ type: 'add_tag', tagId: ids.tag }],
      createdAt: now,
      updatedAt: now,
    })

    const result = await runAutomationRules({
      conversationId: ids.conversation,
      trigger: 'conversation_updated',
      dryRun: true,
    })
    const runs = await db.select().from(automationRuleRun).where(eq(automationRuleRun.ruleId, ids.dryRunRule))

    expect(result.evaluations.find((evaluation) => evaluation.ruleId === ids.dryRunRule)?.actions).toEqual([
      { type: 'add_tag', tagId: ids.tag },
    ])
    expect(runs).toHaveLength(0)
  })

  it('records cascade truncation and keeps later actions after a failure', async () => {
    await db.insert(automationRule).values([
      {
        id: ids.loopRule,
        teamId: ids.team,
        inboxId: ids.inbox,
        name: 'Loop guard',
        trigger: 'conversation_updated',
        conditions: {},
        actions: [{ type: 'set_status', status: 'open' }],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.failureRule,
        teamId: ids.team,
        inboxId: ids.inbox,
        name: 'Failure isolation',
        trigger: 'message_created',
        conditions: {},
        actions: [
          { type: 'call_webhook', url: 'not-a-url' },
          { type: 'add_tag', tagId: ids.tag },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ])

    const loopResult = await runAutomationRules({
      conversationId: ids.conversation,
      trigger: 'conversation_updated',
      maxDepth: 1,
    })
    const failureResult = await runAutomationRules({
      conversationId: ids.conversation,
      trigger: 'message_created',
    })
    const loopRuns = await db.select().from(automationRuleRun).where(eq(automationRuleRun.ruleId, ids.loopRule))
    const [failureRun] = await db.select().from(automationRuleRun).where(eq(automationRuleRun.ruleId, ids.failureRule))

    expect(loopResult.evaluations.some((evaluation) => evaluation.cascadeTruncated)).toBe(true)
    expect(loopRuns.some((run) => run.error?.includes('depth limit'))).toBe(true)
    expect(failureResult.evaluations.find((evaluation) => evaluation.ruleId === ids.failureRule)?.status).toBe('failed')
    expect(failureRun?.appliedActions).toEqual([{ type: 'add_tag', tagId: ids.tag }])
  })

  it('evaluates active conversations from the time-based sweep', async () => {
    await db.insert(automationRule).values({
      id: ids.timeRule,
      teamId: ids.team,
      inboxId: ids.inbox,
      name: 'Time-based priority',
      trigger: 'time_based',
      conditions: {},
      actions: [{ type: 'set_priority', priority: 'urgent' }],
      createdAt: now,
      updatedAt: now,
    })

    const result = await runTimeBasedAutomationSweep()
    const [updated] = await db
      .select({ priority: conversation.priority })
      .from(conversation)
      .where(eq(conversation.id, ids.conversation))

    expect(result.scanned).toBeGreaterThanOrEqual(1)
    expect(result.evaluations).toBeGreaterThanOrEqual(1)
    expect(updated?.priority).toBe('urgent')
  })
})
