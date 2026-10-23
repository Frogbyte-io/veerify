import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'

const captured = vi.hoisted(() => ({
  executed: [] as unknown[],
  rows: [] as unknown[],
  selectRows: [] as unknown[],
}))

vi.mock('~/server/database/drizzle', () => {
  const chain: Record<string, unknown> = {}
  chain.from = () => chain
  chain.innerJoin = () => chain
  chain.where = () => chain
  chain.limit = () => Promise.resolve(captured.selectRows)
  return {
    db: {
      select: () => chain,
      execute: async (query: unknown) => {
        captured.executed.push(query)
        return { rows: captured.rows }
      },
    },
  }
})

const { dbCompetitorStore, buildDueWatchesQuery } = await import('~/server/services/marketing/competitors/store')

const render = (query: unknown) => new PgDialect().sqlToQuery(query as never)

describe('dbCompetitorStore.loadDue', () => {
  it('applies status, 23h cutoff, verified site and both marketing switches before ranking and the limit', async () => {
    const cutoff = new Date('2026-10-09T10:00:00Z')
    await dbCompetitorStore.loadDue(cutoff, 30)
    const { sql, params } = render(captured.executed[0])
    expect(sql).toContain("w.status = 'active'")
    expect(sql).toContain('w.last_checked_at IS NULL OR w.last_checked_at <')
    expect(sql).toContain('s.verified_at IS NOT NULL')
    expect(sql).toContain(`p.settings ->> 'marketingEnabled' = 'true'`)
    expect(sql).not.toContain('team_module_settings')
    expect(sql).toMatch(/ORDER BY last_checked_at ASC NULLS FIRST, id ASC\s+LIMIT \$\d+/)
    expect(params).toContain(30)
    expect(params).toContain('2026-10-09T10:00:00.000Z')
  })

  it('caps distinct pages per host before the limit, keeping every team on a URL together', () => {
    const { sql, params } = render(buildDueWatchesQuery(new Date('2026-10-09T10:00:00Z'), 120, 'recheck'))
    expect(sql).toMatch(/dense_rank\(\) OVER \(\s*PARTITION BY regexp_replace\(lower\(substring\(w\.url/)
    expect(sql).toMatch(/ORDER BY w\.url/)
    expect(sql).toMatch(/WHERE host_page_rank <= \$\d+/)
    expect(params).toContain(5)
    expect(sql).toContain('w.last_checked_at <')
    expect(sql).not.toContain('IS NULL OR')
  })

  it('does not load the stored page text with the due watches', () => {
    const { sql } = render(buildDueWatchesQuery(new Date(), 10, 'never'))
    expect(sql).not.toContain('last_text')
    expect(sql).toContain('w.last_content_hash')
    expect(sql).toContain('w.last_checked_at IS NULL')
  })

  it('maps rows to watch contexts without lastText', async () => {
    captured.rows = [
      {
        id: 'w1',
        site_id: 's1',
        organization_id: 't1',
        project_id: 'p1',
        project_name: 'Prod',
        project_settings: { marketingEnabled: true },
        term_label: 'Rival',
        competitor_domain: 'rival.com',
        url: 'https://rival.com/pricing',
        kind: 'pricing',
        status: 'active',
        last_checked_at: null,
        last_content_hash: 'abc',
        consecutive_failures: 0,
      },
    ]
    const [watch] = await dbCompetitorStore.loadDue(new Date(), 10)
    expect(watch).toMatchObject({ id: 'w1', organizationId: 't1', lastContentHash: 'abc', lastCheckedAt: null })
    expect(watch.lastText).toBeUndefined()
  })

  it('loads the stored text lazily by id', async () => {
    captured.selectRows = [{ lastText: 'old text' }]
    expect(await dbCompetitorStore.loadLastText('w1')).toBe('old text')
    captured.selectRows = []
    expect(await dbCompetitorStore.loadLastText('w1')).toBeNull()
  })
})
