import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  executes: [] as unknown[],
  executeRows: [] as Array<Array<{ id: string }>>,
  selects: [] as Array<{
    fields: Record<string, any> | null
    joins: Array<{ kind: string; condition: unknown }>
    where: unknown
  }>,
  selectQueue: [] as unknown[][],
  updates: [] as Array<{ set: Record<string, unknown>; where: unknown }>,
  transactions: 0,
  txExecutes: [] as unknown[],
  txInsertRows: [] as unknown[][],
  insertedValues: [] as unknown[],
}))

vi.mock('~/server/database/drizzle', () => {
  const makeSelect = (fields: Record<string, any> | null) => {
    const record = { fields, joins: [] as Array<{ kind: string; condition: unknown }>, where: undefined as unknown }
    state.selects.push(record)
    const chain: Record<string, any> = {
      from: () => chain,
      innerJoin: (_t: unknown, condition: unknown) => {
        record.joins.push({ kind: 'inner', condition })
        return chain
      },
      leftJoin: (_t: unknown, condition: unknown) => {
        record.joins.push({ kind: 'left', condition })
        return chain
      },
      where: (condition: unknown) => {
        record.where = condition
        return chain
      },
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: (rows: unknown[]) => unknown) => resolve(state.selectQueue.shift() ?? []),
    }
    return chain
  }
  const db: Record<string, any> = {
    execute: vi.fn(async (query: unknown) => {
      state.executes.push(query)
      return { rows: state.executeRows.shift() ?? [] }
    }),
    select: vi.fn((fields?: Record<string, unknown>) => makeSelect(fields ?? null)),
    update: vi.fn(() => ({
      set: (set: Record<string, unknown>) => ({
        where: async (where: unknown) => {
          state.updates.push({ set, where })
        },
      }),
    })),
    insert: vi.fn(() => ({
      values: (values: unknown) => ({
        onConflictDoNothing: () => ({
          returning: async () => (state.insertedValues.push(values), state.txInsertRows.shift() ?? [{ id: 'new' }]),
        }),
      }),
    })),
    transaction: vi.fn(async (callback: (tx: unknown) => unknown) => {
      state.transactions += 1
      const tx = {
        ...db,
        execute: vi.fn(async (query: unknown) => {
          state.txExecutes.push(query)
          return { rows: [] }
        }),
      }
      return callback(tx)
    }),
  }
  return { db }
})

const { dbReviewsStore } = await import('~/server/services/marketing/reviews/store')
const { hashEmail } = await import('~/server/utils/marketing-email-hash')

const dialect = new PgDialect()
const sqlOf = (query: unknown) => dialect.sqlToQuery(query as never)
const compact = (text: string) => text.replace(/\s+/g, ' ').trim()

beforeEach(() => {
  state.executes = []
  state.executeRows = []
  state.selects = []
  state.selectQueue = []
  state.updates = []
  state.transactions = 0
  state.txExecutes = []
  state.txInsertRows = []
  state.insertedValues = []
})

describe('claimBatch', () => {
  it('claims with one committed UPDATE using SKIP LOCKED and the backoff gate, without a transaction', async () => {
    state.executeRows = [[]]
    await expect(dbReviewsStore.claimBatch(50)).resolves.toEqual([])
    expect(state.transactions).toBe(0)
    const { sql, params } = sqlOf(state.executes[0])
    const text = compact(sql)
    expect(text).toContain("SET status = 'sending', claimed_at = now()")
    expect(text).toContain("WHERE status = 'queued'")
    expect(text).toContain('next_attempt_at IS NULL OR next_attempt_at <= now()')
    expect(text).toContain('ORDER BY created_at ASC')
    expect(text).toContain('FOR UPDATE SKIP LOCKED')
    expect(text).toContain('RETURNING id')
    expect(params).toEqual([50])
  })

  it('loads the details of the claimed rows afterwards', async () => {
    state.executeRows = [[{ id: 'rr-1' }]]
    state.selectQueue = [
      [{ id: 'rr-1', email: 'a@x.io', attempts: 1, settings: null, feedbackTitle: null, projectName: 'Acme' }],
    ]
    const rows = await dbReviewsStore.claimBatch(10)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'rr-1', attempts: 1, settings: null })
    expect(state.transactions).toBe(0)
  })
})

describe('sweepStale', () => {
  it('returns claims older than the threshold to the queue as an attempt, failing exhausted ones', async () => {
    state.executeRows = [[{ id: 'a' }, { id: 'b' }]]
    await expect(dbReviewsStore.sweepStale(10, 3)).resolves.toBe(2)
    const { sql, params } = sqlOf(state.executes[0])
    const text = compact(sql)
    expect(text).toContain("WHERE status = 'sending'")
    expect(text).toContain('claimed_at < now() - make_interval(mins =>')
    expect(text).toContain('attempts = attempts + 1')
    expect(text).toContain("CASE WHEN attempts + 1 >= $1 THEN 'failed' ELSE 'queued' END")
    expect(params).toEqual([3, 10])
  })
})

describe('outcome writers are guarded by status = sending', () => {
  const guarded = (index: number) => {
    const { sql, params } = sqlOf(state.updates[index]!.where)
    expect(sql).toContain('"review_request"."status"')
    expect(params).toContain('sending')
  }

  it.each([
    ['markSent', () => dbReviewsStore.markSent('rr-1', new Date())],
    ['markFailed', () => dbReviewsStore.markFailed('rr-1', 'boom')],
    ['markSkipped', () => dbReviewsStore.markSkipped('rr-1', 'cooldown')],
    ['markRetry', () => dbReviewsStore.markRetry('rr-1', 'boom', 900_000)],
    ['release', () => dbReviewsStore.release(['rr-1'])],
  ])('%s', async (_name, call) => {
    await call()
    expect(state.updates).toHaveLength(1)
    guarded(0)
  })

  it('markRetry requeues with attempts + 1 and a database-side delay', async () => {
    await dbReviewsStore.markRetry('rr-1', 'boom', 900_000)
    const set = state.updates[0]!.set
    expect(set.status).toBe('queued')
    expect(sqlOf(set.attempts).sql).toContain('+ 1')
    const next = sqlOf(set.nextAttemptAt)
    expect(next.sql).toContain('now() + make_interval(secs =>')
    expect(next.params).toEqual([900])
    expect(set.claimedAt).toBeNull()
  })

  it('release does not count an attempt', async () => {
    await dbReviewsStore.release(['rr-1'])
    expect(state.updates[0]!.set).toEqual({ status: 'queued', claimedAt: null })
  })
})

describe('insertRequest', () => {
  const row = {
    id: 'rr-1',
    projectId: 'p1',
    teamId: 't1',
    email: 'a@x.io',
    name: null,
    trigger: 'manual' as const,
    sourceId: null,
    token: 'tok',
  }

  it('event requests insert directly and rely on the unique index', async () => {
    await expect(dbReviewsStore.insertRequest({ ...row, trigger: 'csat', sourceId: 's1' })).resolves.toBe(true)
    expect(state.transactions).toBe(0)
  })

  it('manual requests lock per address and refuse a recent one inside the lock', async () => {
    state.selectQueue = [[{ id: 'existing' }]]
    await expect(dbReviewsStore.insertRequest(row, { dedupeSince: new Date() })).resolves.toBe(false)
    expect(state.transactions).toBe(1)
    expect(sqlOf(state.txExecutes[0]).sql).toContain('pg_advisory_xact_lock')
    const { params } = sqlOf(state.selects[0]!.where)
    expect(params).toEqual(expect.arrayContaining(['p1', 'a@x.io', 'queued', 'sending', 'sent']))
  })

  it('manual requests insert when nothing recent exists', async () => {
    state.selectQueue = [[]]
    await expect(dbReviewsStore.insertRequest(row, { dedupeSince: new Date() })).resolves.toBe(true)
  })
})

describe('loadFeedbackRecipients only returns verified addresses', () => {
  it('returns nothing for no ids without querying', async () => {
    await expect(dbReviewsStore.loadFeedbackRecipients([])).resolves.toEqual([])
    expect(state.selects).toHaveLength(0)
  })

  it('uses the account email, never the free-text author email, and skips unverified authors', async () => {
    state.selectQueue = [
      [
        {
          feedbackId: 'f1',
          projectId: 'p1',
          status: 'completed',
          title: 'T',
          authorEmail: 'Verified@x.io',
          authorName: 'Ver',
          authorVerified: true,
        },
        {
          feedbackId: 'f2',
          projectId: 'p1',
          status: 'completed',
          title: 'T2',
          authorEmail: 'unverified@x.io',
          authorName: 'Un',
          authorVerified: false,
        },
        {
          feedbackId: 'f3',
          projectId: 'p1',
          status: 'completed',
          title: 'T3',
          authorEmail: null,
          authorName: null,
          authorVerified: null,
        },
      ],
      [],
    ]
    const result = await dbReviewsStore.loadFeedbackRecipients(['f1', 'f2', 'f3'])
    expect(result.map((r) => r.recipients)).toEqual([[{ email: 'verified@x.io', name: 'Ver' }], [], []])

    const fields = state.selects[0]!.fields!
    expect(Object.keys(fields)).not.toContain('freeTextAuthorEmail')
    // the selected author email is the user's account email column, not feedback.author_email
    expect(fields.authorEmail.name).toBe('email')
    expect(sqlOf(state.selects[0]!.joins[0]!.condition).sql).toContain('"feedback"."author_user_id"')
  })

  it('counts a subscription only when linked to a verified account, and uses that account email', async () => {
    state.selectQueue = [
      [
        {
          feedbackId: 'f1',
          projectId: 'p1',
          status: 's',
          title: 'T',
          authorEmail: null,
          authorName: null,
          authorVerified: null,
        },
      ],
      [
        { feedbackId: 'f1', email: 'Sub@x.io', name: 'Sub' },
        { feedbackId: 'f1', email: 'sub@x.io', name: 'Dup' },
      ],
    ]
    const [item] = await dbReviewsStore.loadFeedbackRecipients(['f1'])
    expect(item!.recipients).toEqual([{ email: 'sub@x.io', name: 'Sub' }])

    const subscriptionQuery = state.selects[1]!
    const join = sqlOf(subscriptionQuery.joins[0]!.condition)
    expect(subscriptionQuery.joins[0]!.kind).toBe('inner')
    expect(join.sql).toContain('"feedback_subscription"."user_id"')
    expect(join.sql).toContain('"user"."email_verified"')
    expect(join.params).toContain(true)
    expect(subscriptionQuery.fields!.email.name).toBe('email')
  })

  it('de-duplicates the author against subscribers', async () => {
    state.selectQueue = [
      [
        {
          feedbackId: 'f1',
          projectId: 'p1',
          status: 's',
          title: 'T',
          authorEmail: 'a@x.io',
          authorName: 'A',
          authorVerified: true,
        },
      ],
      [{ feedbackId: 'f1', email: 'A@x.io', name: 'A' }],
    ]
    const [item] = await dbReviewsStore.loadFeedbackRecipients(['f1'])
    expect(item!.recipients).toHaveLength(1)
  })
})

describe('countManualSince', () => {
  it('counts manual requests per team', async () => {
    state.selectQueue = [[{ total: 7 }]]
    await expect(dbReviewsStore.countManualSince('t1', new Date())).resolves.toBe(7)
    const { sql, params } = sqlOf(state.selects[0]!.where)
    expect(sql).toContain('"review_request"."team_id"')
    expect(params).toEqual(expect.arrayContaining(['t1', 'manual']))
  })
})

describe('email hash matching', () => {
  const hash = () => hashEmail('Jane@Example.com')

  it('isSuppressed matches by address OR keyed hash', async () => {
    state.selectQueue = [[{ email: 'hash:x' }]]
    await expect(dbReviewsStore.isSuppressed('t1', 'jane@example.com')).resolves.toBe(true)
    const { sql, params } = sqlOf(state.selects[0]!.where)
    expect(sql).toContain('"marketing_email_suppression"."email" =')
    expect(sql).toContain('"marketing_email_suppression"."email_hash" in (')
    expect(sql).toContain(' or ')
    expect(params).toEqual(expect.arrayContaining(['t1', 'jane@example.com', hash()]))
  })

  it('cooldown checks find anonymised rows through the hash', async () => {
    await dbReviewsStore.hasRecentRequest('p1', 'jane@example.com', new Date())
    await dbReviewsStore.hasRecentSentRequest('p1', 'jane@example.com', new Date(), 'x')
    for (const select of state.selects) {
      const { sql, params } = sqlOf(select.where)
      expect(sql).toContain('"review_request"."email_hash" in (')
      expect(params).toContain(hash())
    }
  })

  it('insertRequest stores the keyed hash next to the address', async () => {
    await dbReviewsStore.insertRequest({
      id: 'rr-1',
      projectId: 'p1',
      teamId: 't1',
      email: 'jane@example.com',
      name: null,
      trigger: 'csat',
      sourceId: 's1',
      token: 'tok',
    })
    expect(state.insertedValues[0]).toMatchObject({ email: 'jane@example.com', emailHash: hash() })
  })

  it('stillSendable is false when the row is gone or no longer sending (erased or swept)', async () => {
    state.selectQueue = [[]]
    await expect(dbReviewsStore.stillSendable('rr-1', 't1', 'jane@example.com')).resolves.toBe(false)
    const { sql, params } = sqlOf(state.selects[0]!.where)
    expect(sql).toContain('"review_request"."status" =')
    expect(params).toEqual(expect.arrayContaining(['rr-1', 'sending']))
  })

  it('stillSendable is false when the address was suppressed after the claim, true otherwise', async () => {
    state.selectQueue = [[{ id: 'rr-1' }], [{ email: 'jane@example.com' }]]
    await expect(dbReviewsStore.stillSendable('rr-1', 't1', 'jane@example.com')).resolves.toBe(false)
    state.selectQueue = [[{ id: 'rr-1' }], []]
    await expect(dbReviewsStore.stillSendable('rr-1', 't1', 'jane@example.com')).resolves.toBe(true)
  })
})
