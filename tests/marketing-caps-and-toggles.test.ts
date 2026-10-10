import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('~/server/database/drizzle', () => ({ db: {} }))

const read = (path: string) => readFileSync(path, 'utf8')

describe('term and prompt cap locking', () => {
  it('serialises term creation per site inside a transaction', () => {
    const src = read('server/api/marketing/projects/[projectId]/terms/index.post.ts')
    expect(src).toContain('db.transaction')
    expect(src).toContain('pg_advisory_xact_lock')
    expect(src.indexOf('pg_advisory_xact_lock')).toBeLessThan(src.indexOf('MAX_TERMS_PER_SITE) {'))
    expect(src.indexOf('MAX_TERMS_PER_SITE) {')).toBeLessThan(src.indexOf('.insert(marketingTerm)'))
  })

  it('locks prompt cap checks together with the write', () => {
    for (const file of [
      'server/api/marketing/projects/[projectId]/visibility/prompts.post.ts',
      'server/api/marketing/projects/[projectId]/visibility/prompts/[promptId].put.ts',
    ]) {
      const src = read(file)
      expect(src).toContain('withPromptCapLock')
    }
    expect(read('server/services/marketing/visibility/access.ts')).toContain('pg_advisory_xact_lock')
  })
})

describe('product creation settings', () => {
  it('allows every product module toggle, including marketingEnabled', async () => {
    vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
    const { productToggleShape } = await import('~/server/api/teams/[teamId]/projects.post')
    const { PRODUCT_MODULES } = await import('~/lib/modules')
    expect(Object.keys(productToggleShape).sort()).toEqual(PRODUCT_MODULES.map((m) => m.key).sort())
    expect(productToggleShape).toHaveProperty('marketingEnabled')
  })
})

describe('notification preferences', () => {
  it('keeps marketingDigest in the GET defaults and the PUT whitelist', () => {
    expect(read('server/api/notifications/preferences.get.ts')).toContain('marketingDigest: true')
    expect(read('server/api/notifications/preferences.put.ts')).toContain('marketingDigest: z.boolean().optional()')
  })
})
