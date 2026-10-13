import { beforeEach, describe, expect, it, vi } from 'vitest'

const lookupMock = vi.hoisted(() => vi.fn())
const requestMock = vi.hoisted(() => vi.fn())

vi.mock('node:dns/promises', () => ({ lookup: lookupMock }))
vi.mock('node:http', () => ({ default: { request: requestMock } }))
vi.mock('node:https', () => ({ default: { request: requestMock } }))

const { isPrivateWebhookAddress, postWebhookJson, validateWebhookUrlForRequest, validateWebhookUrlSyntax } =
  await import('~/server/utils/webhook-url')

type MockRequestOptions = {
  hostname: string
  lookup: (...args: [string, object, (...args: [unknown, string, number]) => void]) => void
}

type MockResponse = {
  statusCode: number
  resume: () => void
}

describe('webhook URL security', () => {
  beforeEach(() => {
    lookupMock.mockReset()
    requestMock.mockReset()
  })

  it.each([
    '0.0.0.0',
    '0.1.2.3',
    '100.64.0.1',
    '100.127.255.254',
    '192.0.0.8',
    '198.18.0.1',
    '198.19.255.255',
    '224.0.0.1',
    '239.255.255.250',
    '240.0.0.1',
    '255.255.255.255',
    'ff02::1',
    'fec0::1',
    '64:ff9b::7f00:1',
    '64:ff9b::10.0.0.1',
    '2002:c0a8:0101::1',
    '2002:7f00:1::',
    '::ffff:100.64.0.1',
    '::ffff:c0a8:1',
  ])('blocks non-public address %s', (address) => {
    expect(isPrivateWebhookAddress(address)).toBe(true)
  })

  it.each([
    '8.8.8.8',
    '100.63.255.255',
    '100.128.0.1',
    '198.17.0.1',
    '198.20.0.1',
    '223.255.255.255',
    '2606:4700::1111',
    '64:ff9b::808:808',
    '2002:808:808::1',
    '::ffff:8.8.8.8',
  ])('allows public address %s', (address) => {
    expect(isPrivateWebhookAddress(address)).toBe(false)
  })

  it('recognizes canonical IPv4-mapped IPv6 private addresses', () => {
    expect(isPrivateWebhookAddress('::ffff:a00:1')).toBe(true)
    expect(() => validateWebhookUrlSyntax('http://[::ffff:10.0.0.1]/hook')).toThrow(
      'Webhook URL must not target a private or local address'
    )
  })

  it('recognizes canonical IPv4-mapped IPv6 loopback addresses', () => {
    expect(isPrivateWebhookAddress('::ffff:7f00:1')).toBe(true)
    expect(() => validateWebhookUrlSyntax('http://[::ffff:127.0.0.1]/hook')).toThrow(
      'Webhook URL must not target a private or local address'
    )
  })

  it('rejects a DNS answer set containing a private address', async () => {
    lookupMock.mockResolvedValue([
      { address: '203.0.113.10', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])

    await expect(validateWebhookUrlForRequest('https://hooks.example.test/hook')).rejects.toThrow(
      'Webhook URL must not resolve to a private or local address'
    )
  })

  it('pins delivery to the public address checked immediately before the request', async () => {
    lookupMock.mockResolvedValue([{ address: '203.0.113.10', family: 4 }])
    let pinnedAddress: { address: string; family: number } | undefined

    requestMock.mockImplementation(
      (options: MockRequestOptions, responseHandler: (...args: [MockResponse]) => void) => {
        options.lookup(options.hostname, {}, (_error: unknown, address: string, family: number) => {
          pinnedAddress = { address, family }
        })
        responseHandler({ statusCode: 204, resume: () => undefined })
        return {
          setTimeout: () => undefined,
          on: () => undefined,
          end: () => undefined,
        }
      }
    )

    await expect(postWebhookJson('https://hooks.example.test/hook', { ok: true })).resolves.toBe(204)
    expect(lookupMock).toHaveBeenCalledTimes(1)
    expect(pinnedAddress).toEqual({ address: '203.0.113.10', family: 4 })
  })

  it('rejects private DNS answers before opening the delivery request', async () => {
    lookupMock.mockResolvedValue([{ address: '192.168.1.10', family: 4 }])

    await expect(postWebhookJson('https://hooks.example.test/hook', { ok: true })).rejects.toThrow(
      'Webhook URL must not resolve to a private or local address'
    )
    expect(requestMock).not.toHaveBeenCalled()
  })
})
