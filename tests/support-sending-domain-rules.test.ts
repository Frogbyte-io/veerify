import { describe, expect, it } from 'vitest'

import {
  applyProviderResult,
  findHierarchyConflict,
  getRegistrableDomain,
  normalizeSendingDomain,
  PENDING_TTL_DAYS,
  SUSPENDED_TTL_DAYS,
  relativeRecordHost,
  sendingDomainEnvIssues,
  validateSendingDomain,
  type SendingDomainDnsRecord,
  type SendingDomainTransitionRow,
} from '../lib/support-sending-domains'

const opts = { reserved: [] as string[], allowTestTld: false }

describe('normalizeSendingDomain', () => {
  it('trims, lowercases and removes one trailing dot', () => {
    expect(normalizeSendingDomain('  Acme.COM. ')).toBe('acme.com')
  })

  it('converts IDN to punycode', () => {
    expect(normalizeSendingDomain('Bücher.example')).toBe('xn--bcher-kva.example')
  })

  it('does not reduce a URL-looking value to its host', () => {
    expect(normalizeSendingDomain('acme.com/path')).toBe('acme.com/path')
    expect(validateSendingDomain('acme.com/path', opts)).not.toBeNull()
  })
})

describe('validateSendingDomain', () => {
  it('accepts a normal registrable domain and a subdomain', () => {
    expect(validateSendingDomain('acme.com', opts)).toBeNull()
    expect(validateSendingDomain('mail.acme.co.uk', opts)).toBeNull()
  })

  it('rejects a bare public suffix and an unknown TLD', () => {
    expect(validateSendingDomain('com', opts)).not.toBeNull()
    expect(validateSendingDomain('co.uk', opts)).not.toBeNull()
    expect(validateSendingDomain('acme.notatld', opts)).not.toBeNull()
  })

  it('rejects IP addresses', () => {
    expect(validateSendingDomain('192.168.0.1', opts)).not.toBeNull()
    expect(validateSendingDomain('[::1]', opts)).not.toBeNull()
  })

  it('rejects malformed labels and over-long names', () => {
    expect(validateSendingDomain('-acme.com', opts)).not.toBeNull()
    expect(validateSendingDomain('ac me.com', opts)).not.toBeNull()
    expect(validateSendingDomain('acme..com', opts)).not.toBeNull()
    expect(validateSendingDomain(`${'a'.repeat(64)}.com`, opts)).not.toBeNull()
    expect(validateSendingDomain(`${'a'.repeat(60)}.`.repeat(5) + 'com', opts)).not.toBeNull()
    expect(validateSendingDomain('', opts)).not.toBeNull()
  })

  it('rejects reserved domains, their ancestors and their descendants', () => {
    const reserved = { reserved: ['mail.veerify.io', 'App.Example.com'], allowTestTld: false }
    expect(validateSendingDomain('mail.veerify.io', reserved)).not.toBeNull()
    expect(validateSendingDomain('veerify.io', reserved)).not.toBeNull()
    expect(validateSendingDomain('x.mail.veerify.io', reserved)).not.toBeNull()
    expect(validateSendingDomain('app.example.com', reserved)).not.toBeNull()
    expect(validateSendingDomain('example.com', reserved)).not.toBeNull()
    expect(validateSendingDomain('other.veerify.io', reserved)).toBeNull()
    expect(validateSendingDomain('badveerify.io', reserved)).toBeNull()
  })

  it.each([
    'gmail.com',
    'googlemail.com',
    'outlook.com',
    'hotmail.com',
    'live.com',
    'yahoo.com',
    'icloud.com',
    'me.com',
    'proton.me',
    'protonmail.com',
    'aol.com',
    'gmx.de',
    'gmx.co.uk',
    'gmx.net',
    'mail.gmail.com',
  ])('rejects the mailbox provider %s', (domain) => {
    expect(validateSendingDomain(domain, opts)).not.toBeNull()
  })

  it('does not treat lookalikes as mailbox providers', () => {
    expect(validateSendingDomain('notgmail.com', opts)).toBeNull()
    expect(validateSendingDomain('gmxcorp.com', opts)).toBeNull()
  })

  it('accepts .test only when allowed', () => {
    expect(validateSendingDomain('acme.verify-ok.test', opts)).not.toBeNull()
    expect(validateSendingDomain('acme.verify-ok.test', { reserved: [], allowTestTld: true })).toBeNull()
    expect(validateSendingDomain('test', { reserved: [], allowTestTld: true })).not.toBeNull()
  })
})

describe('getRegistrableDomain', () => {
  it('returns the eTLD+1', () => {
    expect(getRegistrableDomain('a.b.acme.co.uk')).toBe('acme.co.uk')
    expect(getRegistrableDomain('a.acme.verify-ok.test', true)).toBe('verify-ok.test')
    expect(getRegistrableDomain('a.acme.verify-ok.test')).toBeNull()
  })
})

describe('findHierarchyConflict', () => {
  const claims = [
    { domain: 'acme.com', teamId: 'team-a' },
    { domain: 'deep.sub.other.org', teamId: 'team-a' },
  ]

  it('conflicts with the same domain of another team', () => {
    expect(findHierarchyConflict('acme.com', 'team-b', claims)).toEqual({ domain: 'acme.com' })
  })

  it('conflicts with a descendant of another team claim (ancestor owned)', () => {
    expect(findHierarchyConflict('mail.acme.com', 'team-b', claims)).toEqual({ domain: 'acme.com' })
  })

  it('conflicts with an ancestor of another team claim (descendant owned)', () => {
    expect(findHierarchyConflict('other.org', 'team-b', claims)).toEqual({ domain: 'deep.sub.other.org' })
    expect(findHierarchyConflict('sub.other.org', 'team-b', claims)).toEqual({ domain: 'deep.sub.other.org' })
  })

  it('matches on label boundaries only', () => {
    expect(findHierarchyConflict('badacme.com', 'team-b', claims)).toBeNull()
    expect(findHierarchyConflict('acme.com.evil.io', 'team-b', claims)).toBeNull()
  })

  it('allows nesting within the same team', () => {
    expect(findHierarchyConflict('mail.acme.com', 'team-a', claims)).toBeNull()
    expect(findHierarchyConflict('acme.com', 'team-a', claims)).toBeNull()
  })
})

describe('relativeRecordHost', () => {
  it('strips the zone', () => {
    expect(relativeRecordHost('_veerify-mail.acme.com', 'acme.com')).toBe('_veerify-mail')
    expect(relativeRecordHost('a._domainkey.mail.acme.com.', 'acme.com')).toBe('a._domainkey.mail')
  })

  it('returns @ for the apex and the FQDN for foreign hosts', () => {
    expect(relativeRecordHost('acme.com', 'acme.com')).toBe('@')
    expect(relativeRecordHost('x.other.com', 'acme.com')).toBe('x.other.com')
    expect(relativeRecordHost('badacme.com', 'acme.com')).toBe('badacme.com')
  })
})

describe('applyProviderResult', () => {
  const now = new Date('2026-10-22T12:00:00.000Z')
  const created = new Date('2026-10-22T11:50:00.000Z')
  const ownershipRecord: SendingDomainDnsRecord = {
    purpose: 'ownership',
    type: 'TXT',
    name: '_veerify-mail.acme.com',
    value: 'veerify-mail-verification=tok',
    status: 'unknown',
  }
  const dkim: SendingDomainDnsRecord = {
    purpose: 'sending',
    type: 'CNAME',
    name: 'k1._domainkey.acme.com',
    value: 'k1.dkim.example',
    status: 'valid',
  }
  const active = { state: 'active' as const, receivesMail: false, records: [dkim], message: null }
  const unverified = { ...active, state: 'unverified' as const }

  function row(overrides: Partial<SendingDomainTransitionRow> = {}): SendingDomainTransitionRow {
    return {
      status: 'pending',
      createdAt: created,
      ownershipFailures: 0,
      providerFailures: 0,
      ownershipVerifiedAt: null,
      verifiedAt: null,
      expiresAt: new Date('2026-10-29T12:00:00.000Z'),
      dnsRecords: [ownershipRecord],
      ...overrides,
    }
  }

  it('provisioning/failed -> pending after a successful provider call', () => {
    for (const status of ['provisioning', 'failed']) {
      const out = applyProviderResult(row({ status }), active, 'valid', now)
      expect(out.status).toBe('pending')
      expect(out.verifiedAt).toBeNull()
    }
  })

  it('pending -> verified when the TXT is valid and the provider is active', () => {
    const out = applyProviderResult(row(), active, 'valid', now)
    expect(out.status).toBe('verified')
    expect(out.verifiedAt).toEqual(now)
    expect(out.ownershipVerifiedAt).toEqual(now)
    expect(out.expiresAt).toBeNull()
    expect(out.providerState).toBe('active')
    expect(out.lastCheckedAt).toEqual(now)
    expect(out.nextCheckAt).toEqual(new Date('2026-10-23T12:00:00.000Z'))
    expect(out.dnsRecords.map((r) => r.purpose)).toEqual(['ownership', 'sending'])
    expect(out.dnsRecords[0].status).toBe('valid')
  })

  it('pending stays pending without the TXT, or with an unverified provider', () => {
    expect(applyProviderResult(row(), active, 'invalid', now).status).toBe('pending')
    expect(applyProviderResult(row(), active, 'unknown', now).status).toBe('pending')
    expect(applyProviderResult(row(), unverified, 'valid', now).status).toBe('pending')
    const out = applyProviderResult(row(), unverified, 'valid', now)
    expect(out.expiresAt).toEqual(row().expiresAt)
    expect(out.nextCheckAt).toEqual(new Date('2026-10-22T12:05:00.000Z'))
  })

  it('schedules pending polls 5 minutes, 15 minutes, then hourly', () => {
    // The period start is derived from the expiry (start + TTL), so move both together.
    const at = (ageMs: number) =>
      applyProviderResult(
        row({
          createdAt: new Date(now.getTime() - ageMs),
          expiresAt: new Date(now.getTime() - ageMs + PENDING_TTL_DAYS * 24 * 3_600_000),
        }),
        unverified,
        'invalid',
        now
      ).nextCheckAt!
    expect(at(10 * 60_000).getTime() - now.getTime()).toBe(5 * 60_000)
    expect(at(2 * 3_600_000).getTime() - now.getTime()).toBe(15 * 60_000)
    expect(at(30 * 3_600_000).getTime() - now.getTime()).toBe(3_600_000)
  })

  it('derives the pending cadence from the current pending period, not from createdAt', () => {
    // Created 30 days ago, re-registered now: the fresh expiry restarts the 5 minute cadence.
    const out = applyProviderResult(
      row({ createdAt: new Date(now.getTime() - 30 * 24 * 3_600_000) }),
      unverified,
      'invalid',
      now
    )
    expect(out.nextCheckAt!.getTime() - now.getTime()).toBe(5 * 60_000)
  })

  it('starts the suspension clock at the suspension and does not restart it', () => {
    const lost = applyProviderResult(
      row({ status: 'verified', verifiedAt: created, expiresAt: null, providerFailures: 1 }),
      unverified,
      'valid',
      now
    )
    expect(lost.status).toBe('suspended')
    expect(lost.expiresAt).toEqual(new Date(now.getTime() + SUSPENDED_TTL_DAYS * 24 * 3_600_000))

    const later = new Date(now.getTime() + 24 * 3_600_000)
    const again = applyProviderResult(
      row({ status: 'suspended', verifiedAt: created, expiresAt: lost.expiresAt }),
      unverified,
      'valid',
      later
    )
    expect(again.expiresAt).toEqual(lost.expiresAt)

    // A legacy suspended row without a clock gets one on its next check.
    const legacy = applyProviderResult(
      row({ status: 'suspended', verifiedAt: created, expiresAt: null }),
      unverified,
      'valid',
      later
    )
    expect(legacy.expiresAt).toEqual(new Date(later.getTime() + SUSPENDED_TTL_DAYS * 24 * 3_600_000))
  })

  it('clears the suspension clock when the claim recovers', () => {
    const out = applyProviderResult(
      row({ status: 'suspended', verifiedAt: created, expiresAt: new Date(now.getTime() + 1000) }),
      active,
      'valid',
      now
    )
    expect(out.status).toBe('verified')
    expect(out.expiresAt).toBeNull()
  })

  const verified = (o: Partial<SendingDomainTransitionRow> = {}) =>
    row({ status: 'verified', verifiedAt: created, ownershipVerifiedAt: created, expiresAt: null, ...o })

  it('verified stays verified after one provider miss, and the counter resets on recovery', () => {
    const first = applyProviderResult(verified(), unverified, 'valid', now)
    expect(first.status).toBe('verified')
    expect(first.providerFailures).toBe(1)
    const recovered = applyProviderResult(verified({ providerFailures: 1 }), active, 'valid', now)
    expect(recovered.status).toBe('verified')
    expect(recovered.providerFailures).toBe(0)
  })

  it('verified -> suspended after 2 consecutive provider misses', () => {
    const out = applyProviderResult(verified({ providerFailures: 1 }), unverified, 'valid', now)
    expect(out.status).toBe('suspended')
    expect(out.providerFailures).toBe(2)
    expect(out.lastErrorCode).toBe('provider_unverified')
    expect(out.verifiedAt).toEqual(created)
  })

  it('verified -> suspended after 3 consecutive TXT misses, not 2', () => {
    const second = applyProviderResult(verified({ ownershipFailures: 1 }), active, 'invalid', now)
    expect(second.status).toBe('verified')
    expect(second.ownershipFailures).toBe(2)
    const third = applyProviderResult(verified({ ownershipFailures: 2 }), active, 'invalid', now)
    expect(third.status).toBe('suspended')
    expect(third.lastErrorCode).toBe('ownership_missing')
  })

  it('an unknown TXT lookup neither counts as a miss nor resets the counter', () => {
    const out = applyProviderResult(verified({ ownershipFailures: 2 }), active, 'unknown', now)
    expect(out.status).toBe('verified')
    expect(out.ownershipFailures).toBe(2)
  })

  it('a valid TXT resets the ownership counter', () => {
    expect(applyProviderResult(verified({ ownershipFailures: 2 }), active, 'valid', now).ownershipFailures).toBe(0)
  })

  it('suspended -> verified when both checks pass again, clearing the counters and error', () => {
    const suspended = row({
      status: 'suspended',
      verifiedAt: created,
      ownershipVerifiedAt: created,
      expiresAt: null,
      providerFailures: 2,
      ownershipFailures: 3,
    })
    const out = applyProviderResult(suspended, active, 'valid', now)
    expect(out.status).toBe('verified')
    expect(out.providerFailures).toBe(0)
    expect(out.ownershipFailures).toBe(0)
    expect(out.lastErrorCode).toBeNull()
    expect(out.verifiedAt).toEqual(created)
  })

  it('suspended stays suspended until both pass', () => {
    const suspended = row({ status: 'suspended', providerFailures: 2, verifiedAt: created, expiresAt: null })
    expect(applyProviderResult(suspended, unverified, 'valid', now).status).toBe('suspended')
    expect(applyProviderResult(suspended, active, 'invalid', now).status).toBe('suspended')
    expect(applyProviderResult(suspended, active, 'unknown', now).status).toBe('suspended')
    expect(applyProviderResult(suspended, active, 'invalid', now).lastErrorCode).toBe('ownership_missing')
  })

  it('deleting keeps its status', () => {
    expect(applyProviderResult(row({ status: 'deleting' }), active, 'valid', now).status).toBe('deleting')
  })

  it('replaces provider records but keeps ownership and recommended rows, in display order', () => {
    const dmarc: SendingDomainDnsRecord = {
      purpose: 'recommended',
      type: 'TXT',
      name: '_dmarc.acme.com',
      value: 'v=DMARC1; p=none',
      status: 'unknown',
    }
    const mx: SendingDomainDnsRecord = {
      purpose: 'receiving',
      type: 'MX',
      name: 'acme.com',
      value: 'mx.example',
      priority: '10',
      status: 'unknown',
    }
    const out = applyProviderResult(
      row({ dnsRecords: [dmarc, ownershipRecord, { ...dkim, value: 'stale' }] }),
      { ...active, records: [mx, dkim], receivesMail: true },
      'invalid',
      now
    )
    expect(out.dnsRecords.map((r) => r.purpose)).toEqual(['ownership', 'sending', 'receiving', 'recommended'])
    expect(out.dnsRecords[0].status).toBe('invalid')
    expect(out.dnsRecords.find((r) => r.purpose === 'sending')?.value).toBe(dkim.value)
    expect(out.receivesViaProvider).toBe(true)
  })
})

describe('sendingDomainEnvIssues', () => {
  it('is silent when management is off', () => {
    expect(sendingDomainEnvIssues({})).toEqual([])
  })

  it('flags legacy policy together with management', () => {
    const issues = sendingDomainEnvIssues({
      SUPPORT_SENDING_DOMAINS_ENABLED: 'true',
      SUPPORT_SENDER_POLICY: 'legacy',
      SUPPORT_CHANNEL_PROVIDER: 'mailgun',
      SUPPORT_MAILGUN_API_KEY: 'key',
    })
    expect(issues.map((i) => i.level)).toEqual(['error'])
  })

  it('warns when the provider is unconfigured, naming the variable only', () => {
    const [issue] = sendingDomainEnvIssues({
      SUPPORT_SENDING_DOMAINS_ENABLED: 'true',
      SUPPORT_CHANNEL_PROVIDER: 'mailgun',
    })
    expect(issue.level).toBe('warn')
    expect(issue.message).toContain('SUPPORT_MAILGUN_API_KEY')
  })

  it('logs Postmark list-only mode', () => {
    const issues = sendingDomainEnvIssues({
      SUPPORT_SENDING_DOMAINS_ENABLED: 'true',
      SUPPORT_CHANNEL_PROVIDER: 'postmark',
      SUPPORT_POSTMARK_ACCOUNT_TOKEN: 't',
    })
    expect(issues).toHaveLength(1)
    expect(issues[0].level).toBe('info')
  })

  it('reports the fake provider in production as an error', () => {
    const issues = sendingDomainEnvIssues({ SUPPORT_SENDING_DOMAIN_PROVIDER: 'fake', NODE_ENV: 'production' })
    expect(issues[0].level).toBe('error')
  })
})
