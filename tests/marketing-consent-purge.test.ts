import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  log: [] as Array<{ text: string; params: unknown[] }>,
  previous: [false, false] as [boolean, boolean],
}))

vi.mock('~/server/database/drizzle', async () => {
  const { createFakeDb } = await import('./helpers/fake-db')
  return {
    db: createFakeDb(state.log, (text) =>
      text.startsWith('select') && text.includes('"marketing_data_consent"') ? [[...state.previous]] : []
    ),
  }
})

vi.mock('~/server/utils/project-access', () => ({
  requireOrganizationAdmin: vi.fn(),
  requireOrganizationMember: vi.fn(),
}))

const { setConsent } = await import('~/server/services/marketing/customer-language/consent')

beforeEach(() => {
  state.log.length = 0
  state.previous = [false, false]
})

const purges = () => state.log.filter((q) => q.text.startsWith('delete from "customer_language_insight"'))

describe('setConsent purge', () => {
  it('deletes insights built from a source that flips on to off', async () => {
    state.previous = [true, true]
    await setConsent('org-1', 'u1', { allowFeedbackText: false, allowSupportText: true })
    expect(purges()).toHaveLength(1)
    const [purge] = purges()
    expect(purge.text).toContain('"project"."organization_id" = $1')
    expect(purge.text).toContain('&& ARRAY[$2]::text[]')
    expect(purge.params).toEqual(['org-1', 'feedback'])
  })

  it('purges both sources when both go off', async () => {
    state.previous = [true, true]
    await setConsent('org-1', 'u1', { allowFeedbackText: false, allowSupportText: false })
    expect(purges()).toHaveLength(1)
    expect(purges()[0].text).toContain('ARRAY[$2, $3]::text[]')
    expect(purges()[0].params).toEqual(['org-1', 'feedback', 'support'])
  })

  it('purges the support source on its own', async () => {
    state.previous = [false, true]
    await setConsent('org-1', 'u1', { allowFeedbackText: false, allowSupportText: false })
    expect(purges()[0].params).toEqual(['org-1', 'support'])
  })

  it('keeps insights when a source is switched on or nothing is revoked', async () => {
    state.previous = [false, false]
    await setConsent('org-1', 'u1', { allowFeedbackText: true, allowSupportText: true })
    state.previous = [true, true]
    await setConsent('org-1', 'u1', { allowFeedbackText: true, allowSupportText: true })
    expect(purges()).toHaveLength(0)
  })
})
