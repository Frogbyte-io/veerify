import { describe, expect, it } from 'vitest'
import {
  isProtectedRoute,
  isPublicHostAppRoute,
  legacyChangelogRedirect,
  resolvePublicHostRedirect,
} from '~/lib/route-guard'

describe('public hosts (custom domains and team subdomains)', () => {
  it('lets /changelog and /changelog/<slug> through to the public catch-all page', () => {
    expect(resolvePublicHostRedirect('/changelog')).toBeNull()
    expect(resolvePublicHostRedirect('/changelog/v1-0')).toBeNull()
    expect(resolvePublicHostRedirect('/acme-app/changelog')).toBeNull()
    expect(resolvePublicHostRedirect('/roadmap')).toBeNull()
    expect(resolvePublicHostRedirect('/testimonials')).toBeNull()
  })

  it('still bounces dashboard routes, including the dashboard changelog', () => {
    expect(resolvePublicHostRedirect('/dashboard')).toBe('/')
    expect(resolvePublicHostRedirect('/dashboard/changelog')).toBe('/')
    expect(resolvePublicHostRedirect('/dashboard/changelog/abc')).toBe('/')
    expect(resolvePublicHostRedirect('/marketing/reviews')).toBe('/')
    expect(isPublicHostAppRoute('/login')).toBe(true)
  })
})

describe('app host', () => {
  it('protects the dashboard changelog through the /dashboard prefix', () => {
    expect(isProtectedRoute('/dashboard/changelog')).toBe(true)
    expect(isProtectedRoute('/dashboard/changelog/new')).toBe(true)
  })

  it('does not treat bare /changelog as a dashboard page', () => {
    expect(isProtectedRoute('/changelog')).toBe(false)
  })

  it('keeps the token-based feedback edit page public', () => {
    expect(isProtectedRoute('/feedback/abc/edit')).toBe(false)
    expect(isProtectedRoute('/feedback')).toBe(true)
  })

  it('forwards old /changelog links to /dashboard/changelog, keeping the query', () => {
    expect(legacyChangelogRedirect('/changelog', '?product=acme')).toBe('/dashboard/changelog?product=acme')
    expect(legacyChangelogRedirect('/changelog/e1', '?product=acme')).toBe('/dashboard/changelog/e1?product=acme')
    expect(legacyChangelogRedirect('/changelogs')).toBeNull()
    expect(legacyChangelogRedirect('/dashboard/changelog')).toBeNull()
  })
})
