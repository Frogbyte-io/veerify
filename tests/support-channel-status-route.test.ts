import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Channel status never names missing settings to customers; the server log does. */
const state = vi.hoisted(() => ({
  driver: { isConfigured: () => ({ configured: false, missing: ['SUPPORT_MAILGUN_API_KEY'] }) } as unknown,
  warnings: [] as unknown[][],
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.mock('~/server/utils/auth-middleware', () => ({ requireAuth: vi.fn(async () => ({ user: { id: 'user-1' } })) }))
vi.mock('~/server/utils/support-access', () => ({ requireInboxRole: vi.fn(async () => undefined) }))
vi.mock('~/server/utils/validation', () => ({ validateQuery: () => ({ inboxId: 'inbox-1' }) }))
vi.mock('~/server/utils/platform-address', () => ({
  getPlatformMailDomain: () => null,
  findPlatformAddress: vi.fn(),
}))
vi.mock('~/server/services/support-channels', () => ({
  SUPPORT_CHANNEL_PROVIDERS: ['postmark', 'mailgun'],
  getConfiguredChannelDriver: () => state.driver,
  getConfiguredChannelProviderName: () => 'mailgun',
}))
vi.mock('~/server/utils/logger', () => ({
  createLogger: () => ({ warn: (...args: unknown[]) => state.warnings.push(args), info: vi.fn(), error: vi.fn() }),
}))

const handler = (await import('~/server/api/support/channel-status.get')).default as unknown as (
  event: unknown
) => Promise<{ data: Record<string, unknown> }>

beforeEach(() => {
  state.warnings = []
})

describe('GET /api/support/channel-status', () => {
  it('reports missing credentials as a flag only and logs the names', async () => {
    const res = await handler({})
    expect(res.data).toMatchObject({ credentialsConfigured: false, missingEnvVars: [] })
    expect(JSON.stringify(res.data)).not.toContain('SUPPORT_MAILGUN_API_KEY')
    expect(JSON.stringify(state.warnings)).toContain('SUPPORT_MAILGUN_API_KEY')
  })

  it('reports a configured channel', async () => {
    state.driver = { isConfigured: () => ({ configured: true, missing: [] }) }
    const res = await handler({})
    expect(res.data).toMatchObject({ credentialsConfigured: true, driverAvailable: true, missingEnvVars: [] })
  })
})
