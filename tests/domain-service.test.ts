import { describe, expect, it } from 'vitest'

import {
  buildDomainSettingsPatch,
  createDomainProvider,
  resolveDomainProviderName,
  shouldSendDomainVerifiedEmail,
  buildOrgSubdomainHostname,
  getCustomDomainValidationError,
  normalizeCustomDomainInput,
} from '../server/services/domains/domain-service'
import { domainProviderEnvIssues } from '../server/services/domains/env'
import { CloudflareSaasDomainProvider } from '../server/services/domains/providers/cloudflare-saas'
import { StaticCnameDomainProvider } from '../server/services/domains/providers/static-cname'
import { dedupeDnsRecords } from '../server/services/domains/provider'

describe('domain service helpers', () => {
  it('normalizes custom domain input', () => {
    expect(normalizeCustomDomainInput(' Feedback.Example.com. ')).toBe('feedback.example.com')
    expect(normalizeCustomDomainInput('')).toBeNull()
    expect(normalizeCustomDomainInput(null)).toBeNull()
    expect(normalizeCustomDomainInput('BÜCHER.Example.com')).toBe('xn--bcher-kva.example.com')
  })

  it('requires a customer-owned custom subdomain', () => {
    const options = { appDomain: 'veerify.io', dashboardDomain: 'app.veerify.io' }

    expect(getCustomDomainValidationError('feedback.customer.co.uk', options)).toBeNull()
    expect(getCustomDomainValidationError('customer.co.uk', options)).toMatch(/subdomain/i)
    expect(getCustomDomainValidationError('tenant.veerify.io', options)).toMatch(/platform domain/i)
    expect(getCustomDomainValidationError('not-a-public-suffix.invalid', options)).toMatch(/public suffix/i)
  })

  it('allows nested localhost domains used by local custom-domain tests', () => {
    const options = { appDomain: 'localhost', dashboardDomain: 'localhost' }

    expect(getCustomDomainValidationError('feedback.demo.localhost', options)).toBeNull()
    expect(getCustomDomainValidationError('demo.localhost', options)).toMatch(/platform domain/i)
  })

  it('builds production workspace subdomain hostnames', () => {
    expect(buildOrgSubdomainHostname(' DotMatrixLabs ', 'Veerify.io.')).toBe('dotmatrixlabs.veerify.io')
    expect(buildOrgSubdomainHostname('dotmatrixlabs', 'localhost')).toBeNull()
  })

  it('deduplicates dns records by type, name, and value', () => {
    expect(
      dedupeDnsRecords([
        { type: 'CNAME', name: 'Feedback.Example.com.', value: 'cname.veerify.io' },
        { type: 'CNAME', name: 'feedback.example.com', value: 'cname.veerify.io' },
      ])
    ).toEqual([{ type: 'CNAME', name: 'feedback.example.com', value: 'cname.veerify.io' }])
  })

  it('keeps only one cname instruction per hostname', () => {
    expect(
      dedupeDnsRecords([
        { type: 'CNAME', name: 'feedback.example.com', value: 'abc123.edge.example.net.' },
        { type: 'CNAME', name: 'feedback.example.com.', value: 'cname.edge.example.net.' },
      ])
    ).toEqual([{ type: 'CNAME', name: 'feedback.example.com', value: 'abc123.edge.example.net.' }])
  })

  it('builds a clean settings patch for a provider result', () => {
    const settings = buildDomainSettingsPatch(
      {
        accentColor: '#ff0000',
        domainProvider: 'old',
        domainStatus: 'error',
      },
      {
        hostname: 'feedback.example.com',
        provider: 'cloudflare-saas',
        verified: false,
        status: 'ownership_verification_required',
        dnsRecords: [{ type: 'TXT', name: '_acme-challenge.feedback.example.com', value: 'token' }],
        configuredBy: 'TXT',
        expected: null,
        resolvedTo: [],
        message: null,
      }
    )

    expect(settings.accentColor).toBe('#ff0000')
    expect(settings.domainProvider).toBe('cloudflare-saas')
    expect(settings.domainStatus).toBe('ownership_verification_required')
    expect(settings.domainDnsRecords).toEqual([
      { type: 'TXT', name: '_acme-challenge.feedback.example.com', value: 'token' },
    ])
    expect(typeof settings.domainLastCheckedAt).toBe('string')
  })
})

describe('domain provider selection', () => {
  it('resolves provider names, defaulting to static-cname', () => {
    expect(resolveDomainProviderName('cloudflare-saas')).toBe('cloudflare-saas')
    expect(resolveDomainProviderName(' Cloudflare-SaaS ')).toBe('cloudflare-saas')
    expect(resolveDomainProviderName('vercel')).toBe('static-cname')
    expect(resolveDomainProviderName('static-cname')).toBe('static-cname')
    expect(resolveDomainProviderName('')).toBe('static-cname')
    expect(resolveDomainProviderName(undefined)).toBe('static-cname')
    expect(resolveDomainProviderName('nonsense')).toBe('static-cname')
  })

  it('instantiates the matching provider', () => {
    expect(createDomainProvider('cloudflare-saas')).toBeInstanceOf(CloudflareSaasDomainProvider)
    expect(createDomainProvider('static-cname')).toBeInstanceOf(StaticCnameDomainProvider)
  })
})

describe('domainProviderEnvIssues', () => {
  it('is silent for other providers', () => {
    expect(domainProviderEnvIssues({}, { domainProvider: 'static-cname' })).toEqual([])
    expect(domainProviderEnvIssues({ DOMAIN_PROVIDER: 'static-cname' })).toEqual([])
  })

  it('warns when cloudflare-saas is selected without credentials', () => {
    const issues = domainProviderEnvIssues({}, { domainProvider: 'cloudflare-saas' })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID')
  })

  it('names only the missing variable', () => {
    const issues = domainProviderEnvIssues({}, { domainProvider: 'cloudflare-saas', cloudflareApiToken: 't' })
    expect(issues[0]).toContain('CLOUDFLARE_ZONE_ID is not set')
    expect(issues[0]).not.toContain('CLOUDFLARE_API_TOKEN')
  })

  it('accepts plain and NUXT_ prefixed env or runtime config', () => {
    expect(
      domainProviderEnvIssues({
        DOMAIN_PROVIDER: 'cloudflare-saas',
        CLOUDFLARE_API_TOKEN: 't',
        CLOUDFLARE_ZONE_ID: 'z',
      })
    ).toEqual([])
    expect(
      domainProviderEnvIssues({
        NUXT_DOMAIN_PROVIDER: 'cloudflare-saas',
        NUXT_CLOUDFLARE_API_TOKEN: 't',
        NUXT_CLOUDFLARE_ZONE_ID: 'z',
      })
    ).toEqual([])
    expect(
      domainProviderEnvIssues({}, { domainProvider: 'cloudflare-saas', cloudflareApiToken: 't', cloudflareZoneId: 'z' })
    ).toEqual([])
  })

  it('never includes the token value in the message', () => {
    const issues = domainProviderEnvIssues({}, { domainProvider: 'cloudflare-saas', cloudflareApiToken: 'sekret' })
    expect(issues.join(' ')).not.toContain('sekret')
  })
})

describe('shouldSendDomainVerifiedEmail', () => {
  const domain = 'feedback.dotmatrixlabs.com'

  it('sends once when a domain first becomes verified', () => {
    expect(
      shouldSendDomainVerifiedEmail({
        verified: true,
        domain,
        settings: { domainStatus: 'dns_required' },
        previousStatus: 'dns_required',
      })
    ).toBe(true)
  })

  it('does not send while unverified', () => {
    expect(shouldSendDomainVerifiedEmail({ verified: false, domain, settings: {} })).toBe(false)
  })

  it('does not send for an already active domain adopted from another provider', () => {
    expect(shouldSendDomainVerifiedEmail({ verified: true, domain, settings: {}, previousStatus: 'active' })).toBe(
      false
    )
    expect(shouldSendDomainVerifiedEmail({ verified: true, domain, settings: { domainStatus: 'active' } })).toBe(false)
  })

  it('does not send twice for the same domain', () => {
    expect(
      shouldSendDomainVerifiedEmail({ verified: true, domain, settings: { domainVerifiedEmailSentFor: domain } })
    ).toBe(false)
  })
})
