import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import type {
  DailyMetricInsert,
  QueryStatInsert,
  SearchSyncStore,
  SyncCandidate,
} from '~/server/services/marketing/search/sync'
import type { SearchAnalyticsOptions, SearchAnalyticsRow } from '~/server/services/google/search-console'

const dbState = vi.hoisted(() => ({
  where: null as unknown,
  deleted: [] as unknown[],
  inserted: [] as unknown[],
  snapshots: [] as Array<{ periodEnd: string }>,
}))

vi.mock('~/server/database/drizzle', () => {
  const tx = {
    delete: () => ({
      where: async (condition: unknown) => {
        dbState.deleted.push(condition)
      },
    }),
    insert: () => ({
      values: async (rows: unknown) => {
        dbState.inserted.push(rows)
      },
    }),
    selectDistinct: () => ({
      from: () => ({ where: () => ({ orderBy: async () => dbState.snapshots }) }),
    }),
  }
  const select = () => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.innerJoin = () => chain
    chain.leftJoin = () => chain
    chain.where = (condition: unknown) => {
      dbState.where = condition
      return chain
    }
    chain.orderBy = () => chain
    chain.limit = async () => []
    return chain
  }
  return { db: { select, transaction: async (fn: (t: unknown) => unknown) => fn(tx) } }
})

const { syncSearchConsole, dbSearchSyncStore, toQueryStat } = await import('~/server/services/marketing/search/sync')
const { GoogleApiError, GoogleAuthError } = await import('~/server/services/google/search-console')

const NOW = new Date('2026-10-10T12:00:00Z')
const config = { clientId: 'c', clientSecret: 's', redirectUri: 'https://app.test/api/marketing/google/callback' }

function candidate(overrides: Partial<SyncCandidate> = {}): SyncCandidate {
  return {
    siteId: 's1',
    teamId: 't1',
    projectId: 'p1',
    projectName: 'Acme',
    projectSlug: 'acme',
    projectSettings: { marketingEnabled: true },
    teamMarketingEnabled: true,
    propertyUrl: 'sc-domain:acme.com',
    encryptedRefreshToken: 'v1.x',
    lastSyncAt: null,
    ...overrides,
  }
}

function makeStore(candidates: SyncCandidate[]) {
  const calls = {
    daily: [] as DailyMetricInsert[][],
    snapshots: [] as Array<{ siteId: string; periodEnd: string; rows: QueryStatInsert[]; keep: number }>,
    synced: [] as string[],
    failed: [] as Array<{ siteId: string; message: string; revoked: boolean }>,
  }
  const store: SearchSyncStore = {
    loadDue: async () => candidates,
    upsertDaily: async (rows) => {
      calls.daily.push(rows)
    },
    replaceQuerySnapshot: async (siteId, periodEnd, rows, keep) => {
      calls.snapshots.push({ siteId, periodEnd, rows, keep })
    },
    markSynced: async (siteId) => {
      calls.synced.push(siteId)
    },
    markFailed: async (siteId, _at, message, revoked) => {
      calls.failed.push({ siteId, message, revoked })
    },
  }
  return { store, calls }
}

const row = (key: string, clicks: number, impressions: number, position = 3): SearchAnalyticsRow => ({
  keys: [key],
  clicks,
  impressions,
  ctr: impressions ? clicks / impressions : 0,
  position,
})

const okQuery = async (_t: string, _u: string, options: SearchAnalyticsOptions) =>
  options.dimensions[0] === 'date'
    ? [row('2026-10-07', 10, 100), row('2026-10-08', 12, 120), row('bad-date', 1, 1)]
    : [row('feedback tool', 5, 50), row('Feedback Tool', 1, 10), row('', 9, 9)]

const deps = (store: SearchSyncStore, overrides: Record<string, unknown> = {}) => ({
  store,
  config,
  secretsConfigured: true,
  getAccessToken: async () => 'access',
  query: okQuery,
  ...overrides,
})

describe('syncSearchConsole', () => {
  it('upserts daily metrics and replaces the query snapshot', async () => {
    const { store, calls } = makeStore([candidate()])
    const summary = await syncSearchConsole({ now: NOW }, deps(store))

    expect(summary).toEqual({ sitesSynced: 1, sitesFailed: 0, skipped: false })
    expect(calls.daily[0].map((r) => r.date)).toEqual(['2026-10-07', '2026-10-08'])
    expect(calls.snapshots).toHaveLength(1)
    expect(calls.snapshots[0]).toMatchObject({ siteId: 's1', periodEnd: '2026-10-07', keep: 12 })
    // Distinct queries kept (case-sensitive), the empty key dropped
    expect(calls.snapshots[0].rows.map((r) => r.query)).toEqual(['feedback tool', 'Feedback Tool'])
    expect(calls.synced).toEqual(['s1'])
  })

  it('requests 90 days of final daily data and 28 days of queries ending 3 days ago', async () => {
    const { store } = makeStore([candidate()])
    const query = vi.fn(okQuery)
    await syncSearchConsole({ now: NOW }, deps(store, { query }))

    expect(query).toHaveBeenNthCalledWith(
      1,
      'access',
      'sc-domain:acme.com',
      expect.objectContaining({
        startDate: '2026-07-12',
        endDate: '2026-10-10',
        dimensions: ['date'],
        dataState: 'final',
      })
    )
    expect(query).toHaveBeenNthCalledWith(
      2,
      'access',
      'sc-domain:acme.com',
      expect.objectContaining({ startDate: '2026-09-10', endDate: '2026-10-07', dimensions: ['query'], rowLimit: 1000 })
    )
  })

  it('marks the connection as errored when access was revoked', async () => {
    const { store, calls } = makeStore([candidate()])
    const getAccessToken = async () => {
      throw new GoogleAuthError()
    }
    const summary = await syncSearchConsole({ now: NOW }, deps(store, { getAccessToken }))

    expect(summary.sitesFailed).toBe(1)
    expect(calls.failed).toEqual([{ siteId: 's1', message: 'Google access was revoked — reconnect', revoked: true }])
    expect(calls.daily).toHaveLength(0)
    expect(calls.synced).toHaveLength(0)
  })

  it('records other errors without revoking and writes nothing', async () => {
    const { store, calls } = makeStore([candidate()])
    const query = vi.fn(async (_t: string, _u: string, options: SearchAnalyticsOptions) => {
      if (options.dimensions[0] === 'query') throw new GoogleApiError('server', 'HTTP 503')
      return [row('2026-10-08', 1, 1)]
    })
    await syncSearchConsole({ now: NOW }, deps(store, { query }))

    expect(calls.failed[0]).toMatchObject({ siteId: 's1', revoked: false })
    expect(calls.failed[0].message).toContain('HTTP 503')
    expect(calls.daily).toHaveLength(0)
    expect(calls.snapshots).toHaveLength(0)
  })

  it('skips sites where marketing is off', async () => {
    const { store, calls } = makeStore([
      candidate({ siteId: 'off-team', teamMarketingEnabled: false }),
      candidate({ siteId: 'off-product', projectSettings: { marketingEnabled: false } }),
      candidate({ siteId: 'on' }),
    ])
    await syncSearchConsole({ now: NOW }, deps(store))
    expect(calls.synced).toEqual(['on'])
  })

  it('does nothing when the Google app or secrets are not configured', async () => {
    const { store, calls } = makeStore([candidate()])
    expect(await syncSearchConsole({ now: NOW }, deps(store, { config: null }))).toMatchObject({ skipped: true })
    expect(await syncSearchConsole({ now: NOW }, deps(store, { secretsConfigured: false }))).toMatchObject({
      skipped: true,
    })
    expect(calls.synced).toHaveLength(0)
  })

  it('caps the sites per tick', async () => {
    const { store, calls } = makeStore(Array.from({ length: 5 }, (_, i) => candidate({ siteId: `s${i}` })))
    await syncSearchConsole({ now: NOW, maxSites: 2 }, deps(store))
    expect(calls.synced).toEqual(['s0', 's1'])
  })

  it('stops when the time budget is spent', async () => {
    const { store, calls } = makeStore([candidate({ siteId: 'a' }), candidate({ siteId: 'b' })])
    await syncSearchConsole({ now: NOW, timeBudgetMs: 0 }, deps(store))
    expect(calls.synced).toHaveLength(0)
  })

  it('keeps going after one site fails', async () => {
    const { store, calls } = makeStore([candidate({ siteId: 'bad' }), candidate({ siteId: 'good' })])
    const getAccessToken = async (c: SyncCandidate) => {
      if (c.siteId === 'bad') throw new GoogleApiError('network', 'down')
      return 'access'
    }
    const summary = await syncSearchConsole({ now: NOW }, deps(store, { getAccessToken }))
    expect(summary).toMatchObject({ sitesSynced: 1, sitesFailed: 1 })
    expect(calls.synced).toEqual(['good'])
  })
})

describe('toQueryStat', () => {
  it('truncates long queries and rounds counts', () => {
    const stat = toQueryStat('s1', '2026-10-07', row('x'.repeat(900), 1.4, 9.6))
    expect(stat?.query).toHaveLength(500)
    expect(stat).toMatchObject({ clicks: 1, impressions: 10 })
  })
})

describe('dbSearchSyncStore', () => {
  const sqlOf = (condition: unknown) => new PgDialect().sqlToQuery(condition as never)

  it('loads only connected, verified connections that are new or older than 24 hours', async () => {
    await dbSearchSyncStore.loadDue(NOW)
    const { sql, params } = sqlOf(dbState.where)
    expect(sql).toContain('"gsc_connection"."status" = $1')
    expect(sql).toContain('"gsc_connection"."property_url" is not null')
    expect(sql).toContain('"marketing_site"."verified_at" is not null')
    expect(sql).toContain('"gsc_connection"."last_sync_at" is null')
    expect(sql).toContain('"gsc_connection"."last_sync_at" < $')
    expect(params).toContain('connected')
    expect(params.map(String).some((p) => p.startsWith('2026-10-09T12:00:00'))).toBe(true)
  })

  it('replaces the snapshot and keeps only the 12 most recent', async () => {
    dbState.deleted = []
    dbState.inserted = []
    dbState.snapshots = Array.from({ length: 14 }, (_, i) => ({
      periodEnd: `2026-10-${String(20 - i).padStart(2, '0')}`,
    }))
    await dbSearchSyncStore.replaceQuerySnapshot(
      's1',
      '2026-10-20',
      [{ siteId: 's1', periodEnd: '2026-10-20', query: 'q', clicks: 1, impressions: 1, ctr: 1, position: 1 }],
      12
    )
    // 1) delete same-period rows, then insert, then 2) delete the two stale snapshots
    expect(dbState.deleted).toHaveLength(2)
    expect(dbState.inserted).toHaveLength(1)
    const stale = sqlOf(dbState.deleted[1])
    expect(stale.params).toEqual(expect.arrayContaining(['2026-10-08', '2026-10-07']))
    expect(stale.params).not.toContain('2026-10-09')
  })
})
