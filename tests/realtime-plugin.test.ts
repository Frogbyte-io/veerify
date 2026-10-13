import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  session: { value: { user: { id: 'user-1' } } },
  useSession: vi.fn(),
  watchCallback: null as (() => void) | null,
  client: null as {
    notifyHidden: ReturnType<typeof vi.fn>
    notifyVisible: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
    resume: ReturnType<typeof vi.fn>
    connect: ReturnType<typeof vi.fn>
    resetAuth: ReturnType<typeof vi.fn>
  } | null,
  windowListeners: new Map<string, () => void>(),
  documentListeners: new Map<string, () => void>(),
}))

const fakeWindow = vi.hoisted(() => ({
  location: { protocol: 'https:', host: 'app.example.test' },
  addEventListener: (name: string, listener: () => void) => state.windowListeners.set(name, listener),
}))

const fakeDocument = vi.hoisted(() => ({
  hidden: false,
  addEventListener: (name: string, listener: () => void) => state.documentListeners.set(name, listener),
}))

vi.stubGlobal('defineNuxtPlugin', (handler: unknown) => handler)
vi.stubGlobal('window', fakeWindow)
vi.stubGlobal('document', fakeDocument)
vi.stubGlobal('useFetch', vi.fn())
vi.stubGlobal(
  'watch',
  vi.fn((_source: unknown, callback: () => void) => {
    state.watchCallback = callback
  })
)

vi.mock('~/lib/dashboard-bootstrap-client', () => ({
  fetchDashboardBootstrap: vi.fn(async () => null),
  getCachedDashboardBootstrap: vi.fn(() => null),
}))

vi.mock('~/lib/auth-client', () => ({
  authClient: {
    useSession: state.useSession,
  },
}))

vi.mock('~/lib/realtime-client', () => ({
  RealtimeClient: class {
    notifyHidden = vi.fn()
    notifyVisible = vi.fn()
    disconnect = vi.fn()
    resume = vi.fn()
    connect = vi.fn()
    resetAuth = vi.fn()

    constructor() {
      state.client = this
    }
  },
}))

const plugin = (await import('~/plugins/realtime.client')).default

describe('realtime Nuxt plugin lifecycle', () => {
  beforeEach(() => {
    state.session = { value: { user: { id: 'user-1' } } }
    state.useSession.mockResolvedValue({ data: state.session })
    state.watchCallback = null
    state.client = null
    state.windowListeners.clear()
    state.documentListeners.clear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('wires page lifecycle events to the realtime client and resumes after pageshow', async () => {
    const result = (await plugin({} as never)) as { provide: { realtime: unknown } }
    const client = state.client!

    expect(result.provide.realtime).toBe(client)
    expect(state.windowListeners.has('pagehide')).toBe(true)
    expect(state.windowListeners.has('pageshow')).toBe(true)

    state.windowListeners.get('pagehide')?.()
    expect(client.disconnect).toHaveBeenCalledTimes(1)

    state.windowListeners.get('pageshow')?.()
    expect(client.resume).toHaveBeenCalledTimes(1)
    expect(client.connect).not.toHaveBeenCalled()
  })

  it('waits for session initialization and resets auth on observed user transitions', async () => {
    const result = (await plugin({} as never)) as { provide: { realtime: unknown } }
    expect(result.provide.realtime).toBe(state.client)
    expect(state.useSession).toHaveBeenCalledTimes(1)
    expect(state.watchCallback).toBeTypeOf('function')

    state.watchCallback?.()
    state.watchCallback?.()

    expect(state.client?.resetAuth).toHaveBeenCalledTimes(2)
  })
})
