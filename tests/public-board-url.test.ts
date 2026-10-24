import { describe, expect, it } from 'vitest'
import { buildPublicBoardUrl } from '../lib/public-board-url'

describe('public board URL helper', () => {
  it('uses an explicit active custom domain before workspace subdomains', () => {
    expect(
      buildPublicBoardUrl({
        orgSlug: 'dotmatrixlabs',
        projectSlug: 'dot-x',
        customDomain: 'feedback.dotmatrixlabs.com',
        appDomain: 'veerify.io',
        protocol: 'https:',
      })
    ).toBe('https://feedback.dotmatrixlabs.com')
  })

  it('uses the project custom domain only when its domain status is active', () => {
    const base = { orgSlug: 'dotmatrixlabs', appDomain: 'veerify.io', protocol: 'https:' }
    expect(
      buildPublicBoardUrl({
        ...base,
        project: { slug: 'dot-x', customDomain: 'feedback.dotmatrixlabs.com', settings: { domainStatus: 'active' } },
      })
    ).toBe('https://feedback.dotmatrixlabs.com')
    expect(
      buildPublicBoardUrl({
        ...base,
        project: { slug: 'dot-x', customDomain: 'feedback.dotmatrixlabs.com', settings: { domainStatus: 'pending' } },
      })
    ).toBe('https://dotmatrixlabs.veerify.io/dot-x')
  })

  it('addresses a product board under the project, or at the domain root on a custom domain', () => {
    expect(
      buildPublicBoardUrl({
        orgSlug: 'acme',
        projectSlug: 'dotmatrix',
        productSlug: 'dot-x',
        appDomain: 'veerify.io',
        protocol: 'https:',
      })
    ).toBe('https://acme.veerify.io/dotmatrix/dot-x')
    expect(
      buildPublicBoardUrl({
        orgSlug: 'acme',
        projectSlug: 'dotmatrix',
        productSlug: 'dot-x',
        customDomain: 'feedback.acme.com',
        appDomain: 'veerify.io',
        protocol: 'https:',
      })
    ).toBe('https://feedback.acme.com/dot-x')
  })

  it('keeps non-standard ports for local preview URLs', () => {
    expect(
      buildPublicBoardUrl({
        orgSlug: 'preview-org',
        projectSlug: 'demo',
        appDomain: 'localhost',
        protocol: 'http:',
        port: '4173',
      })
    ).toBe('http://preview-org.localhost:4173/demo')
  })
})
