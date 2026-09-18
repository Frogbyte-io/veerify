import { describe, expect, it } from 'vitest'
import {
  isAllowedRedirectProtocol,
  isAppHostedRedirectHost,
  normalizeHostname,
  parseRedirectUrl,
} from '../lib/auth-redirect'

describe('auth redirect helpers', () => {
  it('normalizes hostnames for matching', () => {
    expect(normalizeHostname('Preview.Example.COM.')).toBe('preview.example.com')
  })

  it('allows https for any host and http only for local hosts', () => {
    expect(isAllowedRedirectProtocol('https:', 'customer.example.com')).toBe(true)
    expect(isAllowedRedirectProtocol('http:', 'preview.localhost')).toBe(true)
    expect(isAllowedRedirectProtocol('http:', 'customer.example.com')).toBe(false)
  })

  it('matches app domain, dashboard domain, and app subdomains', () => {
    const common = {
      currentHost: 'app.veerify.io',
      appDomain: 'veerify.io',
      dashboardDomain: 'app.veerify.io',
    }

    expect(
      isAppHostedRedirectHost({
        ...common,
        redirectHost: 'app.veerify.io',
      })
    ).toBe(true)
    expect(
      isAppHostedRedirectHost({
        ...common,
        redirectHost: 'team.veerify.io',
      })
    ).toBe(true)
    expect(
      isAppHostedRedirectHost({
        ...common,
        redirectHost: 'customer.example.com',
      })
    ).toBe(false)
    expect(
      isAppHostedRedirectHost({
        ...common,
        redirectHost: 'feedback.customer.veerify.io',
      })
    ).toBe(false)
  })

  it('parses only http/https absolute redirect targets', () => {
    expect(parseRedirectUrl('https://customer.example.com/board')?.hostname).toBe('customer.example.com')
    expect(parseRedirectUrl('javascript:alert(1)')).toBeNull()
    expect(parseRedirectUrl('/dashboard')).toBeNull()
  })
})
