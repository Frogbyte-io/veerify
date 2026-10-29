import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

/**
 * Conversations started on a `mail` address, and conversations in Spam or
 * Trash, get no SLA, CSAT survey or automation (auto-reply is covered in
 * auto-reply.test.ts, the inbound path in the integration suite). Each
 * background choke point is checked twice: its query filters such rows out,
 * and a row that slips through anyway is still skipped.
 */

const fake = vi.hoisted(() => ({
  queued: [] as unknown[][],
  wheres: [] as unknown[],
  transaction: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('~/server/database/drizzle', () => {
  const chain = () => {
    const result = fake.queued.shift() ?? []
    const thenable: Record<string, unknown> = {
      from: () => thenable,
      innerJoin: () => thenable,
      leftJoin: () => thenable,
      where: (condition: unknown) => {
        fake.wheres.push(condition)
        return thenable
      },
      orderBy: () => thenable,
      limit: () => Promise.resolve(result),
      then: (...callbacks: Parameters<Promise<unknown>['then']>) => Promise.resolve(result).then(...callbacks),
    }
    return thenable
  }
  return { db: { select: chain, transaction: fake.transaction, insert: fake.insert, update: fake.insert } }
})
vi.mock('~/server/utils/notifications', () => ({ notifyUser: vi.fn() }))
vi.mock('~/server/utils/support-access', () => ({
  listProjectAdminUserIds: vi.fn(async () => []),
  listProjectUserIds: vi.fn(async () => []),
}))
vi.mock('~/server/utils/project-access', () => ({ hasProjectAccess: vi.fn(async () => true) }))
vi.mock('~/server/services/marketing/reviews/hooks', () => ({ onCsatRatingRecorded: vi.fn() }))
vi.mock('~/server/utils/outbound-delivery', () => ({ enqueueOutboundDelivery: vi.fn() }))
vi.mock('~/server/utils/support-realtime', () => ({ publishConversationEvent: vi.fn() }))
vi.mock('~/server/utils/sender-enforcement', () => ({ isSenderAllowedOrRecordBlock: vi.fn(async () => true) }))
vi.mock('~/server/utils/webhook-url', () => ({ postWebhookJson: vi.fn() }))

const { helpdeskAppliesTo } = await import('~/server/utils/conversation-behaviour')
const { resolveSlaAssignment } = await import('~/server/utils/sla-assignment')
const { runSlaBreachSweep } = await import('~/server/utils/sla-sweeper')
const { runCsatDispatchSweep } = await import('~/server/utils/csat')
const { runAutomationRules, runTimeBasedAutomationSweep } = await import('~/server/utils/automation-engine')

const dialect = new PgDialect()
const sqlOf = (condition: unknown) => dialect.sqlToQuery(condition as SQL).sql

/** The helpdesk filter, as it appears in a rendered WHERE clause. */
function expectHelpdeskFilter(condition: unknown) {
  const text = sqlOf(condition)
  expect(text).toContain('"conversation"."behaviour" = $')
  expect(text).toContain('"conversation"."spam_at" is null')
  expect(text).toContain('"conversation"."deleted_at" is null')
}

const NOW = new Date('2026-10-29T12:00:00Z')
const PAST = new Date('2026-10-29T10:00:00Z')

function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1',
    projectId: 'project-1',
    inboxId: 'inbox-1',
    contactId: 'contact-1',
    displayId: 7,
    status: 'resolved',
    priority: null,
    assigneeUserId: null,
    firstResponseAt: null,
    firstResponseDueAt: PAST,
    nextResponseDueAt: null,
    resolutionDueAt: null,
    resolvedAt: PAST,
    updatedAt: PAST,
    lastActivityAt: PAST,
    behaviour: 'helpdesk',
    spamAt: null,
    deletedAt: null,
    ...overrides,
  }
}

const SKIPPED = [
  ['a mail-address conversation', { behaviour: 'mail' }],
  ['a conversation in Spam', { spamAt: PAST }],
  ['a conversation in Trash', { deletedAt: PAST }],
] as const

beforeEach(() => {
  fake.queued.length = 0
  fake.wheres.length = 0
  fake.transaction.mockReset()
  fake.insert.mockReset()
})

describe('helpdeskAppliesTo', () => {
  it('is true only for helpdesk conversations outside Spam and Trash', () => {
    expect(helpdeskAppliesTo({ behaviour: 'helpdesk', spamAt: null, deletedAt: null })).toBe(true)
    // Rows written before the column existed default to helpdesk.
    expect(helpdeskAppliesTo({ behaviour: undefined, spamAt: null, deletedAt: null })).toBe(true)
    for (const [, overrides] of SKIPPED) {
      expect(helpdeskAppliesTo({ behaviour: 'helpdesk', spamAt: null, deletedAt: null, ...overrides })).toBe(false)
    }
  })
})

describe('SLA assignment', () => {
  const input = {
    projectId: 'project-1',
    inboxId: 'inbox-1',
    priority: null,
    companyId: null,
    tagIds: [],
    start: NOW,
  }

  it.each(SKIPPED)('assigns no SLA to %s, without reading policies', async (_label, overrides) => {
    const result = await resolveSlaAssignment({
      ...input,
      conversation: { behaviour: 'helpdesk', spamAt: null, deletedAt: null, ...overrides },
    })
    expect(result).toBeNull()
    expect(fake.wheres).toHaveLength(0)
  })

  it('still reads policies for a helpdesk conversation', async () => {
    fake.queued.push([]) // no policies
    await expect(
      resolveSlaAssignment({ ...input, conversation: { behaviour: 'helpdesk', spamAt: null, deletedAt: null } })
    ).resolves.toBeNull()
    expect(fake.wheres).toHaveLength(1)
  })
})

describe('SLA breach sweep', () => {
  it('filters mail, Spam and Trash conversations out of the candidates', async () => {
    fake.queued.push([])
    await runSlaBreachSweep({ now: NOW })
    expectHelpdeskFilter(fake.wheres[0])
  })

  it.each(SKIPPED)('never breaches or notifies for %s', async (_label, overrides) => {
    fake.queued.push([
      { conversation: conversationRow({ status: 'open', ...overrides }), policy: { id: 'policy-1', escalation: {} } },
    ])
    const result = await runSlaBreachSweep({ now: NOW })
    expect(result).toEqual({ scanned: 1, breached: 0, notifications: 0 })
    expect(fake.transaction).not.toHaveBeenCalled()
  })
})

describe('CSAT dispatch sweep', () => {
  const survey = {
    id: 'survey-1',
    projectId: 'project-1',
    inboxId: null,
    isEnabled: true,
    sendTrigger: 'on_resolve',
    delayMinutes: 0,
    scale: 'csat_5',
    question: 'How did we do?',
    followUpQuestion: null,
    contactCooldownMinutes: 0,
  }
  const candidate = (overrides: Record<string, unknown>) => ({
    conversation: conversationRow(overrides),
    contact: { id: 'contact-1', email: 'ada@example.com', name: 'Ada', attributes: {} },
    inbox: { id: 'inbox-1', emailAddress: 'support@acme.test', fromName: null },
  })

  it('filters mail, Spam and Trash conversations out of the candidates', async () => {
    fake.queued.push([survey], [])
    await runCsatDispatchSweep({ now: NOW })
    expectHelpdeskFilter(fake.wheres[1])
  })

  it.each(SKIPPED)('sends no survey for %s', async (_label, overrides) => {
    fake.queued.push([survey], [candidate(overrides)])
    const result = await runCsatDispatchSweep({ now: NOW })
    expect(result).toEqual({ scanned: 1, sent: 0, skipped: 1 })
    expect(fake.transaction).not.toHaveBeenCalled()
    // Only the survey and candidate reads ran: not even the agent-reply check.
    expect(fake.wheres).toHaveLength(2)
  })
})

describe('automation rules', () => {
  it.each(SKIPPED)('evaluates no rule for %s', async (_label, overrides) => {
    fake.queued.push([{ ...conversationRow({ status: 'open', ...overrides }), companyId: null }], [], [])
    const result = await runAutomationRules({ conversationId: 'conv-1', trigger: 'conversation_created' })
    expect(result.evaluations).toEqual([])
    // Conversation, latest message and tags were read; the rules never were.
    expect(fake.wheres).toHaveLength(3)
  })

  it('reads the rules for a helpdesk conversation', async () => {
    fake.queued.push([{ ...conversationRow({ status: 'open' }), companyId: null }], [], [], [])
    await runAutomationRules({ conversationId: 'conv-1', trigger: 'conversation_created' })
    expect(fake.wheres).toHaveLength(4)
  })

  it('leaves mail, Spam and Trash conversations out of the time-based sweep', async () => {
    fake.queued.push([{ projectId: 'project-1', inboxId: null }], [])
    await runTimeBasedAutomationSweep()
    expectHelpdeskFilter(fake.wheres[1])
  })
})
