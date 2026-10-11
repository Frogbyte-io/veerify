import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Draft = Record<string, any>

const state = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  body: {} as unknown,
  query: {} as Record<string, unknown>,
  access: 'on' as 'on' | 'forbidden',
  limited: false,
  dbLimited: false,
  dbLimits: [] as Array<{ teamId: string; key: string; limit: number }>,
  queue: [] as unknown[][],
  drafts: new Map<string, Record<string, any>>(),
  deleted: [] as unknown[],
  llm: vi.fn(),
  llmInputs: [] as string[],
  rateLimits: [] as unknown[],
  wheres: [] as unknown[],
}))

const httpError = (statusCode: number, message = String(statusCode)) =>
  Object.assign(new Error(message), { statusCode, data: { error: { message } } })

vi.stubGlobal('defineEventHandler', (h: unknown) => h)
vi.stubGlobal('getRouterParam', (_e: unknown, name: string) => state.params[name])
vi.stubGlobal('getQuery', () => state.query)
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('getRequestURL', () => new URL('https://app.veerify.test'))
vi.stubGlobal('useRuntimeConfig', () => ({ public: { appDomain: 'veerify.test' } }))
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string }) =>
  Object.assign(new Error(input.statusMessage), input)
)

vi.mock('h3', () => ({
  createError: (input: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(input.statusMessage), input),
}))

vi.mock('~/server/utils/auth-middleware', () => ({ requireAuth: vi.fn(async () => ({ user: { id: 'u1' } })) }))

vi.mock('~/server/utils/marketing-access', () => ({
  requireMarketingAccess: vi.fn(async (projectId: string) => {
    if (state.access === 'forbidden') throw httpError(403, 'Forbidden')
    return {
      project: {
        id: projectId,
        teamId: 't1',
        name: 'Acme',
        description: 'Feedback tool',
        slug: 'acme',
        customDomain: null,
        settings: { changelogEnabled: true },
      },
      teamId: 't1',
    }
  }),
}))

vi.mock('~/server/utils/rate-limit', () => ({
  requireRateLimit: vi.fn(async (_e: unknown, config: unknown) => {
    state.rateLimits.push(config)
    if (state.limited) throw httpError(429)
  }),
}))

vi.mock('~/server/utils/marketing-db-limit', () => ({
  dayStamp: () => '2026-10-10',
  requireDbLimit: vi.fn(async (teamId: string, key: string, limit: number) => {
    state.dbLimits.push({ teamId, key, limit })
    if (state.dbLimited) throw httpError(429)
    return { allowed: true, remaining: limit - 1 }
  }),
}))

vi.mock('~/server/utils/response', () => ({
  createSuccessResponse: (data: unknown) => ({ success: true, data }),
  createErrorResponse: (code: string, message: string) => ({ success: false, error: { code, message } }),
  ErrorCode: {
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    NOT_FOUND: 'NOT_FOUND',
    CONFLICT: 'CONFLICT',
    RATE_LIMITED: 'RATE_LIMITED',
  },
}))

vi.mock('~/server/services/marketing/llm-call', () => ({
  failWith: (statusCode: number, statusMessage: string, code: string, message: string) => {
    throw Object.assign(new Error(statusMessage), {
      statusCode,
      statusMessage,
      data: { success: false, error: { code, message } },
    })
  },
  callTeamLlm: (...args: unknown[]) => state.llm(...args),
}))

vi.mock('~/server/utils/team-credentials', () => ({
  listTeamCredentials: vi.fn(async () => [{ provider: 'anthropic', status: 'valid' }]),
}))

vi.mock('~/server/database/drizzle', () => {
  const chain = () => {
    const c: Record<string, unknown> = {}
    for (const m of ['from', 'innerJoin', 'orderBy', 'limit']) c[m] = () => c
    c.where = (cond: unknown) => {
      state.wheres.push(cond)
      return c
    }
    c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(state.queue.shift() ?? []).then(resolve, reject)
    return c
  }
  return {
    db: {
      select: () => chain(),
      insert: () => ({
        values: (v: Draft) => ({
          onConflictDoUpdate: ({ set }: { set: Draft }) => ({
            returning: async () => {
              const key = `${v.entryId}:${v.channel}`
              const existing = state.drafts.get(key)
              const row = existing
                ? { ...existing, ...set }
                : { createdAt: new Date(), updatedAt: new Date(), provider: null, model: null, ...v }
              state.drafts.set(key, row)
              return [row]
            },
          }),
        }),
      }),
      delete: () => ({
        where: async (cond: unknown) => {
          state.deleted.push(cond)
        },
      }),
    },
  }
})

const service = await import('~/server/services/marketing/announcements/service')
const { GenerationOutputError } = await import('~/server/services/marketing/announcements/prompt')
const listGet = (await import('~/server/api/marketing/projects/[projectId]/announcements/index.get')).default
const generatePost = (await import('~/server/api/marketing/projects/[projectId]/announcements/[entryId]/generate.post'))
  .default
const channelPut = (await import('~/server/api/marketing/projects/[projectId]/announcements/[entryId]/[channel].put'))
  .default
const channelDelete = (
  await import('~/server/api/marketing/projects/[projectId]/announcements/[entryId]/[channel].delete')
).default

const call = (handler: unknown) => (handler as (e: unknown) => Promise<any>)({} as never)

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  projectId: 'p1',
  title: 'Dark mode',
  slug: 'dark-mode',
  summary: 'Now in the dark',
  body: '## Hello\n\nDark **mode** is here',
  status: 'published',
  labels: ['new'],
  publishedAt: new Date('2026-10-01T00:00:00Z'),
  createdAt: new Date('2026-09-30T00:00:00Z'),
  ...over,
})

const modelOutput = {
  x: 'X post {{link}}',
  bluesky: 'Bluesky post {{link}}',
  linkedin: 'LinkedIn post {{link}}',
  newsletter: 'Newsletter {{link}}',
}

beforeEach(() => {
  state.params = { projectId: 'p1', entryId: 'e1', channel: 'x' }
  state.body = {}
  state.query = {}
  state.access = 'on'
  state.limited = false
  state.dbLimited = false
  state.dbLimits = []
  state.queue = []
  state.drafts = new Map()
  state.deleted = []
  state.rateLimits = []
  state.wheres = []
  state.llmInputs = []
  state.llm.mockReset().mockImplementation(async (_team: string, request: { input: string }) => {
    state.llmInputs.push(request.input)
    return { data: modelOutput, provider: 'anthropic', model: 'claude-x' }
  })
})

// Queue order for a generate call: entry, [owner], [consent], [linked feedback]
const queueGenerate = (e: Record<string, unknown> | null = entry(), allowFeedbackText = true) => {
  state.queue = [
    e ? [e] : [],
    [{ slug: 'acme-team' }],
    [{ allowFeedbackText, allowSupportText: false }],
    [{ title: 'Please add dark mode' }],
  ]
}

describe('announcement routes authorization', () => {
  it.each([
    ['list', listGet],
    ['generate', generatePost],
    ['put', channelPut],
    ['delete', channelDelete],
  ])('%s rejects when marketing is off or the user has no access', async (_n, handler) => {
    state.access = 'forbidden'
    state.body = { content: 'hi' }
    await expect(call(handler)).rejects.toMatchObject({ statusCode: 403 })
    expect(state.llm).not.toHaveBeenCalled()
  })
})

describe('generate', () => {
  it('rate limits per product (20 per hour) before spending credit', async () => {
    state.limited = true
    queueGenerate()
    await expect(call(generatePost)).rejects.toMatchObject({ statusCode: 429 })
    expect(state.llm).not.toHaveBeenCalled()
    expect(state.rateLimits[0]).toMatchObject({ maxRequests: 20, windowSeconds: 3600, subject: 'p1' })
  })

  it('also caps generations per product per day in the database (50/day)', async () => {
    state.dbLimited = true
    queueGenerate()
    await expect(call(generatePost)).rejects.toMatchObject({ statusCode: 429 })
    expect(state.llm).not.toHaveBeenCalled()
    expect(state.dbLimits[0]).toEqual({ teamId: 't1', key: 'ratelimit:announce:p1:2026-10-10', limit: 50 })
  })

  it('404s for an entry that belongs to another product', async () => {
    queueGenerate(entry({ projectId: 'other' }))
    await expect(call(generatePost)).rejects.toMatchObject({ statusCode: 404 })
    expect(state.llm).not.toHaveBeenCalled()
    expect(state.drafts.size).toBe(0)
  })

  it('404s for an unknown entry', async () => {
    queueGenerate(null)
    await expect(call(generatePost)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('rejects an unpublished entry with 409 and no model call', async () => {
    queueGenerate(entry({ status: 'draft' }))
    await expect(call(generatePost)).rejects.toMatchObject({ statusCode: 409 })
    expect(state.llm).not.toHaveBeenCalled()
  })

  it('rejects unknown channels with 400', async () => {
    state.body = { channels: ['myspace'] }
    queueGenerate()
    await expect(call(generatePost)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('generates all channels by default with the public entry link and plain-text input', async () => {
    queueGenerate()
    const { data } = await call(generatePost)
    expect(data.drafts.map((d: Draft) => d.channel).sort()).toEqual(['bluesky', 'linkedin', 'newsletter', 'x'])
    const x = data.drafts.find((d: Draft) => d.channel === 'x')
    expect(x).toMatchObject({
      content: 'X post https://acme-team.veerify.test/acme/changelog/dark-mode',
      edited: false,
      provider: 'anthropic',
      model: 'claude-x',
    })
    expect(state.llmInputs[0]).toContain('Dark mode is here')
    expect(state.llmInputs[0]).not.toContain('**')
    expect(state.llmInputs[0]).toContain('Please add dark mode')
    expect(state.llmInputs[0]).toContain('Acme')
  })

  it('sends linked feedback titles only with feedback consent, PII-stripped and without hidden or support items', async () => {
    queueGenerate()
    state.queue[3] = [{ title: 'Mail me at jane@example.com about https://x.test/a dark mode' }]
    await call(generatePost)
    expect(state.llmInputs[0]).toContain('Mail me at [email] about [url] dark mode')
    expect(state.llmInputs[0]).not.toContain('jane@example.com')

    const q = new PgDialect().sqlToQuery(state.wheres[state.wheres.length - 1] as never)
    expect(q.sql).toContain('"is_hidden"')
    expect(q.sql).toContain("->>'source'")
    expect(q.params).toEqual(expect.arrayContaining(['e1', false, 'support_conversation']))
  })

  it('never reads or sends linked feedback titles without consent', async () => {
    queueGenerate(entry(), false)
    await call(generatePost)
    expect(state.llmInputs[0]).not.toContain('Please add dark mode')
    expect(state.llmInputs[0]).not.toContain('Linked Feedback')
    // the linked feedback query never ran: its queued rows are untouched
    expect(state.queue).toHaveLength(1)
  })

  it('only writes the requested channels', async () => {
    state.body = { channels: ['x', 'linkedin'] }
    queueGenerate()
    const { data } = await call(generatePost)
    expect(data.drafts.map((d: Draft) => d.channel).sort()).toEqual(['linkedin', 'x'])
    expect([...state.drafts.keys()].sort()).toEqual(['e1:linkedin', 'e1:x'])
  })

  it('regenerating overwrites hand edits and resets edited', async () => {
    queueGenerate()
    await call(generatePost)
    state.body = { content: 'my own words' }
    state.queue = [[entry()]]
    await call(channelPut)
    expect(state.drafts.get('e1:x')).toMatchObject({ content: 'my own words', edited: true })

    state.body = {}
    state.llm.mockResolvedValue({ data: { ...modelOutput, x: 'Fresh {{link}}' }, provider: 'openai', model: 'gpt-y' })
    queueGenerate()
    await call(generatePost)
    expect(state.drafts.get('e1:x')).toMatchObject({ edited: false, provider: 'openai', model: 'gpt-y' })
    expect(state.drafts.get('e1:x')!.content).toMatch(/^Fresh /)
    expect(state.drafts.size).toBe(4)
  })

  it('maps unusable model output to 502 and writes nothing', async () => {
    state.llm.mockResolvedValue({ data: { x: 'only x' }, provider: 'anthropic', model: 'm' })
    queueGenerate()
    const err = await call(generatePost).catch((e) => e)
    expect(err.statusCode).toBe(502)
    expect(err.data.error.message).toBe('The model returned an unusable draft, try again')
    expect(state.drafts.size).toBe(0)
  })

  it('passes llm-call errors (no key, budget, quota, auth, rate limit) through unchanged', async () => {
    for (const status of [409, 429, 502]) {
      state.llm.mockRejectedValueOnce(httpError(status))
      queueGenerate()
      await expect(call(generatePost)).rejects.toMatchObject({ statusCode: status })
    }
    expect(state.drafts.size).toBe(0)
  })

  it('points the no-key message at Marketing settings', async () => {
    queueGenerate()
    await call(generatePost)
    expect(state.llm.mock.calls[0][2].noKey).toContain('Marketing settings')
  })

  it('service export works for other callers and enforces access', async () => {
    queueGenerate()
    const drafts = await service.generateAnnouncementDrafts('e1', { userId: 'u1' })
    expect(drafts).toHaveLength(4)
    state.access = 'forbidden'
    queueGenerate()
    await expect(service.generateAnnouncementDrafts('e1', { userId: 'u2' })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('exposes GenerationOutputError semantics via the prompt module', () => {
    expect(new GenerationOutputError('parsing', 'x').phase).toBe('parsing')
  })
})

describe('edit and delete', () => {
  it('saves trimmed content and marks it edited, creating the draft when needed', async () => {
    state.body = { content: '  hello world  ' }
    state.queue = [[entry()]]
    const { data } = await call(channelPut)
    expect(data.draft).toMatchObject({ channel: 'x', content: 'hello world', edited: true })
  })

  it('enforces 1.5x the channel limit', async () => {
    state.params.channel = 'x'
    state.body = { content: 'a'.repeat(420) }
    state.queue = [[entry()]]
    await expect(call(channelPut)).resolves.toBeTruthy()
    state.body = { content: 'a'.repeat(421) }
    state.queue = [[entry()]]
    await expect(call(channelPut)).rejects.toMatchObject({ statusCode: 400 })

    state.params.channel = 'newsletter'
    state.body = { content: 'a'.repeat(3001) }
    await expect(call(channelPut)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects empty content and unknown channels', async () => {
    state.body = { content: '   ' }
    await expect(call(channelPut)).rejects.toMatchObject({ statusCode: 400 })
    state.params.channel = 'myspace'
    state.body = { content: 'hi' }
    await expect(call(channelPut)).rejects.toMatchObject({ statusCode: 404 })
    await expect(call(channelDelete)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('does not edit or delete drafts of an entry from another product', async () => {
    state.body = { content: 'hi' }
    state.queue = [[]]
    await expect(call(channelPut)).rejects.toMatchObject({ statusCode: 404 })
    state.queue = [[]]
    await expect(call(channelDelete)).rejects.toMatchObject({ statusCode: 404 })
    expect(state.drafts.size).toBe(0)
    expect(state.deleted).toHaveLength(0)
  })

  it('deletes a draft', async () => {
    state.queue = [[entry()]]
    await expect(call(channelDelete)).resolves.toMatchObject({ data: { deleted: true } })
    expect(state.deleted).toHaveLength(1)
  })
})

describe('list', () => {
  it('returns entries with drafts and entries without drafts', async () => {
    const draft = {
      entryId: 'e1',
      channel: 'x',
      content: 'c',
      edited: true,
      provider: 'anthropic',
      model: 'm',
      updatedAt: new Date('2026-10-02T00:00:00Z'),
    }
    // module settings row, entries, drafts
    state.queue = [[{ changelogEnabled: true }], [entry(), entry({ id: 'e2', slug: 'two' })], [draft]]
    const { data } = await call(listGet)
    expect(data.changelogEnabled).toBe(true)
    expect(data.hasUsableKey).toBe(true)
    expect(data.limits.x).toBe(280)
    expect(data.entries).toHaveLength(2)
    expect(data.entries[0].drafts).toEqual([
      {
        channel: 'x',
        content: 'c',
        edited: true,
        provider: 'anthropic',
        model: 'm',
        updatedAt: '2026-10-02T00:00:00.000Z',
      },
    ])
    expect(data.entries[1].drafts).toEqual([])
    expect(data.nextCursor).toBeNull()
  })

  it('reports changelog off without listing entries', async () => {
    state.queue = [[]]
    const { data } = await call(listGet)
    expect(data.changelogEnabled).toBe(false)
    expect(data.entries).toEqual([])
  })

  it('returns a cursor when there are more entries than a page', async () => {
    const many = Array.from({ length: 21 }, (_, i) => entry({ id: `e${i}`, slug: `s${i}` }))
    state.queue = [[{ changelogEnabled: true }], many, []]
    const { data } = await call(listGet)
    expect(data.entries).toHaveLength(20)
    expect(data.nextCursor).toBe(`${new Date('2026-10-01T00:00:00Z').getTime()}_e19`)
  })

  it('compares the cursor as an ISO timestamp string cast to timestamp, not a raw Date', async () => {
    const at = new Date('2026-10-01T00:00:00Z')
    state.query = { cursor: `${at.getTime()}_e5` }
    state.queue = [[{ changelogEnabled: true }], [], []]
    await call(listGet)
    const q = new PgDialect().sqlToQuery(state.wheres[state.wheres.length - 1] as never)
    expect(q.params).toContain(at.toISOString())
    expect(q.params.some((p) => p instanceof Date)).toBe(false)
    expect(q.sql).toContain('::timestamp')
  })

  it('rejects a malformed cursor', async () => {
    state.query = { cursor: 'garbage' }
    state.queue = [[{ changelogEnabled: true }]]
    await expect(call(listGet)).rejects.toMatchObject({ statusCode: 400 })
  })
})
