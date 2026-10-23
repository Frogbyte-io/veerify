import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

const captured = vi.hoisted(() => ({
  executed: [] as unknown[],
  executeRows: [] as unknown[][],
  conflict: null as null | { target: unknown; set: unknown; setWhere: unknown },
  inserted: null as unknown,
  returningRows: [] as unknown[],
  where: [] as unknown[],
  orderBy: [] as unknown[],
  limit: [] as unknown[],
  selectRows: [] as unknown[][],
}))

vi.mock('~/server/database/drizzle', () => {
  const select: Record<string, unknown> = {}
  for (const m of ['from', 'innerJoin', 'leftJoin']) select[m] = () => select
  select.where = (w: unknown) => {
    captured.where.push(w)
    return select
  }
  select.orderBy = (...o: unknown[]) => {
    captured.orderBy.push(o)
    return select
  }
  select.limit = (n: unknown) => {
    captured.limit.push(n)
    return Promise.resolve(captured.selectRows.shift() ?? [])
  }
  return {
    db: {
      execute: async (query: unknown) => {
        captured.executed.push(query)
        return { rows: captured.executeRows.shift() ?? [] }
      },
      select: () => select,
      insert: () => ({
        values: (values: unknown) => {
          captured.inserted = values
          return {
            onConflictDoUpdate: (config: { target: unknown; set: unknown; setWhere: unknown }) => {
              captured.conflict = config
              return { returning: async () => captured.returningRows }
            },
          }
        },
      }),
    },
  }
})

const dialect = new PgDialect()
const render = (query: unknown) => dialect.sqlToQuery(query as Parameters<typeof dialect.sqlToQuery>[0])

const { dbMentionsStore } = await import('~/server/services/marketing/mentions/store')
const { drizzleAuditStore } = await import('~/server/services/marketing/audit/store')

const NOW = new Date('2026-10-12T10:00:00Z')

describe('mentions store: due selection in SQL', () => {
  it('selects verified, Marketing-on, has-terms sites with a due source, oldest attempt first, limited', async () => {
    captured.executed = []
    captured.executeRows = [
      [
        {
          site_id: 's1',
          organization_id: 't1',
          project_id: 'p1',
          name: 'Acme',
          slug: 'acme',
          settings: { marketingEnabled: true },
          marketing_enabled: true,
        },
      ],
    ]
    const sites = await dbMentionsStore.loadDueSites({ now: NOW, sourceIds: ['hackernews', 'reddit'], limit: 400 })
    expect(sites).toEqual([
      {
        siteId: 's1',
        organizationId: 't1',
        projectId: 'p1',
        projectName: 'Acme',
        projectSlug: 'acme',
        projectSettings: { marketingEnabled: true },
      },
    ])
    expect(captured.executed).toHaveLength(1)
    const { sql: text, params } = render(captured.executed[0])
    expect(text).toMatch(/s\.verified_at IS NOT NULL/)
    expect(text).toMatch(/p\.settings ->> 'marketingEnabled' = 'true'/)
    expect(text).toMatch(/EXISTS \(SELECT 1 FROM marketing_term mt WHERE mt\.site_id = s\.id\)/)
    expect(text).toMatch(/ORDER BY due\.oldest ASC, s\.id ASC/)
    expect(text).toMatch(/LIMIT \$\d+/)
    // backoff and interval are computed in SQL from consecutive_failures
    expect(text).toMatch(/consecutive_failures <= 0/)
    expect(text).toMatch(/LEAST\(power\(2, LEAST\(c\.consecutive_failures, 10\)\)/)
    expect(params).toEqual(
      expect.arrayContaining(['hackernews', 'reddit', 400, '2026-10-12T10:00:00.000Z', 1800, 900, 21600])
    )
  })

  it('does not query without sources', async () => {
    captured.executed = []
    expect(await dbMentionsStore.loadDueSites({ now: NOW, sourceIds: [], limit: 10 })).toEqual([])
    expect(captured.executed).toHaveLength(0)
  })

  it('claims a cursor atomically: upsert that only stamps last_attempt_at when unset or past the lease', async () => {
    captured.returningRows = [{ siteId: 's1' }]
    const won = await dbMentionsStore.claimCursor('s1', 'reddit', NOW, new Date('2026-10-05T10:00:00Z'), 15 * 60 * 1000)
    expect(won).toBe(true)
    expect(captured.inserted).toMatchObject({
      siteId: 's1',
      source: 'reddit',
      lastAttemptAt: NOW,
      consecutiveFailures: 0,
    })
    const setWhere = render(captured.conflict!.setWhere)
    expect(setWhere.sql).toMatch(/"last_attempt_at" is null or "mention_source_cursor"\."last_attempt_at" </)
    expect(setWhere.params).toContainEqual(new Date(NOW.getTime() - 15 * 60 * 1000).toISOString())
    expect(captured.conflict!.set).toEqual({ lastAttemptAt: NOW })

    captured.returningRows = []
    expect(await dbMentionsStore.claimCursor('s1', 'reddit', NOW, NOW, 900_000)).toBe(false)
  })
})

describe('audit store: scheduler gates in SQL', () => {
  it('puts both Marketing switches and the stale/never-audited test in WHERE, ordered by last audit NULLS FIRST', async () => {
    captured.where = []
    captured.orderBy = []
    captured.limit = []
    captured.selectRows = [[{ siteId: 's1', lastAuditAt: null }]]
    const result = await drizzleAuditStore.scheduleCandidates(new Date('2026-10-05T10:00:00Z'), 200)
    expect(result).toEqual([{ siteId: 's1', lastAuditAt: null }])
    const where = render(captured.where[0]).sql
    expect(where).not.toContain('team_module_settings')
    expect(where).toMatch(/"settings"->>'marketingEnabled' = 'true'/)
    expect(where).toMatch(/NOT EXISTS/)
    const order = render((captured.orderBy[0] as unknown[])[0]).sql
    expect(order).toMatch(/asc nulls first/)
    expect(captured.limit[0]).toBe(200)
  })

  it('extends the lease only while this worker still holds it', async () => {
    captured.executed = []
    captured.executeRows = [[{ id: 'a1' }], []]
    expect(await drizzleAuditStore.extendLease('a1', NOW, new Date(NOW.getTime() + 360_000))).toBe(true)
    expect(await drizzleAuditStore.extendLease('a1', NOW, new Date(NOW.getTime() + 360_000))).toBe(false)
    const { sql: text, params } = render(captured.executed[0])
    expect(text).toMatch(/leaseUntil'\)::timestamptz >= \$\d+::timestamptz/)
    expect(text).toMatch(/status IN \('queued', 'crawling', 'analyzing'\)/)
    expect(params).toContain(NOW.toISOString())
  })
})
