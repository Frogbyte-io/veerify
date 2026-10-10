import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  checkVerification,
  generateVerificationToken,
  isCoveredByVerifiedDomain,
  normalizeSiteOrigin,
  SiteOriginError,
} from '../server/services/marketing/site-verification'

const mocks = vi.hoisted(() => ({ safeFetchText: vi.fn(), resolveTxt: vi.fn() }))
vi.mock('../server/utils/safe-fetch', () => ({ safeFetchText: mocks.safeFetchText }))
vi.mock('node:dns/promises', () => ({ resolveTxt: mocks.resolveTxt, default: { resolveTxt: mocks.resolveTxt } }))

const TOKEN = 'tok_123-abc'

function page(body: string, status = 200) {
  return { status, body, finalUrl: '', headers: {}, truncated: false, contentType: null }
}

beforeEach(() => {
  mocks.safeFetchText.mockReset()
  mocks.resolveTxt.mockReset()
})

describe('normalizeSiteOrigin', () => {
  it.each([
    ['Acme.com', 'https://acme.com'],
    ['http://www.Acme.com/pricing?x=1#y', 'https://www.acme.com'],
    ['https://acme.com:8443/a', 'https://acme.com:8443'],
    ['  blog.acme.co.uk/ ', 'https://blog.acme.co.uk'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeSiteOrigin(input)).toBe(expected)
  })

  it.each([
    '',
    'localhost',
    '127.0.0.1',
    'http://192.168.1.5',
    '[::1]',
    'intranet',
    'foo.local',
    'ftp://acme.com',
    'a b',
  ])('rejects %j', (input) => {
    expect(() => normalizeSiteOrigin(input)).toThrow(SiteOriginError)
  })
})

describe('generateVerificationToken', () => {
  it('is url-safe, long enough and unique', () => {
    const a = generateVerificationToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(generateVerificationToken()).not.toBe(a)
  })
})

describe('checkVerification', () => {
  it('dns: matches on the host', async () => {
    mocks.resolveTxt.mockResolvedValueOnce([['v=spf1'], [`veerify-site-verification=${TOKEN}`]])
    expect(await checkVerification('https://acme.com', TOKEN, 'dns')).toMatchObject({ verified: true })
  })

  it('dns: matches on _veerify and joins split chunks', async () => {
    mocks.resolveTxt.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'ENODATA' }))
    mocks.resolveTxt.mockResolvedValueOnce([['veerify-site-verification=', TOKEN]])
    expect(await checkVerification('https://acme.com', TOKEN, 'dns')).toMatchObject({ verified: true })
    expect(mocks.resolveTxt).toHaveBeenLastCalledWith('_veerify.acme.com')
  })

  it('dns: fails without a matching record', async () => {
    mocks.resolveTxt.mockResolvedValue([['veerify-site-verification=other']])
    expect((await checkVerification('https://acme.com', TOKEN, 'dns')).verified).toBe(false)
  })

  it.each([
    `<meta name="veerify-site-verification" content="${TOKEN}">`,
    `<meta content='${TOKEN}' name='veerify-site-verification' />`,
    `<META NAME=veerify-site-verification CONTENT=${TOKEN}>`,
  ])('meta: accepts %s', async (tag) => {
    mocks.safeFetchText.mockResolvedValue(page(`<html><head>${tag}</head></html>`))
    expect(await checkVerification('https://acme.com', TOKEN, 'meta')).toMatchObject({ verified: true })
  })

  it('meta: rejects wrong token or missing tag', async () => {
    mocks.safeFetchText.mockResolvedValue(page('<meta name="veerify-site-verification" content="nope">'))
    expect((await checkVerification('https://acme.com', TOKEN, 'meta')).verified).toBe(false)
    mocks.safeFetchText.mockResolvedValue(page('<html></html>'))
    expect((await checkVerification('https://acme.com', TOKEN, 'meta')).verified).toBe(false)
  })

  it('file: trims the body and compares', async () => {
    mocks.safeFetchText.mockResolvedValue(page(`  ${TOKEN}\n`))
    expect(await checkVerification('https://acme.com', TOKEN, 'file')).toMatchObject({ verified: true })
    expect(mocks.safeFetchText.mock.calls[0][0]).toBe('https://acme.com/.well-known/veerify-verification.txt')
    mocks.safeFetchText.mockResolvedValue(page('different'))
    expect((await checkVerification('https://acme.com', TOKEN, 'file')).verified).toBe(false)
    mocks.safeFetchText.mockResolvedValue(page(TOKEN, 404))
    expect((await checkVerification('https://acme.com', TOKEN, 'file')).verified).toBe(false)
  })

  it('reports fetch failures as not verified', async () => {
    mocks.safeFetchText.mockRejectedValue(new Error('Host resolves to a private or local address'))
    const result = await checkVerification('https://acme.com', TOKEN, 'file')
    expect(result.verified).toBe(false)
    expect(result.detail).toContain('private')
  })
})

describe('isCoveredByVerifiedDomain', () => {
  it('matches on registrable domain', () => {
    expect(isCoveredByVerifiedDomain('https://acme.com', ['feedback.acme.com'])).toBe(true)
    expect(isCoveredByVerifiedDomain('https://www.acme.com', ['feedback.acme.com'])).toBe(true)
    expect(isCoveredByVerifiedDomain('https://shop.acme.co.uk', ['help.acme.co.uk'])).toBe(true)
  })

  it('does not match other domains', () => {
    expect(isCoveredByVerifiedDomain('https://acme.com', ['feedback.other.com'])).toBe(false)
    expect(isCoveredByVerifiedDomain('https://a.co.uk', ['b.co.uk'])).toBe(false)
    expect(isCoveredByVerifiedDomain('https://acme.com', [])).toBe(false)
  })
})
