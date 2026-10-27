import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  updates: [] as { table: string; values: Record<string, unknown>; where: unknown }[],
  roleDenied: false,
  firstOrg: null as string | null,
  projects: {} as Record<string, { id: string; organizationId: string }>,
  accessible: {} as Record<string, { id: string; organizationId: string }[]>,
  orgRoles: {} as Record<string, string | null>,
  auth: null as unknown,
}))

vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string }) =>
  Object.assign(new Error(input.statusMessage), input)
)

vi.mock('drizzle-orm', () => ({
  eq: (col: string, val: unknown) => ({ op: 'eq', col, val }),
  and: (...conds: unknown[]) => ({ op: 'and', conds }),
  asc: (c: unknown) => c,
}))
vi.mock('~/server/database/schema/auth', () => ({
  member: { organizationId: 'organizationId', userId: 'userId', createdAt: 'createdAt' },
  session: { __t: 'session', token: 'session.token' },
}))
vi.mock('~/server/database/schema/credentials', () => ({ userApiKey: { __t: 'user_api_key', id: 'key.id', userId: 'key.userId' } }))
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
        where: async (cond: unknown) => {
          state.updates.push({ table: table.__t, values, where: cond })
        },
      }),
    }),
  },
}))
vi.mock('~/server/utils/auth-middleware', () => ({ requireAuth: async () => state.auth }))
vi.mock('~/server/utils/project-access', () => ({
  getProjectById: async (id: string) => state.projects[id] ?? null,
  resolveProjectRole: async (p: { id: string }) => (state.projects[p.id] && !state.roleDenied ? 'member' : null),
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

const KEY_TARGET = { kind: 'user_api_key' as const, id: 'k1', userId: 'u1' }
const keyWhere = {
  op: 'and',
  conds: [
    { op: 'eq', col: 'key.id', val: 'k1' },
    { op: 'eq', col: 'key.userId', val: 'u1' },
  ],
}
const tokenWhere = { op: 'eq', col: 'session.token', val: 'tok' }

const keySession = (active: { org?: string | null; project?: string | null } = {}, override = false) => ({
  user: { id: 'u1' },
  session: {
    id: 'apikey:k1',
    token: '',
    activeOrganizationId: active.org ?? null,
    activeProjectId: active.project ?? null,
  },
  credential: override ? { kind: 'user_api_key', id: 'k1', contextOverride: true } : { kind: 'user_api_key', id: 'k1' },
})
const cookieSession = () => ({
  user: { id: 'u1' },
  session: { id: 's1', token: 'tok', activeOrganizationId: null, activeProjectId: 'gone' },
})

beforeEach(() => {
  state.updates = []
  state.roleDenied = false
  state.firstOrg = null
  state.projects = { p1: { id: 'p1', organizationId: 'o1' } }
  state.accessible = { o1: [{ id: 'p1', organizationId: 'o1' }] }
  state.orgRoles = { o1: 'member' }
})

describe('contextTargetFor', () => {
  it('targets the key for credential principals and the token for sessions', () => {
    expect(contextTargetFor(keySession() as never)).toEqual({ kind: 'user_api_key', id: 'k1', userId: 'u1' })
    expect(contextTargetFor(cookieSession() as never)).toEqual({ kind: 'session', token: 'tok' })
  })
})

describe('key principals', () => {
  it('setActiveProjectForSession writes the key row, never session', async () => {
    await setActiveProjectForSession({ target: KEY_TARGET, userId: 'u1', projectId: 'p1' })
    expect(state.updates).toEqual([
      { table: 'user_api_key', values: { activeOrganizationId: 'o1', activeProjectId: 'p1' }, where: keyWhere },
    ])
  })

  it('setActiveOrganizationForSession writes the key row', async () => {
    await setActiveOrganizationForSession({
      target: KEY_TARGET,
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
      { table: 'user_api_key', values: { activeOrganizationId: 'o1', activeProjectId: 'p1' }, where: keyWhere },
    ])
  })

  it('requireAuthWithOrganization repairs a missing org on the key row', async () => {
    state.auth = keySession()
    state.firstOrg = 'o1'
    const result = await requireAuthWithOrganization({} as never)
    expect(result.organizationId).toBe('o1')
    expect(state.updates.map((u) => u.table)).toEqual(['user_api_key'])
    expect(state.updates[0].values).toEqual({ activeOrganizationId: 'o1', activeProjectId: null })
    expect(state.updates[0].where).toEqual(keyWhere)
  })
})

describe('revoked access', () => {
  it('falls back and repairs the key row when the project exists but access is gone', async () => {
    state.firstOrg = 'o1'
    state.roleDenied = true
    state.projects.p2 = { id: 'p2', organizationId: 'o1' }
    // p1 stays listed as accessible via the org listing (the listing is the access source of truth)
    const result = await resolveActiveProjectForSession(keySession({ org: 'o1', project: 'p2' }) as never)
    expect(result?.id).toBe('p1')
    expect(state.updates).toEqual([
      {
        table: 'user_api_key',
        values: { activeOrganizationId: 'o1', activeProjectId: 'p1' },
        where: keyWhere,
      },
    ])
  })
})

describe('per-request header context (contextOverride)', () => {
  it('org header with a nulled project resolves to the header org without writing', async () => {
    state.projects.b1 = { id: 'b1', organizationId: 'oB' }
    state.accessible.oB = [{ id: 'b1', organizationId: 'oB' }]
    state.firstOrg = 'o1'
    const result = await resolveActiveProjectForSession(keySession({ org: 'oB', project: null }, true) as never)
    expect(result?.id).toBe('b1')
    expect(state.updates).toEqual([])
  })

  it('stale stored project with headers present falls back in memory only', async () => {
    state.firstOrg = 'o1'
    const result = await resolveActiveProjectForSession(keySession({ org: 'o1', project: 'deleted' }, true) as never)
    expect(result?.id).toBe('p1')
    expect(state.updates).toEqual([])
  })

  it('requireAuthWithOrganization uses the header org under override without writing', async () => {
    state.auth = keySession({ org: 'o1' }, true)
    const result = await requireAuthWithOrganization({} as never)
    expect(result.organizationId).toBe('o1')
    expect(state.updates).toEqual([])
  })

  it('does not fall back to the first org when the header org has no accessible project', async () => {
    state.firstOrg = 'o1'
    state.accessible.oB = []
    const result = await resolveActiveProjectForSession(keySession({ org: 'oB', project: null }, true) as never)
    expect(result).toBeNull()
    expect(state.updates).toEqual([])
  })

  it('requireAuthWithOrganization 409s instead of crossing workspaces under override', async () => {
    state.auth = keySession({ org: 'oB' }, true)
    state.firstOrg = 'o1'
    state.orgRoles.oB = null
    await expect(requireAuthWithOrganization({} as never)).rejects.toMatchObject({ statusCode: 409 })
    expect(state.updates).toEqual([])
  })
})

describe('cookie sessions (regression)', () => {
  it('still update session by token', async () => {
    await setActiveProjectForSession({ target: { kind: 'session', token: 'tok' }, userId: 'u1', projectId: 'p1' })
    state.firstOrg = 'o1'
    await resolveActiveProjectForSession(cookieSession() as never)
    expect(state.updates.map((u) => u.table)).toEqual(['session', 'session'])
    expect(state.updates.map((u) => u.where)).toEqual([tokenWhere, tokenWhere])
  })
})
