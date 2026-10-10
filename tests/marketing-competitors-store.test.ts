import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'

const captured = vi.hoisted(() => ({
  where: undefined as unknown,
  order: undefined as unknown,
  limit: undefined as unknown,
}))

vi.mock('~/server/database/drizzle', () => {
  const chain: Record<string, unknown> = {}
  chain.from = () => chain
  chain.innerJoin = () => chain
  chain.where = (cond: unknown) => {
    captured.where = cond
    return chain
  }
  chain.orderBy = (o: unknown) => {
    captured.order = o
    return chain
  }
  chain.limit = (n: unknown) => {
    captured.limit = n
    return Promise.resolve([])
  }
  return { db: { select: () => chain } }
})

const { dbCompetitorStore } = await import('~/server/services/marketing/competitors/store')

describe('dbCompetitorStore.loadDue', () => {
  it('applies status, 23h cutoff, verified site and both marketing switches in the WHERE, before the limit', async () => {
    const cutoff = new Date('2026-10-09T10:00:00Z')
    await dbCompetitorStore.loadDue(cutoff, 30)
    const { sql, params } = new PgDialect().sqlToQuery(captured.where as never)
    expect(sql).toContain('"competitor_watch"."status"')
    expect(sql).toContain('"competitor_watch"."last_checked_at" is null')
    expect(sql).toContain('"competitor_watch"."last_checked_at" <')
    expect(sql).toContain('"marketing_site"."verified_at" is not null')
    expect(sql).toContain(`->>'marketingEnabled' = 'true'`)
    expect(params).toContain('active')
    expect(captured.limit).toBe(30)
    expect(new PgDialect().sqlToQuery(captured.order as never).sql).toContain('nulls first')
  })
})
