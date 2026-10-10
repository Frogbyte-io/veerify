import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageSpeedError, parsePageSpeed, runPageSpeed } from '~/server/services/marketing/pagespeed'

const body = {
  lighthouseResult: {
    categories: { performance: { score: 0.87 } },
    audits: {
      'largest-contentful-paint': { numericValue: 2100.4 },
      'cumulative-layout-shift': { numericValue: 0.04 },
      'total-blocking-time': { numericValue: 150 },
      'first-contentful-paint': { numericValue: 900 },
    },
  },
  loadingExperience: {
    overall_category: 'AVERAGE',
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2500, category: 'FAST' },
      INTERACTION_TO_NEXT_PAINT: { percentile: 180 },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 8 },
    },
  },
}

afterEach(() => vi.unstubAllGlobals())

describe('parsePageSpeed', () => {
  it('maps lab and field metrics', () => {
    const r = parsePageSpeed(body, new Date('2026-10-10T00:00:00Z'))
    expect(r.performanceScore).toBe(87)
    expect(r.lab).toEqual({ lcpMs: 2100.4, cls: 0.04, tbtMs: 150, fcpMs: 900 })
    expect(r.field).toEqual({ lcpMs: 2500, inpMs: 180, cls: 0.08, category: 'AVERAGE' })
    expect(r.fetchedAt).toBe('2026-10-10T00:00:00.000Z')
  })

  it('returns null field data when the origin has none', () => {
    const r = parsePageSpeed({ lighthouseResult: body.lighthouseResult, loadingExperience: { metrics: {} } })
    expect(r.field).toBeNull()
  })

  it('tolerates a sparse response', () => {
    const r = parsePageSpeed({})
    expect(r.performanceScore).toBeNull()
    expect(r.lab.lcpMs).toBeNull()
  })
})

describe('runPageSpeed', () => {
  it('requests mobile performance and parses the result', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await runPageSpeed('https://example.com/', 'k', { strategy: 'mobile' })
    expect(r.performanceScore).toBe(87)
    const url = new URL((fetchMock.mock.calls[0] as unknown as [string])[0])
    expect(url.host).toBe('www.googleapis.com')
    expect(url.searchParams.get('strategy')).toBe('mobile')
    expect(url.searchParams.get('url')).toBe('https://example.com/')
  })

  it('maps HTTP errors without leaking the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 403 }))
    )
    const err = await runPageSpeed('https://example.com/', 'secret-key').catch((e) => e)
    expect(err).toBeInstanceOf(PageSpeedError)
    expect(err.kind).toBe('auth')
    expect(err.message).not.toContain('secret-key')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 429 }))
    )
    expect(await runPageSpeed('https://example.com/', 'k').catch((e) => e.kind)).toBe('quota')
  })

  it('wraps network failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('fetch failed key=secret-key')))
    )
    const err = await runPageSpeed('https://example.com/', 'secret-key').catch((e) => e)
    expect(err.kind).toBe('failed')
    expect(err.message).not.toContain('secret-key')
  })
})
