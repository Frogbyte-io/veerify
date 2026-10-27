import { getTableName } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  generateUserApiKey,
  hashUserApiKey,
  readBearerUserApiKey,
  resolveUserApiKeyPrincipal,
} from '~/server/utils/user-api-keys'

const state = vi.hoisted(() => ({
  keyRow: null as null | Record<string, unknown>,
  orgRows: [] as Record<string, unknown>[],
  projectRows: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  orgRole: 'member' as string | null,
  projectRole: 'member' as string | null,
  projectsById: {} as Record<string, Record<string, unknown>>,
  updateError: null as null | Error,
}))

const logWarn = vi.hoisted(() => vi.fn())
vi.mock('~/server/utils/logger', () => ({ createLogger: () => ({ warn: logWarn, error: vi.fn(), info: vi.fn() }) }))

vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
  Object.assign(new Error(input.statusMessage), input)
)

vi.mock('~/server/utils/response', () => ({
  createErrorResponse: (code: string, message: string) => ({ success: false, error: { code, message } }),
  ErrorCode: { UNAUTHORIZED: 'UNAUTHORIZED', FORBIDDEN: 'FORBIDDEN' },
}))

const getOrganizationRole = vi.hoisted(() => vi.fn(async () => state.orgRole))
const resolveProjectRole = vi.hoisted(() => vi.fn(async () => state.projectRole))
const getProjectById = vi.hoisted(() => vi.fn(async (id: string) => state.projectsById[id] ?? null))
vi.mock('~/server/utils/project-access', () => ({ getOrganizationRole, resolveProjectRole, getProjectById }))

const requireRateLimit = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('~/server/utils/rate-limit', () => ({ requireRateLimit }))

vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: vi.fn(() => {
      let table = ''
      const chain = {
        from: (t: unknown) => {
          table = getTableName(t as never)
          return chain
        },
        innerJoin: () => chain,
        where: () => chain,
        limit: () => {
          if (table === 'user_api_key') return Promise.resolve(state.keyRow ? [state.keyRow] : [])
          if (table === 'organization') return Promise.resolve(state.orgRows)
          if (table === 'project') return Promise.resolve(state.projectRows)
          return Promise.resolve([])
        },
      }
      return chain
    }),
    update: vi.fn(() => ({
      set: (v: Record<string, unknown>) => {
        state.updates.push(v)
        return { where: () => (state.updateError ? Promise.reject(state.updateError) : Promise.resolve()) }
      },
    })),
  },
}))

function eventWith(headers: Record<string, string>) {
  // Node lowercases incoming header names.
  const lowered = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return { node: { req: { headers: lowered }, res: {} }, context: {} } as never
}

const owner = {
  id: 'user-1',
  email: 'a@b.c',
  name: 'A',
  emailVerified: true,
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}
function keyRow(over: Record<string, unknown> = {}) {
  return {
    key: {
      id: 'key-1',
      userId: 'user-1',
      activeOrganizationId: 'org-1',
      activeProjectId: 'proj-1',
      expiresAt: null,
      revokedAt: null,
      ...over,
    },
    owner,
  }
}
const bearer = (extra: Record<string, string> = {}) => eventWith({ authorization: 'Bearer vfy_usr_abc', ...extra })

beforeEach(() => {
  state.keyRow = null
  state.orgRows = []
  state.projectRows = []
  state.updates = []
  state.orgRole = 'member'
  state.projectRole = 'member'
  state.projectsById = {}
  state.updateError = null
  logWarn.mockClear()
  getOrganizationRole.mockClear()
  resolveProjectRole.mockClear()
  requireRateLimit.mockClear()
})

// The mock stores the join result as { key, owner }; keep rows in that shape.
function setRow(over: Record<string, unknown> = {}) {
  const r = keyRow(over)
  state.keyRow = { key: r.key, owner: r.owner }
}

describe('key utilities', () => {
  it('generates a well-formed key and matching hash', () => {
    const { key, keyPrefix, keyHash } = generateUserApiKey()
    expect(key).toMatch(/^vfy_usr_[A-Za-z0-9_-]{43}$/)
    expect(keyPrefix).toBe(key.slice(0, 12))
    expect(keyHash).toBe(hashUserApiKey(key))
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('reads only vfy_usr_ bearer tokens', () => {
    expect(readBearerUserApiKey(eventWith({ authorization: 'Bearer vfy_pub_x' }))).toBeNull()
    expect(readBearerUserApiKey(eventWith({}))).toBeNull()
    expect(readBearerUserApiKey(eventWith({ authorization: 'Basic x' }))).toBeNull()
    expect(readBearerUserApiKey(eventWith({ authorization: 'bearer  vfy_usr_abc ' }))).toBe('vfy_usr_abc')
  })
})

describe('resolveUserApiKeyPrincipal', () => {
  it('returns null without a personal bearer', async () => {
    expect(await resolveUserApiKeyPrincipal(eventWith({}))).toBeNull()
    expect(await resolveUserApiKeyPrincipal(eventWith({ authorization: 'Bearer vfy_pub_x' }))).toBeNull()
  })

  it('401s for unknown, revoked and expired keys', async () => {
    await expect(resolveUserApiKeyPrincipal(bearer())).rejects.toMatchObject({ statusCode: 401 })
    setRow({ revokedAt: new Date() })
    await expect(resolveUserApiKeyPrincipal(bearer())).rejects.toMatchObject({ statusCode: 401 })
    setRow({ expiresAt: new Date(Date.now() - 1000) })
    await expect(resolveUserApiKeyPrincipal(bearer())).rejects.toMatchObject({ statusCode: 401 })
    expect(requireRateLimit).not.toHaveBeenCalled()
  })

  it('returns the principal for a valid key and records usage', async () => {
    setRow()
    const p = await resolveUserApiKeyPrincipal(bearer())
    expect(p?.credential).toEqual({ kind: 'user_api_key', id: 'key-1' })
    expect(p?.session.activeProjectId).toBe('proj-1')
    expect(p?.session.activeOrganizationId).toBe('org-1')
    expect(p?.session.id).toBe('apikey:key-1')
    expect(p?.session.token).toBe('')
    expect(p?.user.id).toBe('user-1')
    expect(requireRateLimit).toHaveBeenCalledTimes(1)
    expect(requireRateLimit).toHaveBeenCalledWith(expect.anything(), {
      maxRequests: 600,
      windowSeconds: 60,
      identifier: 'user-api-key',
      subject: 'key-1',
    })
    await vi.waitFor(() => expect(state.updates[0]).toHaveProperty('lastUsedAt'))
  })

  it('skips the lastUsedAt write when the key was used under 60 seconds ago', async () => {
    setRow({ lastUsedAt: new Date(Date.now() - 30_000) })
    await resolveUserApiKeyPrincipal(bearer())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(state.updates).toHaveLength(0)
  })

  it('rewrites lastUsedAt once the stored value is older than 60 seconds', async () => {
    setRow({ lastUsedAt: new Date(Date.now() - 61_000) })
    await resolveUserApiKeyPrincipal(bearer())
    await vi.waitFor(() => expect(state.updates[0]).toHaveProperty('lastUsedAt'))
  })

  it('logs a failed lastUsedAt write without failing the request', async () => {
    setRow()
    state.updateError = new Error('db down')
    await expect(resolveUserApiKeyPrincipal(bearer())).resolves.not.toBeNull()
    await vi.waitFor(() =>
      expect(logWarn).toHaveBeenCalledWith('Failed to record API key use', {
        keyId: 'key-1',
        error: state.updateError,
      })
    )
  })

  it('rechecks the row on every call (revocation takes effect immediately)', async () => {
    setRow()
    await expect(resolveUserApiKeyPrincipal(bearer())).resolves.not.toBeNull()
    setRow({ revokedAt: new Date() })
    await expect(resolveUserApiKeyPrincipal(bearer())).rejects.toMatchObject({ statusCode: 401 })
  })

  it('403s when the organization header names an org the user is not in', async () => {
    setRow()
    state.orgRows = [{ id: 'org-2' }]
    state.orgRole = null
    await expect(resolveUserApiKeyPrincipal(bearer({ 'X-Veerify-Organization': 'other-org' }))).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it('403s when the organization header names an unknown org', async () => {
    setRow()
    await expect(resolveUserApiKeyPrincipal(bearer({ 'x-veerify-organization': 'nope' }))).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it('applies a member organization header for this request', async () => {
    setRow()
    state.orgRows = [{ id: 'org-2' }]
    const p = await resolveUserApiKeyPrincipal(bearer({ 'X-Veerify-Organization': 'org-two' }))
    expect(p?.session.activeOrganizationId).toBe('org-2')
    expect(state.updates.every((u) => !('activeOrganizationId' in u))).toBe(true)
  })

  it('nulls a stored project from another org when an org header is applied, and flags the override', async () => {
    setRow({ activeOrganizationId: 'org-1', activeProjectId: 'p1' })
    state.projectsById.p1 = { id: 'p1', organizationId: 'org-1' }
    state.orgRows = [{ id: 'org-2' }]
    const p = await resolveUserApiKeyPrincipal(bearer({ 'X-Veerify-Organization': 'org-two' }))
    expect(p?.session.activeOrganizationId).toBe('org-2')
    expect(p?.session.activeProjectId).toBeNull()
    expect(p?.credential).toEqual({ kind: 'user_api_key', id: 'key-1', contextOverride: true })
  })

  it('nulls a stored project that no longer exists when an org header is applied', async () => {
    setRow({ activeOrganizationId: 'org-1', activeProjectId: 'gone' })
    state.orgRows = [{ id: 'org-2' }]
    const p = await resolveUserApiKeyPrincipal(bearer({ 'X-Veerify-Organization': 'org-two' }))
    expect(p?.session.activeProjectId).toBeNull()
  })

  it('flags contextOverride for a project header alone', async () => {
    setRow()
    state.projectsById.p2 = { id: 'p2', organizationId: 'org-1' }
    const p = await resolveUserApiKeyPrincipal(bearer({ 'X-Veerify-Project': 'p2' }))
    expect(p?.credential).toEqual({ kind: 'user_api_key', id: 'key-1', contextOverride: true })
  })

  it('keeps a stored project that belongs to the header org', async () => {
    setRow({ activeOrganizationId: 'org-1', activeProjectId: 'p1' })
    state.projectsById.p1 = { id: 'p1', organizationId: 'org-2' }
    state.orgRows = [{ id: 'org-2' }]
    const p = await resolveUserApiKeyPrincipal(bearer({ 'X-Veerify-Organization': 'org-two' }))
    expect(p?.session.activeProjectId).toBe('p1')
  })

  it('403s when the project header names a project the user cannot open', async () => {
    setRow()
    state.projectsById.p2 = { id: 'p2', organizationId: 'org-9' }
    state.projectRole = null
    await expect(resolveUserApiKeyPrincipal(bearer({ 'X-Veerify-Project': 'p2' }))).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it('403s when the project header names a project outside the organization header', async () => {
    setRow()
    state.orgRows = [{ id: 'org-2' }]
    state.projectsById.p9 = { id: 'p9', organizationId: 'org-9' }
    await expect(
      resolveUserApiKeyPrincipal(bearer({ 'X-Veerify-Organization': 'org-two', 'X-Veerify-Project': 'p9' }))
    ).rejects.toMatchObject({ statusCode: 403, data: { error: { code: 'FORBIDDEN' } } })
  })

  it('accepts a project header inside the organization header', async () => {
    setRow()
    state.orgRows = [{ id: 'org-2' }]
    state.projectsById.p8 = { id: 'p8', organizationId: 'org-2' }
    const p = await resolveUserApiKeyPrincipal(bearer({ 'X-Veerify-Organization': 'org-two', 'X-Veerify-Project': 'p8' }))
    expect(p?.session.activeOrganizationId).toBe('org-2')
    expect(p?.session.activeProjectId).toBe('p8')
  })

  it('sets the active organization from the project header', async () => {
    setRow()
    state.projectsById.p2 = { id: 'p2', organizationId: 'org-9' }
    const p = await resolveUserApiKeyPrincipal(bearer({ 'X-Veerify-Project': 'p2' }))
    expect(p?.session.activeProjectId).toBe('p2')
    expect(p?.session.activeOrganizationId).toBe('org-9')
  })

  it('resolves a project slug inside the effective org', async () => {
    setRow()
    state.projectRows = [{ id: 'p3', organizationId: 'org-1' }]
    const p = await resolveUserApiKeyPrincipal(bearer({ 'X-Veerify-Project': 'my-slug' }))
    expect(p?.session.activeProjectId).toBe('p3')
  })

  it('403s on a project slug when there is no effective org', async () => {
    setRow({ activeOrganizationId: null })
    state.projectRows = [{ id: 'p3', organizationId: 'org-1' }]
    await expect(resolveUserApiKeyPrincipal(bearer({ 'X-Veerify-Project': 'my-slug' }))).rejects.toMatchObject({
      statusCode: 403,
    })
  })
})
