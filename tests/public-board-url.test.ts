import { describe, expect, it } from 'vitest'
import { buildPublicBoardUrl } from '../lib/public-board-url'

describe('public board URL helper', () => {
  it('uses active custom domains before team subdomains', () => {
    expect(
      buildPublicBoardUrl({
        project: {
          slug: 'dot-x',
          customDomain: 'feedback.dotmatrixlabs.com',
          settings: { domainStatus: 'active' },
          team: { slug: 'dotmatrixlabs' },
        },
        appDomain: 'veerify.io',
        protocol: 'https:',
      })
    ).toBe('https://feedback.dotmatrixlabs.com')
  })

  it('falls back to the team subdomain when custom domain is not active', () => {
    expect(
      buildPublicBoardUrl({
        project: {
          slug: 'dot-x',
          customDomain: 'feedback.dotmatrixlabs.com',
          settings: { domainStatus: 'pending' },
          team: { slug: 'dotmatrixlabs' },
        },
        appDomain: 'veerify.io',
        protocol: 'https:',
      })
    ).toBe('https://dotmatrixlabs.veerify.io/dot-x')
  })

  it('keeps non-standard ports for local preview URLs', () => {
    expect(
      buildPublicBoardUrl({
        project: {
          slug: 'demo',
          team: { slug: 'preview-org' },
        },
        appDomain: 'localhost',
        protocol: 'http:',
        port: '4173',
      })
    ).toBe('http://preview-org.localhost:4173/demo')
  })
})
