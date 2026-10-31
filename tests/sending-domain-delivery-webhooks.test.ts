import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('~/server/utils/logger', () => ({ createLogger: () => log }))
vi.mock('~/server/database/drizzle', () => ({ db: {} }))

const { MAX_WEBHOOK_URLS, MailgunSendingDomainProvider } =
  await import('~/server/services/sending-domains/providers/mailgun')
const { DELIVERY_WEBHOOK_EVENTS, deliveryWebhookUrl, deliveryWebhooksKey, syncDeliveryWebhooks } =
  await import('~/server/utils/sending-domain-webhooks')
const { SendingDomainProviderError } = await import('~/server/services/sending-domains/types')
type FetchImpl = import('~/server/services/support-channels/types').FetchImpl

const URL_OURS = 'https://app.veerify.test/api/support/delivery/mailgun'
const BASE = 'https://frogmail.test/v3/domains/acme.com/webhooks'
const SIGNING_KEY = 'signing-key-plain-text-0123456789'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** A fake Frogmail webhook API: `GET` lists, `POST` creates (400 if it exists), `PUT` replaces. */
function frogmail(initial: Record<string, string[]> = {}, opts: { issueKey?: boolean } = {}) {
  const state: Record<string, string[]> = { ...initial }
  let keyIssued = !opts.issueKey
  const saved = (event: string, message: string) => {
    const body: Record<string, unknown> = { message, webhook: { urls: state[event] } }
    if (!keyIssued) {
      keyIssued = true
      body.mailgun_signing_key = SIGNING_KEY
      body.mailgun_signing_key_id = 'key_1'
    }
    return json(body)
  }
  const fetchImpl = vi.fn(async (input: string, init: RequestInit) => {
    const url = String(input)
    const form = new URLSearchParams(String(init.body ?? ''))
    if (init.method === 'GET' && url === BASE) {
      const webhooks: Record<string, { urls: string[] }> = {}
      for (const [event, urls] of Object.entries(state)) if (urls.length) webhooks[event] = { urls }
      return json({ webhooks })
    }
    if (init.method === 'POST' && url === BASE) {
      const event = form.get('id')!
      if (state[event]?.length)
        return json({ message: `Webhook ${event} already exists. Use PUT to change its URLs.` }, 400)
      state[event] = form.getAll('url')
      return saved(event, 'Webhook has been created')
    }
    if (init.method === 'PUT' && url.startsWith(`${BASE}/`)) {
      const event = decodeURIComponent(url.slice(BASE.length + 1))
      if (!state[event]?.length) return json({ message: 'Webhook not found' }, 404)
      state[event] = form.getAll('url')
      return saved(event, 'Webhook has been updated')
    }
    return json({ message: 'unexpected' }, 500)
  })
  const provider = new MailgunSendingDomainProvider({
    apiKey: 'key-secret',
    accountKey: 'acct',
    apiBaseUrl: 'https://frogmail.test',
    fetchImpl: fetchImpl as unknown as FetchImpl,
  })
  return { state, fetchImpl, provider }
}

const methods = (fetchImpl: ReturnType<typeof vi.fn>) =>
  fetchImpl.mock.calls.map(([url, init]) => `${(init as RequestInit).method} ${String(url).replace(BASE, '')}`)

describe('MailgunSendingDomainProvider.ensureDeliveryWebhooks', () => {
  it('creates all four events when none exist, one POST each with id and url', async () => {
    const api = frogmail()
    const result = await api.provider.ensureDeliveryWebhooks('Acme.com', URL_OURS, DELIVERY_WEBHOOK_EVENTS)
    expect(result).toEqual({
      created: ['delivered', 'permanent_fail', 'temporary_fail', 'complained'],
      updated: [],
      unchanged: [],
      full: [],
      signingKeyIssued: false,
    })
    expect(methods(api.fetchImpl)).toEqual(['GET ', 'POST ', 'POST ', 'POST ', 'POST '])
    const [, init] = api.fetchImpl.mock.calls[1] as [string, RequestInit]
    expect(String(init.body)).toBe(`id=delivered&url=${encodeURIComponent(URL_OURS)}`)
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /)
    for (const event of DELIVERY_WEBHOOK_EVENTS) expect(api.state[event]).toEqual([URL_OURS])
  })

  it('adds only the missing events and leaves the configured ones alone', async () => {
    const api = frogmail({ delivered: [URL_OURS], permanent_fail: [URL_OURS] })
    const result = await api.provider.ensureDeliveryWebhooks('acme.com', URL_OURS, DELIVERY_WEBHOOK_EVENTS)
    expect(result).toMatchObject({
      created: ['temporary_fail', 'complained'],
      updated: [],
      unchanged: ['delivered', 'permanent_fail'],
    })
    expect(methods(api.fetchImpl)).toEqual(['GET ', 'POST ', 'POST '])
  })

  it('keeps foreign URLs and appends ours with PUT', async () => {
    const foreign = 'https://other.example/hooks'
    const api = frogmail({ delivered: [foreign], complained: [foreign, URL_OURS] })
    const result = await api.provider.ensureDeliveryWebhooks('acme.com', URL_OURS, DELIVERY_WEBHOOK_EVENTS)
    expect(result).toMatchObject({
      created: ['permanent_fail', 'temporary_fail'],
      updated: ['delivered'],
      unchanged: ['complained'],
    })
    expect(methods(api.fetchImpl)).toContain('PUT /delivered')
    expect(api.state.delivered).toEqual([foreign, URL_OURS])
    expect(api.state.complained).toEqual([foreign, URL_OURS])
  })

  it('makes no change when everything already points at us', async () => {
    const api = frogmail(Object.fromEntries(DELIVERY_WEBHOOK_EVENTS.map((event) => [event, [URL_OURS]])))
    const result = await api.provider.ensureDeliveryWebhooks('acme.com', URL_OURS, DELIVERY_WEBHOOK_EVENTS)
    expect(result.unchanged).toEqual([...DELIVERY_WEBHOOK_EVENTS])
    expect(methods(api.fetchImpl)).toEqual(['GET '])
  })

  it('respects the per-event URL limit instead of dropping someone else', async () => {
    const three = Array.from({ length: MAX_WEBHOOK_URLS }, (_, i) => `https://other${i}.example/hook`)
    const api = frogmail({ delivered: three })
    const result = await api.provider.ensureDeliveryWebhooks('acme.com', URL_OURS, DELIVERY_WEBHOOK_EVENTS)
    expect(result.full).toEqual(['delivered'])
    expect(api.state.delivered).toEqual(three)
    expect(methods(api.fetchImpl)).not.toContain('PUT /delivered')
  })

  it('reports a newly issued signing key without returning the key', async () => {
    const api = frogmail({}, { issueKey: true })
    const result = await api.provider.ensureDeliveryWebhooks('acme.com', URL_OURS, DELIVERY_WEBHOOK_EVENTS)
    expect(result.signingKeyIssued).toBe(true)
    expect(JSON.stringify(result)).not.toContain(SIGNING_KEY)
  })

  it('surfaces provider errors (POST race on an existing event, missing scope)', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) =>
      init.method === 'GET'
        ? json({ webhooks: {} })
        : json({ message: 'Webhook delivered already exists. Use PUT to change its URLs.' }, 400)
    )
    const provider = new MailgunSendingDomainProvider({
      apiKey: 'k',
      accountKey: 'acct',
      apiBaseUrl: 'https://frogmail.test',
      fetchImpl: fetchImpl as unknown as FetchImpl,
    })
    await expect(provider.ensureDeliveryWebhooks('acme.com', URL_OURS, ['delivered'])).rejects.toBeInstanceOf(
      SendingDomainProviderError
    )

    const scoped = new MailgunSendingDomainProvider({
      apiKey: 'k',
      accountKey: 'acct',
      apiBaseUrl: 'https://frogmail.test',
      fetchImpl: (async () =>
        new Response('{"message":"forbidden"}', {
          status: 403,
          headers: { 'X-Frogmail-Error': 'missing_scope' },
        })) as unknown as FetchImpl,
    })
    await expect(scoped.ensureDeliveryWebhooks('acme.com', URL_OURS, ['delivered'])).rejects.toMatchObject({
      code: 'missing_scope',
    })
  })
})

describe('syncDeliveryWebhooks', () => {
  const env = { ...process.env }
  beforeEach(() => {
    process.env.BETTER_AUTH_URL = 'https://app.veerify.test/'
    delete process.env.SUPPORT_DELIVERY_WEBHOOK_URL
    log.info.mockClear()
    log.warn.mockClear()
  })
  afterEach(() => {
    process.env = { ...env }
  })

  const claim = (deliveryWebhooksKey: string | null = null) => ({ id: 'sd-1', domain: 'acme.com', deliveryWebhooksKey })

  it('derives the URL from BETTER_AUTH_URL, or SUPPORT_DELIVERY_WEBHOOK_URL when set', async () => {
    expect(deliveryWebhookUrl('mailgun')).toBe(URL_OURS)
    process.env.SUPPORT_DELIVERY_WEBHOOK_URL = ' https://hooks.veerify.test/delivery '
    expect(deliveryWebhookUrl('mailgun')).toBe('https://hooks.veerify.test/delivery')

    const api = frogmail()
    const saveKey = vi.fn(async () => {})
    await syncDeliveryWebhooks(claim(), api.provider, { saveKey })
    for (const event of DELIVERY_WEBHOOK_EVENTS)
      expect(api.state[event]).toEqual(['https://hooks.veerify.test/delivery'])
    expect(saveKey).toHaveBeenCalledWith(
      'sd-1',
      deliveryWebhooksKey(api.provider, 'https://hooks.veerify.test/delivery')
    )
  })

  it('stores the marker once ensured and makes no provider call while it matches', async () => {
    const api = frogmail()
    const saveKey = vi.fn(async () => {})
    expect(await syncDeliveryWebhooks(claim(), api.provider, { saveKey })).toEqual({ status: 'ensured' })
    const key = deliveryWebhooksKey(api.provider, URL_OURS)
    expect(saveKey).toHaveBeenCalledWith('sd-1', key)
    api.fetchImpl.mockClear()

    expect(await syncDeliveryWebhooks(claim(key), api.provider, { saveKey })).toEqual({ status: 'unchanged' })
    expect(api.fetchImpl).not.toHaveBeenCalled()
  })

  it('ensures again when the URL changes (stale marker), adding only what is missing', async () => {
    const api = frogmail(Object.fromEntries(DELIVERY_WEBHOOK_EVENTS.map((event) => [event, [URL_OURS]])))
    const stale = deliveryWebhooksKey(api.provider, URL_OURS)
    process.env.SUPPORT_DELIVERY_WEBHOOK_URL = 'https://new.veerify.test/delivery'
    const saveKey = vi.fn(async () => {})
    expect(await syncDeliveryWebhooks(claim(stale), api.provider, { saveKey })).toEqual({ status: 'ensured' })
    expect(api.state.delivered).toEqual([URL_OURS, 'https://new.veerify.test/delivery'])
    expect(saveKey).toHaveBeenCalledWith('sd-1', deliveryWebhooksKey(api.provider, 'https://new.veerify.test/delivery'))
  })

  it('swallows a failure without storing the marker, so the next check retries', async () => {
    let down = true
    const api = frogmail()
    const real = api.fetchImpl.getMockImplementation()!
    api.fetchImpl.mockImplementation(async (url: string, init: RequestInit) =>
      down ? new Response('oops', { status: 503 }) : real(url, init)
    )
    const saveKey = vi.fn(async () => {})
    expect(await syncDeliveryWebhooks(claim(), api.provider, { saveKey })).toEqual({
      status: 'error',
      code: 'provider_unavailable',
    })
    expect(saveKey).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('retrying'), {
      domainId: 'sd-1',
      code: 'provider_unavailable',
    })

    down = false
    expect(await syncDeliveryWebhooks(claim(), api.provider, { saveKey })).toEqual({ status: 'ensured' })
    expect(saveKey).toHaveBeenCalledTimes(1)
  })

  it('does not store the marker while an event is full', async () => {
    const three = Array.from({ length: MAX_WEBHOOK_URLS }, (_, i) => `https://other${i}.example/hook`)
    const api = frogmail({ complained: three })
    const saveKey = vi.fn(async () => {})
    expect(await syncDeliveryWebhooks(claim(), api.provider, { saveKey })).toEqual({ status: 'incomplete' })
    expect(saveKey).not.toHaveBeenCalled()
  })

  it('warns about a newly issued signing key and never logs it', async () => {
    const api = frogmail({}, { issueKey: true })
    const saveKey = vi.fn(async () => {})
    expect(await syncDeliveryWebhooks(claim(), api.provider, { saveKey })).toEqual({ status: 'ensured' })
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('SUPPORT_MAILGUN_SIGNING_KEY'), expect.anything())
    const logged = JSON.stringify([...log.warn.mock.calls, ...log.info.mock.calls])
    expect(logged).not.toContain(SIGNING_KEY)
    expect(JSON.stringify(saveKey.mock.calls)).not.toContain(SIGNING_KEY)
  })

  it('skips providers without webhook management and an unusable URL', async () => {
    const postmark = { name: 'postmark', accountKey: 'a' } as never
    expect(await syncDeliveryWebhooks(claim(), postmark)).toEqual({ status: 'unsupported' })

    delete process.env.BETTER_AUTH_URL
    const api = frogmail()
    expect(await syncDeliveryWebhooks(claim(), api.provider, { saveKey: vi.fn() })).toEqual({ status: 'no_url' })
    expect(api.fetchImpl).not.toHaveBeenCalled()
  })
})
