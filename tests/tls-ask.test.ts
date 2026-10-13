import { describe, expect, it } from 'vitest'

import { extractTeamSlug, parseAskHostname } from '../server/utils/tls-ask'

describe('parseAskHostname', () => {
  it('normalizes case and a trailing dot', () => {
    expect(parseAskHostname('Feedback.Example.COM.')).toBe('feedback.example.com')
    expect(parseAskHostname('  acme.veerify.io  ')).toBe('acme.veerify.io')
  })

  it('rejects non-strings and empties', () => {
    expect(parseAskHostname(undefined)).toBeNull()
    expect(parseAskHostname(null)).toBeNull()
    expect(parseAskHostname(123)).toBeNull()
    expect(parseAskHostname('')).toBeNull()
    expect(parseAskHostname('   ')).toBeNull()
    expect(parseAskHostname(['a.com'])).toBeNull()
  })

  it('rejects anything outside DNS characters', () => {
    // This value reaches a database query and a certificate order, so it stays
    // narrow on purpose.
    expect(parseAskHostname('a.com/../etc')).toBeNull()
    expect(parseAskHostname('a.com?x=1')).toBeNull()
    expect(parseAskHostname("a.com'--")).toBeNull()
    expect(parseAskHostname('a b.com')).toBeNull()
    expect(parseAskHostname('a.com\n')).toBe('a.com') // trimmed, not smuggled
    expect(parseAskHostname('a\n.com')).toBeNull()
    expect(parseAskHostname('café.com')).toBeNull()
  })

  it('rejects malformed DNS shapes', () => {
    expect(parseAskHostname('.example.com')).toBeNull()
    expect(parseAskHostname('-example.com')).toBeNull()
    expect(parseAskHostname('a..b.com')).toBeNull()
  })

  it('rejects hostnames longer than the DNS limit', () => {
    expect(parseAskHostname(`${'a'.repeat(254)}.com`)).toBeNull()
  })
})

describe('extractTeamSlug', () => {
  it('extracts a single label under the app domain', () => {
    expect(extractTeamSlug('acme.veerify.io', 'veerify.io')).toBe('acme')
  })

  it('rejects deeper names', () => {
    // `a.b.veerify.io` is not a team subdomain; treating it as one would let a
    // nested label mint a certificate.
    expect(extractTeamSlug('a.b.veerify.io', 'veerify.io')).toBeNull()
  })

  it('rejects the bare app domain', () => {
    expect(extractTeamSlug('veerify.io', 'veerify.io')).toBeNull()
  })

  it('rejects a suffix match that is not a subdomain boundary', () => {
    // `notveerify.io` ends with `veerify.io` as a substring but is a different
    // domain entirely.
    expect(extractTeamSlug('notveerify.io', 'veerify.io')).toBeNull()
  })

  it('rejects slugs with leading or trailing hyphens', () => {
    expect(extractTeamSlug('-acme.veerify.io', 'veerify.io')).toBeNull()
    expect(extractTeamSlug('acme-.veerify.io', 'veerify.io')).toBeNull()
  })

  it('returns null when no app domain is configured', () => {
    expect(extractTeamSlug('acme.veerify.io', '')).toBeNull()
    expect(extractTeamSlug('acme.veerify.io', '   ')).toBeNull()
  })

  it('is case-insensitive on the configured suffix', () => {
    expect(extractTeamSlug('acme.veerify.io', 'Veerify.IO')).toBe('acme')
  })
})
