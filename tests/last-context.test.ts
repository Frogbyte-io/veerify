import { beforeEach, describe, expect, it, vi } from 'vitest'
import { restoreLastContext } from '~/server/utils/last-context'

const state = vi.hoisted(() => ({ settings: null as unknown, fail: false }))

vi.mock('~/server/utils/logger', () => ({ logger: { warn: vi.fn() } }))
vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: () => {
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: async () => {
          if (state.fail) throw new Error('db down')
          return [{ settings: state.settings }]
        },
      }
      return chain
    },
  },
}))

const fresh = { userId: 'u1', token: 't' }

beforeEach(() => {
  state.settings = null
  state.fail = false
})

describe('restoreLastContext', () => {
  it('restores the last project', async () => {
    state.settings = { lastContext: { organizationId: 'o1', projectId: 'p1', scope: 'project' } }
    expect(await restoreLastContext(fresh)).toEqual({
      ...fresh,
      activeOrganizationId: 'o1',
      activeProjectId: 'p1',
      activeProjectScope: null,
    })
  })

  it('restores All projects', async () => {
    state.settings = { theme: 'dark', lastContext: { organizationId: 'o1', projectId: 'p2', scope: 'all' } }
    expect(await restoreLastContext(fresh)).toMatchObject({ activeProjectId: 'p2', activeProjectScope: 'all' })
  })

  it('leaves a session that already has a context alone', async () => {
    state.settings = { lastContext: { organizationId: 'o1', projectId: 'p1', scope: 'all' } }
    expect(await restoreLastContext({ ...fresh, activeOrganizationId: 'o9' })).toBeNull()
  })

  it('does nothing without a usable last context', async () => {
    expect(await restoreLastContext(fresh)).toBeNull()
    state.settings = { lastContext: { projectId: 'p1' } }
    expect(await restoreLastContext(fresh)).toBeNull()
  })

  it('never blocks sign-in when the lookup fails', async () => {
    state.fail = true
    expect(await restoreLastContext(fresh)).toBeNull()
  })
})
