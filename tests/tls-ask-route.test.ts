import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  domain: '',
  config: {
    public: {
      appDomain: 'build.example.test',
      dashboardDomain: 'app.build.example.test',
    },
  },
  teamExists: false,
  projectDomainStatus: null as 'active' | 'dns_required' | null,
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getQuery', () => ({ domain: state.domain }))
vi.stubGlobal('useRuntimeConfig', () => state.config)
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string }) =>
  Object.assign(new Error(input.statusMessage), input)
)

vi.mock('~/server/utils/rate-limit', () => ({
  requireRateLimit: vi.fn(async () => undefined),
}))

vi.mock('~/server/utils/project-access', () => ({
  findPublicProjectByDomain: vi.fn(async () =>
    state.projectDomainStatus
      ? { project: { id: 'project-1' }, team: { id: 'team-1' }, domainStatus: state.projectDomainStatus }
      : undefined
  ),
}))

vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: vi.fn(() => {
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: async () => (state.teamExists ? [{ id: 'team-1' }] : []),
      }
      return chain
    }),
  },
}))

const handler = (await import('~/server/api/system/tls-ask.get')).default

describe('TLS ask route live domain configuration', () => {
  beforeEach(() => {
    state.domain = ''
    state.teamExists = false
    state.projectDomainStatus = null
    vi.stubEnv('APP_DOMAIN', '')
    vi.stubEnv('APP_DASHBOARD_DOMAIN', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('allows the live dashboard domain over the build-time dashboard domain', async () => {
    vi.stubEnv('APP_DASHBOARD_DOMAIN', 'app.live.example.test')
    state.domain = 'app.live.example.test'

    await expect(handler({} as never)).resolves.toEqual({ allowed: true })
  })

  it('derives the live dashboard domain from APP_DOMAIN when no dashboard override is set', async () => {
    vi.stubEnv('APP_DOMAIN', 'live.example.test')
    state.domain = 'app.live.example.test'

    await expect(handler({} as never)).resolves.toEqual({ allowed: true })
  })

  it('rejects the build-time dashboard domain when a live override is configured', async () => {
    vi.stubEnv('APP_DASHBOARD_DOMAIN', 'app.live.example.test')
    state.domain = 'app.build.example.test'

    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('allows a known team under the live app domain over the build-time app domain', async () => {
    vi.stubEnv('APP_DOMAIN', 'live.example.test')
    state.domain = 'acme.live.example.test'
    state.teamExists = true

    await expect(handler({} as never)).resolves.toEqual({ allowed: true })
  })

  it('rejects a team hostname under the build-time app domain when a live override is configured', async () => {
    vi.stubEnv('APP_DOMAIN', 'live.example.test')
    state.domain = 'acme.build.example.test'
    state.teamExists = true

    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('allows a custom domain only when its stored status is active', async () => {
    state.domain = 'feedback.example.test'
    state.projectDomainStatus = 'active'

    await expect(handler({} as never)).resolves.toEqual({ allowed: true })
  })

  it('rejects a custom domain whose stored status is not active', async () => {
    state.domain = 'feedback.example.test'
    state.projectDomainStatus = 'dns_required'

    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 403 })
  })
})
