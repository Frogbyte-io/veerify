import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ log: [] as Array<{ text: string; params: unknown[] }> }))

vi.mock('~/server/database/drizzle', async () => {
  const { createFakeDb } = await import('./helpers/fake-db')
  return { db: createFakeDb(state.log) }
})

const { recheckVerifiedSites } = await import('~/server/services/marketing/site-recheck')

beforeEach(() => {
  state.log.length = 0
})

describe('recheckVerifiedSites module gating', () => {
  it('only reads sites whose team and product have Marketing on, in both sweeps', async () => {
    await recheckVerifiedSites({ now: () => new Date('2026-10-12T00:00:00Z') })
    const sweeps = state.log.filter((q) => q.text.includes('from "marketing_site"'))
    expect(sweeps).toHaveLength(2)
    for (const sweep of sweeps) {
      expect(sweep.text).toContain('left join "team_module_settings"')
      expect(sweep.text).toContain('coalesce("team_module_settings"."marketing_enabled"')
      expect(sweep.text).toContain(`"project"."settings"->>'marketingEnabled' = 'true'`)
      // A team without a settings row reads as the registry default (off)
      expect(sweep.params).toContain(false)
    }
  })
})
