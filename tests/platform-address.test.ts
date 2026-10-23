import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/server/database/drizzle', () => ({ db: {} }))

const { buildPlatformAddress, getPlatformMailDomain } = await import('../server/utils/platform-address')

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getPlatformMailDomain', () => {
  it('is null when unset or blank, which disables platform addresses', () => {
    vi.stubEnv('SUPPORT_PLATFORM_MAIL_DOMAIN', '')
    expect(getPlatformMailDomain()).toBeNull()
    vi.stubEnv('SUPPORT_PLATFORM_MAIL_DOMAIN', '   ')
    expect(getPlatformMailDomain()).toBeNull()
  })

  it('normalizes case, a leading @ and trailing dots', () => {
    vi.stubEnv('SUPPORT_PLATFORM_MAIL_DOMAIN', ' @VeerifyMail.com. ')
    expect(getPlatformMailDomain()).toBe('veerifymail.com')
  })
})

describe('buildPlatformAddress', () => {
  const fixed = (value: number) => () => value

  it('builds <project>-<inbox>-<6 base32>@<domain>', () => {
    const address = buildPlatformAddress(
      { projectSlug: 'acme', inboxSlug: 'support', domain: 'veerifymail.com' },
      fixed(0)
    )
    expect(address).toBe('acme-support-aaaaaa@veerifymail.com')
  })

  it('only uses lowercase base32 characters in the random suffix', () => {
    const address = buildPlatformAddress({ projectSlug: 'acme', inboxSlug: 'support', domain: 'veerifymail.com' })
    expect(address).toMatch(/^acme-support-[a-z2-7]{6}@veerifymail\.com$/)
  })

  it('draws a different suffix on every call', () => {
    const input = { projectSlug: 'acme', inboxSlug: 'support', domain: 'veerifymail.com' }
    const seen = new Set(Array.from({ length: 20 }, () => buildPlatformAddress(input)))
    expect(seen.size).toBeGreaterThan(15)
  })

  it('trims the readable prefix, never the random suffix, to a 64 character local part', () => {
    const address = buildPlatformAddress(
      { projectSlug: 'a'.repeat(80), inboxSlug: 'b'.repeat(80), domain: 'veerifymail.com' },
      fixed(31)
    )
    const [local] = address.split('@')
    expect(local.length).toBeLessThanOrEqual(64)
    expect(local.endsWith('-777777')).toBe(true)
    expect(local.startsWith('aaaa')).toBe(true)
  })

  it('sanitizes slugs into address-safe labels', () => {
    const address = buildPlatformAddress(
      { projectSlug: 'Acme Inc.', inboxSlug: '__help__', domain: 'veerifymail.com' },
      fixed(0)
    )
    expect(address).toBe('acme-inc-help-aaaaaa@veerifymail.com')
  })

  it('falls back to a fixed prefix when both slugs sanitize to nothing', () => {
    expect(buildPlatformAddress({ projectSlug: '!!!', inboxSlug: '???', domain: 'veerifymail.com' }, fixed(0))).toBe(
      'inbox-aaaaaa@veerifymail.com'
    )
  })
})
