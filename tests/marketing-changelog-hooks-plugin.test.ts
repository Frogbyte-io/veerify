import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ enqueued: [] as string[] }))

vi.stubGlobal('defineNitroPlugin', (handler: unknown) => handler)
vi.mock('~/server/services/marketing/reviews', () => ({
  enqueueForChangelogEntry: async (entryId: string) => {
    state.enqueued.push(entryId)
    return 1
  },
}))

const { clearChangelogPublishedHooks, runChangelogPublishedHooks } = await import('~/server/services/changelog/hooks')
const plugin = (await import('~/server/plugins/marketing-changelog-hooks')).default as unknown as () => void

beforeEach(() => {
  clearChangelogPublishedHooks()
  state.enqueued = []
})

describe('marketing changelog hooks plugin', () => {
  it('queues review requests when an entry is published', async () => {
    plugin()
    await runChangelogPublishedHooks({ id: 'entry-1' } as never)
    expect(state.enqueued).toEqual(['entry-1'])
  })
})
