import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  updates: [] as { table: string; values: Record<string, unknown> }[],
  firstOrg: null as string | null,
  projects: {} as Record<string, { id: string; organizationId: string }>,
  accessible: {} as Record<string, { id: string; organizationId: string }[]>,
  orgRoles: {} as Record<string, string | null>,
  auth: null as unknown,
}))

vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string }) =>
  Object.assign(new Error(input.statusMessage), input)
)

vi.mock('~/server/database/schema/auth', () => ({
  member: { organizationId: 'organizationId', userId: 'userId', createdAt: 'createdAt' },
  session: { __t: 'session', token: 'token' },
}))
vi.mock('~/server/database/schema/credentials', () => ({ userApiKey: { __t: 'user_api_key', id: 'id' } }))
vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: () => {
      const chain = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: async () => (state.firstOrg ? [{ organizationId: state.firstOrg }] : []),
      }
      return chain
    },
    update: (table: { __t: string }) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          state.updates.push({ table: table.__t, values })
        },
      }),
    }),
  },
}))
vi.mock('~/server/utils/auth-middleware', () => ({ requireAuth: async () => state.auth }))
vi.mock('~/server/utils/project-access', () => ({
  getProjectById: async (id: string) => state.projects[id] ?? null,
  resolveProjectRole: async (p: { id: string }) => (state.projects[p.id] ? 'member' : null),
  listAccessibleProjects: async (orgId: string) => state.accessible[orgId] ?? [],
  getOrganizationRole: async (orgId: string) => state.orgRoles[orgId] ?? null,
}))

import {
  contextTargetFor,
  requireAuthWithOrganization,
  resolveActiveProjectForSession,
  setActiveOrganizationForSession,
  setActiveProjectForSession,
} from '~/server/utils/project-context'

const keySession = (active: { org?: string | null; project?: string | null } = {}) => ({
  user: { id: 'u1' },
  session: {
    id: 'apikey:k1',
    token: '',
    activeOrganizationId: active.org ?? null,
    activeProjectId: active.project ?? null,
  },
  credential: { kind: 'user_api_key', id: 'k1' },
})
const cookieSession = () => ({
  user: { id: 'u1' },
  session: { id: 's1', token: 'tok', activeOrganizationId: null, activeProjectId: 'gone' },
})

beforeEach(() => {
  state.updates = []
  state.firstOrg = null
  state.projects = { p1: { id: 'p1', organizationId: 'o1' } }
  state.accessible = { o1: [{ id: 'p1', organizationId: 'o1' }] }
  state.orgRoles = { o1: 'member' }
})

describe('contextTargetFor', () => {
  it('targets the key for credential principals and the token for sessions', () => {
    expect(contextTargetFor(keySession() as never)).toEqual({ kind: 'user_api_key', id: 'k1' })
    expect(contextTargetFor(cookieSession() as never)).toEqual({ kind: 'session', token: 'tok' })
  })
})

describe('key principals', () => {
  it('setActiveProjectForSession writes the key row, never session', async () => {
    await setActiveProjectForSession({ target: { kind: 'user_api_key', id: 'k1' }, userId: 'u1', projectId: 'p1' })
    expect(state.updates).toEqual([
      { table: 'user_api_key', values: { activeOrganizationId: 'o1', activeProjectId: 'p1' } },
    ])
  })

  it('setActiveOrganizationForSession writes the key row', async () => {
    await setActiveOrganizationForSession({
      target: { kind: 'user_api_key', id: 'k1' },
      userId: 'u1',
      organizationId: 'o1',
    })
    expect(state.updates.map((u) => u.table)).toEqual(['user_api_key'])
  })

  it('repairs a stale stored project on the key row', async () => {
    state.firstOrg = 'o1'
    const result = await resolveActiveProjectForSession(keySession({ org: 'o1', project: 'deleted' }) as never)
    expect(result?.id).toBe('p1')
    expect(state.updates).toEqual([
      { table: 'user_api_key', values: { activeOrganizationId: 'o1', activeProjectId: 'p1' } },
    ])
  })

  it('requireAuthWithOrganization repairs a missing org on the key row', async () => {
    state.auth = keySession()
    state.firstOrg = 'o1'
    const result = await requireAuthWithOrganization({} as never)
    expect(result.organizationId).toBe('o1')
    expect(state.updates.map((u) => u.table)).toEqual(['user_api_key'])
    expect(state.updates[0].values).toMatchObject({ activeOrganizationId: 'o1' })
  })
})

describe('cookie sessions (regression)', () => {
  it('still update session by token', async () => {
    await setActiveProjectForSession({ target: { kind: 'session', token: 'tok' }, userId: 'u1', projectId: 'p1' })
    state.firstOrg = 'o1'
    await resolveActiveProjectForSession(cookieSession() as never)
    expect(state.updates.map((u) => u.table)).toEqual(['session', 'session'])
  })
})
