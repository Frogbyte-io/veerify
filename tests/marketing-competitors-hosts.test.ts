import { describe, expect, it } from 'vitest'
import {
  bareHost,
  canonicalHost,
  hostMatchesDomain,
  isPublicSuffixOnly,
} from '~/server/services/marketing/competitors/hosts'

describe('competitor hosts', () => {
  it('strips trailing dots, case and www', () => {
    expect(bareHost('WWW.Rival.com.')).toBe('rival.com')
    expect(canonicalHost('WWW.Rival.com.')).toBe('www.rival.com')
  })

  it('detects public suffixes, including private ones', () => {
    for (const d of ['github.io', 'vercel.app', 'co.uk', 'com', 'github.io.']) expect(isPublicSuffixOnly(d)).toBe(true)
    for (const d of ['rival.com', 'docs.rival.com', 'app.vercel.app', 'rival.co.uk']) {
      expect(isPublicSuffixOnly(d)).toBe(false)
    }
  })

  it('matches the domain and its subdomains only', () => {
    expect(hostMatchesDomain('rival.com.', 'rival.com')).toBe(true)
    expect(hostMatchesDomain('docs.rival.com', 'rival.com')).toBe(true)
    expect(hostMatchesDomain('notrival.com', 'rival.com')).toBe(false)
    expect(hostMatchesDomain('rival.com', null)).toBe(false)
    expect(hostMatchesDomain('x.github.io', 'github.io')).toBe(false)
  })
})
