import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  params: { projectId: 'p1', mentionId: 'm1' } as Record<string, string>,
  site: { id: 'site-1', verifiedAt: new Date() } as { id: string } | null,
  access: 'ok' as 'ok' | 'forbidden',
  supportOn: true,
  inbox: { id: 'inbox-1' } as { id: string } | null,
  mentionRow: null as Record<string, unknown> | null,
  existingConversation: null as Record<string, unknown> | null,
  inserts: [] as { table: unknown; values: Record<string, unknown> }[],
  updates: [] as { values: Record<string, unknown>; where: unknown }[],
  selectWhere: [] as unknown[],
  published: [] as unknown[],
  settingsRow: null as { supportEnabled: boolean } | null,
  deniedInboxes: [] as string[],
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (_event: unknown, name: string) => state.params[name])
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
  Object.assign(new Error(input.statusMessage), input)
)

vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { id: 'u1' } })),
}))

vi.mock('~/server/utils/marketing-access', () => ({
  requireMarketingAccess: vi.fn(async () => {
    if (state.access === 'forbidden') throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
    return { project: { id: 'p1', organizationId: 'o1', settings: {} }, organizationId: 'o1' }
  }),
}))

vi.mock('~/server/utils/marketing-mentions', async (importOriginal) => {
  const original = await importOriginal<typeof import('~/server/utils/marketing-mentions')>()
  return {
    ...original,
    requireMentionsSite: vi.fn(async () => {
      if (!state.site) throw Object.assign(new Error('Not Found'), { statusCode: 404 })
      return state.site
    }),
  }
})

vi.mock('~/server/utils/support-access', () => ({
  SUPPORT_INBOX_FORBIDDEN_MESSAGE: 'You do not have access to this support inbox',
  requireInboxAccess: vi.fn(async (inboxId: string) => {
    if (state.deniedInboxes.includes(inboxId)) throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
    return {
      id: inboxId,
      capabilities: { canWorkConversations: true },
    }
  }),
}))

vi.mock('~/server/utils/support-counter', () => ({ allocateConversationDisplayId: vi.fn(async () => 42) }))

vi.mock('~/server/utils/support-realtime', () => ({
  publishConversationEvent: vi.fn(async (input: unknown) => {
    state.published.push(input)
  }),
}))

// Minimal chainable fake of the drizzle surface used by the service.
vi.mock('~/server/database/drizzle', async () => {
  const schema = await import('~/server/database/schema/support')
  const marketing = await import('~/server/database/schema/marketing')
  const feedback = await import('~/server/database/schema/feedback')

  function rowsFor(table: unknown): unknown[] {
    if (table === marketing.mention) return state.mentionRow ? [state.mentionRow] : []
    if (table === schema.conversation) return state.existingConversation ? [state.existingConversation] : []
    if (table === schema.supportInbox) return state.inbox ? [{ id: state.inbox.id, projectId: null }] : []
    if (table === feedback.project) return [{ settings: state.settingsRow ?? {} }]
    if (table === schema.contactIdentity) return [{ contactId: 'system-contact' }]
    return []
  }

  const builder = (table?: unknown) => {
    const chain: Record<string, unknown> = {
      from: (t: unknown) => builder(t),
      where: (w: unknown) => {
        state.selectWhere.push(w)
        return chain
      },
      orderBy: () => chain,
      limit: () => chain,
      for: () => chain,
      then: (resolve: (v: unknown) => unknown) => resolve(rowsFor(table)),
    }
    return chain
  }

  const tx = {
    select: () => builder(),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        state.inserts.push({ table, values })
        return Object.assign(Promise.resolve(), {
          onConflictDoNothing: () => ({ returning: async () => [{ id: 'x' }] }),
        })
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async (where: unknown) => {
          state.updates.push({ values, where })
        },
      }),
    }),
    delete: () => ({ where: async () => {} }),
  }

  return { db: { ...tx, transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } }
})

const escalation = await import('~/server/services/marketing/mentions/escalation')
const handler = (await import('~/server/api/marketing/projects/[projectId]/mentions/[mentionId]/escalate.post'))
  .default as (event: unknown) => Promise<{ data: Record<string, unknown> }>
const schema = await import('~/server/database/schema/support')

const sqlOf = (condition: unknown) => new PgDialect().sqlToQuery(condition as never)

const baseMention = {
  id: 'm1',
  source: 'reddit',
  author: 'bob<script>',
  title: '<img src=x onerror=alert(1)> Acme review',
  excerpt: '<b>Acme</b> is good\n\nsecond line',
  url: 'https://reddit.com/r/x/1',
  conversationId: null,
  termId: null,
}

beforeEach(() => {
  state.params = { projectId: 'p1', mentionId: 'm1' }
  state.site = { id: 'site-1' } as never
  state.access = 'ok'
  state.settingsRow = { supportEnabled: true }
  state.inbox = { id: 'inbox-1' }
  state.mentionRow = { ...baseMention }
  state.existingConversation = null
  state.inserts = []
  state.updates = []
  state.selectWhere = []
  state.published = []
  state.deniedInboxes = []
})

describe('POST escalate gating', () => {
  it('requires marketing access', async () => {
    state.access = 'forbidden'
    await expect(handler({})).rejects.toMatchObject({ statusCode: 403 })
    expect(state.inserts).toHaveLength(0)
  })

  it('returns 409 with a clear message when support is off for the project', async () => {
    state.settingsRow = { supportEnabled: false }
    await expect(handler({})).rejects.toMatchObject({ statusCode: 409 })
    await expect(handler({})).rejects.toMatchObject({
      data: { error: { message: expect.stringContaining('Support is not enabled') } },
    })
    expect(state.inserts).toHaveLength(0)
  })

  it('returns 409 when the project has no support setting (registry default off)', async () => {
    state.settingsRow = null
    await expect(handler({})).rejects.toMatchObject({ statusCode: 409 })
  })

  it('returns 403 when the user can reach no support inbox', async () => {
    state.inbox = null
    await expect(handler({})).rejects.toMatchObject({ statusCode: 403 })
    expect(state.inserts).toHaveLength(0)
  })

  it('returns 404 for a mention that is not on this product site', async () => {
    state.mentionRow = null
    await expect(handler({})).rejects.toMatchObject({ statusCode: 404 })
    expect(state.inserts).toHaveLength(0)
  })

  it('scopes the mention lookup and update to the product site', async () => {
    await handler({})
    const lookup = state.selectWhere.map(sqlOf).find((q) => q.sql.includes('"mention"."id"'))!
    expect(lookup.sql).toContain('"mention"."site_id"')
    expect(lookup.params).toEqual(expect.arrayContaining(['m1', 'site-1']))
    const update = sqlOf(state.updates[0].where)
    expect(update.sql).toContain('"mention"."site_id"')
    expect(update.params).toContain('site-1')
  })
})

describe('POST escalate creation', () => {
  it('creates a conversation, a private note, and marks the mention escalated', async () => {
    const result = await handler({})
    expect(result.data).toMatchObject({ inboxId: 'inbox-1', displayId: 42, alreadyEscalated: false })

    const conv = state.inserts.find((i) => i.table === schema.conversation)!.values
    expect(conv).toMatchObject({ inboxId: 'inbox-1', projectId: 'p1', displayId: 42 })
    expect(conv.contactId).toBe('system-contact')

    const message = state.inserts.find((i) => i.table === schema.conversationMessage)!.values
    expect(message).toMatchObject({
      kind: 'note',
      isPrivate: true,
      senderKind: 'agent',
      senderUserId: 'u1',
      deliveryStatus: 'delivered',
      bodyHtml: null,
    })

    expect(state.updates[0].values).toMatchObject({ status: 'escalated', conversationId: conv.id })
    expect(state.updates[0].values.escalatedAt).toBeInstanceOf(Date)
    expect(state.published).toEqual([
      { type: 'conversation.created', projectId: 'p1', inboxId: 'inbox-1', conversationId: conv.id },
    ])
  })

  it('never creates an email contact identity or an outgoing message (no outbound mail)', async () => {
    await handler({})
    expect(state.inserts.filter((i) => i.table === schema.conversationMessage)).toHaveLength(1)
    for (const { table, values } of state.inserts) {
      if (table === schema.contact) expect(values.email).toBeUndefined()
      if (table === schema.contactIdentity) expect(values.kind).not.toBe('email')
      if (table === schema.conversationMessage) expect(values.kind).not.toBe('outgoing')
    }
  })

  it('is idempotent: a second escalation returns the existing conversation and writes nothing', async () => {
    state.mentionRow = { ...baseMention, conversationId: 'conv-1' }
    state.existingConversation = { id: 'conv-1', inboxId: 'inbox-9', displayId: 7 }
    const result = await handler({})
    expect(result.data).toMatchObject({
      conversationId: 'conv-1',
      inboxId: 'inbox-9',
      displayId: 7,
      alreadyEscalated: true,
    })
    expect(state.inserts).toHaveLength(0)
    expect(state.updates).toHaveLength(0)
    expect(state.published).toHaveLength(0)
  })
})

describe('id exposure', () => {
  it('returns ids for a new escalation, with escalated: true', async () => {
    const result = await handler({})
    expect(result.data).toMatchObject({ escalated: true, conversationId: expect.any(String), inboxId: 'inbox-1' })
  })

  it('confirms an existing escalation without ids when the caller cannot open its inbox', async () => {
    state.mentionRow = { ...baseMention, conversationId: 'conv-1' }
    state.existingConversation = { id: 'conv-1', inboxId: 'inbox-9', displayId: 7 }
    state.deniedInboxes = ['inbox-9']
    const result = await handler({})
    expect(result.data).toEqual({ escalated: true, alreadyEscalated: true })
  })

  it('accessibleInboxIds keeps only the inboxes the user can open', async () => {
    const { accessibleInboxIds } = await import('~/server/services/marketing/mentions/escalation')
    state.deniedInboxes = ['b']
    expect([...(await accessibleInboxIds(['a', 'b', 'a'], 'u1'))]).toEqual(['a'])
  })
})

describe('internal note content', () => {
  const item = {
    source: 'reddit',
    author: 'bob',
    title: 'Acme review',
    excerpt: 'Acme is good',
    url: 'https://reddit.com/r/x/1',
    termLabel: 'Acme',
  }

  it('is clearly marked and carries source, author, title, excerpt, link and matched term', () => {
    const note = escalation.buildEscalationNote(item)
    expect(note.split('\n')[0]).toBe('Escalated from Marketing → Mentions')
    expect(note).toContain('Source: Reddit')
    expect(note).toContain('Author: bob')
    expect(note).toContain('Title: Acme review')
    expect(note).toContain('Matched term: Acme')
    expect(note).toContain('Link: https://reddit.com/r/x/1')
    expect(note).toContain('Acme is good')
  })

  it('stores third-party markup as inert plain text, with no HTML body', async () => {
    await handler({})
    const message = state.inserts.find((i) => i.table === schema.conversationMessage)!.values
    expect(message.bodyHtml).toBeNull()
    // the text is kept verbatim in a plain-text field the support UI renders as text
    expect(String(message.body)).toContain('<img src=x onerror=alert(1)> Acme review')
  })

  it('drops non-http links and control characters', () => {
    const note = escalation.buildEscalationNote({
      ...item,
      url: 'javascript:alert(1)',
      author: 'a\u0000b\nc',
      excerpt: 'line1\n\n\nline2',
    })
    expect(note).toContain('Link: (unavailable)')
    expect(note).toContain('Author: a b c')
    expect(note).toContain('line1 line2')
    expect(note).not.toContain('javascript:')
  })

  it('builds a bounded one-line subject', () => {
    const subject = escalation.buildEscalationSubject({ ...item, title: `${'x'.repeat(500)}\nmore` })
    expect(subject.length).toBeLessThanOrEqual(200)
    expect(subject).not.toContain('\n')
    expect(subject.startsWith('Mention on Reddit: ')).toBe(true)
  })
})

describe('canEscalateMentions (list route flag)', () => {
  it('is true when support is on and the user can work an inbox', async () => {
    await expect(escalation.canEscalateMentions('p1', 'u1')).resolves.toBe(true)
  })

  it('is false when support is off', async () => {
    state.settingsRow = { supportEnabled: false }
    await expect(escalation.canEscalateMentions('p1', 'u1')).resolves.toBe(false)
  })

  it('is false when the user has no support inbox access', async () => {
    state.inbox = null
    await expect(escalation.canEscalateMentions('p1', 'u1')).resolves.toBe(false)
  })
})
