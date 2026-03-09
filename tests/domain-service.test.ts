import { describe, expect, it } from 'vitest'

import {
  buildDomainSettingsPatch,
  normalizeCustomDomainInput,
} from '../server/services/domains/domain-service'
import { dedupeDnsRecords } from '../server/services/domains/provider'
import { mapVercelDomainResult } from '../server/services/domains/providers/vercel'

describe('domain service helpers', () => {
  it('normalizes custom domain input', () => {
    expect(normalizeCustomDomainInput(' Feedback.Example.com. ')).toBe('feedback.example.com')
    expect(normalizeCustomDomainInput('')).toBeNull()
    expect(normalizeCustomDomainInput(null)).toBeNull()
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
        { type: 'CNAME', name: 'feedback.example.com', value: '23f9267bd57617a5.vercel-dns-017.com.' },
        { type: 'CNAME', name: 'feedback.example.com.', value: 'cname.vercel-dns.com.' },
      ])
    ).toEqual([{ type: 'CNAME', name: 'feedback.example.com', value: '23f9267bd57617a5.vercel-dns-017.com.' }])
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
        provider: 'vercel',
        verified: false,
        status: 'ownership_verification_required',
        dnsRecords: [{ type: 'TXT', name: '_vercel.feedback.example.com', value: 'token' }],
        configuredBy: 'TXT',
        expected: null,
        resolvedTo: [],
        message: null,
      }
    )

    expect(settings.accentColor).toBe('#ff0000')
    expect(settings.domainProvider).toBe('vercel')
    expect(settings.domainStatus).toBe('ownership_verification_required')
    expect(settings.domainDnsRecords).toEqual([
      { type: 'TXT', name: '_vercel.feedback.example.com', value: 'token' },
    ])
    expect(typeof settings.domainLastCheckedAt).toBe('string')
  })

  it('maps vercel verification responses into provider-neutral dns records', () => {
    const result = mapVercelDomainResult('feedback.example.com', {
      project: {
        verified: false,
        verification: [
          {
            type: 'TXT',
            domain: '_vercel.feedback.example.com',
            value: 'vc-domain-verify=abc123',
          },
        ],
      },
      config: {
        configuredBy: 'CNAME',
        recommendedCNAME: 'cname.vercel-dns.com',
      },
    })

    expect(result.status).toBe('ownership_verification_required')
    expect(result.verified).toBe(false)
    expect(result.dnsRecords).toEqual([
      {
        type: 'TXT',
        name: '_vercel.feedback.example.com',
        value: 'vc-domain-verify=abc123',
      },
    ])
  })

  it('prefers the project-specific vercel cname when multiple cname targets are returned for one host', () => {
    const result = mapVercelDomainResult('feedback.example.com', {
      project: {
        verified: false,
        verification: [
          {
            type: 'CNAME',
            domain: 'feedback.example.com',
            value: 'cname.vercel-dns.com.',
          },
          {
            type: 'CNAME',
            domain: 'feedback.example.com',
            value: '23f9267bd57617a5.vercel-dns-017.com.',
          },
        ],
      },
      config: {
        configuredBy: 'CNAME',
      },
    })

    expect(result.status).toBe('ownership_verification_required')
    expect(result.dnsRecords).toEqual([
      {
        type: 'CNAME',
        name: 'feedback.example.com',
        value: '23f9267bd57617a5.vercel-dns-017.com.',
      },
    ])
  })
})
