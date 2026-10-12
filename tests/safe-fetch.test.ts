import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SafeFetchError, safeFetchText } from '../server/utils/safe-fetch'

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  handler: vi.fn(),
  calls: [] as Record<string, unknown>[],
}))

vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup, default: { lookup: mocks.lookup } }))

function fakeRequest(options: Record<string, unknown>, onResponse: (res: EventEmitter) => void) {
  mocks.calls.push(options)
  const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void }
  req.destroy = vi.fn()
  req.end = () => {
    const spec = mocks.handler(options) as {
      status?: number
      headers?: Record<string, string>
      chunks?: string[]
      hang?: boolean
    }
    if (spec.hang) return
    const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: unknown; resume: () => void }
    res.statusCode = spec.status ?? 200
    res.headers = spec.headers ?? {}
    res.resume = () => setImmediate(() => res.emit('end'))
    onResponse(res)
    if (!(res.statusCode >= 300 && res.statusCode < 400)) {
      setImmediate(() => {
        for (const chunk of spec.chunks ?? []) res.emit('data', Buffer.from(chunk))
        res.emit('end')
      })
    }
  }
  return req
}

vi.mock('node:http', () => {
  const request = fakeRequest
  return { default: { request }, request }
})
vi.mock('node:https', () => {
  const request = fakeRequest
  return { default: { request }, request }
})

async function kindOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(SafeFetchError)
    return (error as SafeFetchError).kind
  }
  return null
}

describe('safeFetchText', () => {
  beforeEach(() => {
    mocks.calls.length = 0
    mocks.lookup.mockReset()
    mocks.handler.mockReset()
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    mocks.handler.mockReturnValue({ status: 200, headers: { 'content-type': 'text/plain' }, chunks: ['hello'] })
  })

  it('fetches text and pins the resolved address', async () => {
    const result = await safeFetchText('https://example.com/robots.txt', { userAgent: 'VeerifyBot' })
    expect(result).toMatchObject({
      status: 200,
      body: 'hello',
      truncated: false,
      contentType: 'text/plain',
      finalUrl: 'https://example.com/robots.txt',
    })
    const lookupFn = mocks.calls[0].lookup as (h: string, o: object, cb: (...a: unknown[]) => void) => void
    const cb = vi.fn()
    lookupFn('example.com', {}, cb)
    expect(cb).toHaveBeenCalledWith(null, '93.184.216.34', 4)
    expect((mocks.calls[0].headers as Record<string, string>)['user-agent']).toBe('VeerifyBot')
  })

  it('blocks hosts resolving to private addresses', async () => {
    mocks.lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ])
    expect(await kindOf(safeFetchText('https://evil.example/'))).toBe('blocked_address')
    expect(mocks.calls).toHaveLength(0)
  })

  it('blocks literal private IPs, localhost and bad schemes', async () => {
    expect(await kindOf(safeFetchText('http://127.0.0.1/'))).toBe('blocked_address')
    expect(await kindOf(safeFetchText('http://localhost/'))).toBe('blocked_address')
    expect(await kindOf(safeFetchText('ftp://example.com/'))).toBe('invalid_url')
    expect(await kindOf(safeFetchText('not a url'))).toBe('invalid_url')
  })

  it('blocks non-standard ports unless the original URL used them', async () => {
    expect(await kindOf(safeFetchText('https://example.com:6379/'))).toBeNull()
    mocks.handler.mockReturnValueOnce({ status: 302, headers: { location: 'https://example.com:22/x' } })
    expect(await kindOf(safeFetchText('https://example.com/'))).toBe('blocked_address')
  })

  it('follows redirects and re-validates each hop', async () => {
    mocks.handler
      .mockReturnValueOnce({ status: 301, headers: { location: '/next' } })
      .mockReturnValueOnce({ status: 200, chunks: ['ok'] })
    const result = await safeFetchText('https://example.com/start')
    expect(result.finalUrl).toBe('https://example.com/next')

    mocks.handler.mockReset()
    mocks.handler.mockReturnValueOnce({ status: 302, headers: { location: 'http://169.254.169.254/latest' } })
    expect(await kindOf(safeFetchText('https://example.com/'))).toBe('blocked_address')

    mocks.handler.mockReset()
    mocks.handler.mockReturnValueOnce({ status: 302, headers: { location: 'https://internal.test/' } })
    mocks.lookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    mocks.lookup.mockResolvedValueOnce([{ address: '192.168.1.1', family: 4 }])
    expect(await kindOf(safeFetchText('https://example.com/'))).toBe('blocked_address')
  })

  it('returns the redirect response instead of following it with manualRedirects', async () => {
    mocks.handler.mockReset()
    mocks.handler.mockReturnValueOnce({ status: 301, headers: { location: 'https://other.com/x' } })
    const result = await safeFetchText('https://example.com/start', { maxRedirects: 0, manualRedirects: true })
    expect(result.status).toBe(301)
    expect(result.headers.location).toBe('https://other.com/x')
    expect(mocks.handler).toHaveBeenCalledTimes(1)
  })

  it('throws too_many_redirects', async () => {
    mocks.handler.mockReturnValue({ status: 302, headers: { location: '/loop' } })
    expect(await kindOf(safeFetchText('https://example.com/', { maxRedirects: 2 }))).toBe('too_many_redirects')
  })

  it('truncates at maxBytes', async () => {
    mocks.handler.mockReturnValue({ status: 200, chunks: ['abcdef', 'ghij'] })
    const result = await safeFetchText('https://example.com/', { maxBytes: 4 })
    expect(result.body).toBe('abcd')
    expect(result.truncated).toBe(true)
  })

  it('times out', async () => {
    mocks.handler.mockReturnValue({ hang: true })
    expect(await kindOf(safeFetchText('https://example.com/', { timeoutMs: 20 }))).toBe('timeout')
  })

  it('maps DNS failure to network', async () => {
    mocks.lookup.mockRejectedValue(new Error('ENOTFOUND'))
    expect(await kindOf(safeFetchText('https://nope.example/'))).toBe('network')
  })
})
