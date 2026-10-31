import { describe, expect, it, vi } from 'vitest'

import { MailgunSendingDomainProvider } from '../server/services/sending-domains/providers/mailgun'
import { SendingDomainProviderError } from '../server/services/sending-domains/types'
import type { ProviderReceivingState, SendingDomainProvider } from '../server/services/sending-domains/types'
import type { FetchImpl } from '../server/services/support-channels/types'

vi.mock('~/server/services/sending-domains', () => ({ getSendingDomainProvider: vi.fn(() => null) }))
vi.mock('~/server/database/drizzle', () => ({ db: {} }))

const { MAX_FORWARDING_BRAND_LENGTH, syncForwardingBrand, toForwardingBrandName } =
  await import('../server/utils/forwarding-brand')

const receivingBody = (extra: Record<string, unknown> = {}) => ({
  data: { domain: 'mail.example.com', status: 'active', records: [], forwarding_paused: false, ...extra },
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function frogmail(fetchImpl: ReturnType<typeof vi.fn>) {
  return new MailgunSendingDomainProvider({
    apiKey: 'key-secret',
    accountKey: 'acct',
    apiBaseUrl: 'https://frogmail.test',
    fetchImpl: fetchImpl as unknown as FetchImpl,
    forwarding: true,
  })
}

const state = (forwardingBrandName?: string | null): ProviderReceivingState => ({
  status: 'active',
  forwardingPaused: false,
  records: [],
  lastReceivedAt: null,
  ...(forwardingBrandName !== undefined ? { forwardingBrandName } : {}),
})

describe('toForwardingBrandName', () => {
  it('keeps one trimmed line of at most 80 characters', () => {
    expect(toForwardingBrandName('  Acme\nSupport\r\n Team  ')).toBe('Acme Support Team')
    expect(toForwardingBrandName('a'.repeat(120))).toHaveLength(MAX_FORWARDING_BRAND_LENGTH)
    expect(toForwardingBrandName(' \n\t ')).toBeNull()
    expect(toForwardingBrandName(null)).toBeNull()
  })
})

describe('Frogmail provider brand name', () => {
  it('sends forwarding_brand_name with PUT when receiving is enabled, and reads it back', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(receivingBody({ forwarding_brand_name: 'Acme' })))
    const result = await frogmail(fetchImpl).enableReceiving('mail.example.com', { brandName: 'Acme' })

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://frogmail.test/api/v1/domains/mail.example.com/receiving')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual({ provider: 'ses', forwarding_brand_name: 'Acme' })
    expect(result.forwardingBrandName).toBe('Acme')
  })

  it('reports no brand field for a Frogmail without brand support', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(receivingBody()))
    const result = await frogmail(fetchImpl).getReceiving('mail.example.com')
    expect(result).not.toBeNull()
    expect(result!.forwardingBrandName).toBeUndefined()
  })

  it('sets the brand with a PATCH carrying only that field', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(receivingBody({ forwarding_brand_name: 'New name' })))
    await frogmail(fetchImpl).setForwardingBrandName('mail.example.com', 'New name')
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ forwarding_brand_name: 'New name' })
  })
})

describe('syncForwardingBrand', () => {
  const provider = (setForwardingBrandName: ReturnType<typeof vi.fn>) =>
    ({ setForwardingBrandName }) as unknown as SendingDomainProvider

  it('skips the call when Frogmail already has the brand', async () => {
    const set = vi.fn()
    expect(
      await syncForwardingBrand({
        provider: provider(set),
        domain: 'd.test',
        brandName: 'Acme',
        reported: state('Acme'),
      })
    ).toBe('unchanged')
    expect(set).not.toHaveBeenCalled()
  })

  it('skips the call when Frogmail does not report the field (older version)', async () => {
    const set = vi.fn()
    expect(
      await syncForwardingBrand({ provider: provider(set), domain: 'd.test', brandName: 'Acme', reported: state() })
    ).toBe('unsupported')
    expect(set).not.toHaveBeenCalled()
  })

  it('patches when the stored brand differs', async () => {
    const set = vi.fn().mockResolvedValue(state('Acme'))
    expect(
      await syncForwardingBrand({ provider: provider(set), domain: 'd.test', brandName: 'Acme', reported: state(null) })
    ).toBe('updated')
    expect(set).toHaveBeenCalledWith('d.test', 'Acme')
  })

  it('logs and ignores a 422 from an older Frogmail instead of failing', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        json({ message: 'The forwarding paused field is required.', errors: { forwarding_paused: ['required'] } }, 422)
      )
    const outcome = await syncForwardingBrand({
      provider: frogmail(fetchImpl),
      domain: 'mail.example.com',
      brandName: 'Acme',
    })
    expect(outcome).toBe('failed')
  })

  it('never throws on a provider error', async () => {
    const set = vi.fn().mockRejectedValue(new SendingDomainProviderError('provider_unavailable', 'down', true))
    await expect(syncForwardingBrand({ provider: provider(set), domain: 'd.test', brandName: 'Acme' })).resolves.toBe(
      'failed'
    )
  })
})
