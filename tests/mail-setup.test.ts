import { describe, expect, it } from 'vitest'
import {
  domainSetupState,
  existingMxHostsFrom,
  formatTimeAgo,
  isAtLimit,
  isSesInboundHost,
  receivedSince,
  receivingActiveLine,
  suspendedDomainMessage,
  testAddressForDomain,
  usageLevel,
} from '~/lib/mail-setup'

const NOW = new Date('2026-10-31T12:00:00Z').getTime()
const hoursAgo = (n: number) => new Date(NOW - n * 3_600_000).toISOString()

describe('existingMxHostsFrom', () => {
  it('orders by preference, lowercases, drops trailing dots and duplicates', () => {
    expect(
      existingMxHostsFrom([
        { exchange: 'ALT1.ASPMX.L.GOOGLE.COM.', priority: 5 },
        { exchange: 'aspmx.l.google.com', priority: 1 },
        { exchange: 'alt1.aspmx.l.google.com', priority: 10 },
      ])
    ).toEqual(['aspmx.l.google.com', 'alt1.aspmx.l.google.com'])
  })

  it('excludes the SES inbound host in any region and the values passed as ours', () => {
    expect(
      existingMxHostsFrom(
        [
          { exchange: 'inbound-smtp.us-east-1.amazonaws.com', priority: 10 },
          { exchange: 'inbound-smtp.eu-west-1.amazonaws.com.', priority: 10 },
          { exchange: 'mx.custom-inbound.test', priority: 10 },
          { exchange: 'mx1.mail.example', priority: 20 },
        ],
        ['mx.custom-inbound.test']
      )
    ).toEqual(['mx1.mail.example'])
  })

  it('ignores a null MX (RFC 7505)', () => {
    expect(existingMxHostsFrom([{ exchange: '', priority: 0 }])).toEqual([])
    expect(existingMxHostsFrom([{ exchange: '.', priority: 0 }])).toEqual([])
  })

  it('recognises SES inbound hosts only', () => {
    expect(isSesInboundHost('inbound-smtp.us-east-1.amazonaws.com')).toBe(true)
    expect(isSesInboundHost('evil.inbound-smtp.us-east-1.amazonaws.com.attacker.test')).toBe(false)
    expect(isSesInboundHost('aspmx.l.google.com')).toBe(false)
  })
})

describe('usage thresholds', () => {
  it('warns from 80 % and reports the limit at or over it', () => {
    expect(usageLevel(0, 5000)).toBe('ok')
    expect(usageLevel(3999, 5000)).toBe('ok')
    expect(usageLevel(4000, 5000)).toBe('warning')
    expect(usageLevel(4999, 5000)).toBe('warning')
    expect(usageLevel(5000, 5000)).toBe('limit')
    expect(usageLevel(6000, 5000)).toBe('limit')
  })

  it('is unknown without both numbers', () => {
    expect(usageLevel(null, 5000)).toBe('unknown')
    expect(usageLevel(10, undefined)).toBe('unknown')
    expect(usageLevel(1, 0)).toBe('unknown')
  })

  it('isAtLimit drives the disabled Add domain / New address buttons', () => {
    expect(isAtLimit(3, 3)).toBe(true)
    expect(isAtLimit(2, 3)).toBe(false)
    expect(isAtLimit(null, 3)).toBe(false)
  })
})

describe('domainSetupState', () => {
  const forwarding = { forwarding: true }

  it('locks the MX step until ownership is verified, and keeps polling', () => {
    expect(domainSetupState({ status: 'pending', receivingStatus: 'pending_verification' }, forwarding)).toEqual({
      ownership: 'waiting',
      receiving: 'locked',
      complete: false,
      inProgress: true,
    })
  })

  it('asks for the MX once verified and pending_mx', () => {
    expect(domainSetupState({ status: 'verified', receivingStatus: 'pending_mx' }, forwarding)).toMatchObject({
      ownership: 'done',
      receiving: 'waiting_mx',
      complete: false,
      inProgress: true,
    })
  })

  it('treats a verified domain without a receiving status yet as preparing', () => {
    expect(domainSetupState({ status: 'verified', receivingStatus: null }, forwarding)).toMatchObject({
      receiving: 'preparing',
      inProgress: true,
    })
  })

  it('is complete (no more polling) once receiving is active', () => {
    expect(domainSetupState({ status: 'verified', receivingStatus: 'active' }, forwarding)).toMatchObject({
      receiving: 'active',
      complete: true,
      inProgress: false,
    })
  })

  it('has no MX step without forwarding', () => {
    expect(domainSetupState({ status: 'verified' }, { forwarding: false })).toMatchObject({
      receiving: 'none',
      complete: true,
      inProgress: false,
    })
  })

  it('reports suspended and failed claims as a problem', () => {
    expect(domainSetupState({ status: 'suspended' }, forwarding).ownership).toBe('problem')
    expect(domainSetupState({ status: 'failed' }, forwarding).ownership).toBe('problem')
  })
})

describe('receiving confirmation', () => {
  it('says when the last message arrived, or that none has', () => {
    expect(receivingActiveLine(hoursAgo(3), NOW)).toBe('Receiving active · last message 3 h ago')
    expect(receivingActiveLine(null, NOW)).toBe('Receiving active · no mail received yet')
  })

  it('formats short and long durations', () => {
    expect(formatTimeAgo(new Date(NOW - 10_000).toISOString(), NOW)).toBe('just now')
    expect(formatTimeAgo(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5 min ago')
    expect(formatTimeAgo(hoursAgo(72), NOW)).toBe('3 days ago')
    expect(formatTimeAgo('not a date', NOW)).toBe('')
  })

  it('detects a newer message than the baseline', () => {
    expect(receivedSince(null, null)).toBe(false)
    expect(receivedSince(null, hoursAgo(0))).toBe(true)
    expect(receivedSince(hoursAgo(2), hoursAgo(2))).toBe(false)
    expect(receivedSince(hoursAgo(2), hoursAgo(1))).toBe(true)
  })

  it('picks the first exact address, else test@ under a catch-all, else none', () => {
    const exact = { address: 'hello@acme.com', kind: 'custom', isCatchAll: false }
    const catchAll = { address: '*@acme.com', kind: 'custom', isCatchAll: true }
    const platform = { address: 'x@veerifymail.test', kind: 'platform', isCatchAll: false }
    const other = { address: 'hi@other.com', kind: 'custom', isCatchAll: false }
    expect(testAddressForDomain([catchAll, exact], 'acme.com')).toBe('hello@acme.com')
    expect(testAddressForDomain([catchAll], 'acme.com')).toBe('test@acme.com')
    expect(testAddressForDomain([platform, other], 'acme.com')).toBeNull()
    // A subdomain's addresses do not count for the parent domain.
    expect(testAddressForDomain([{ address: 'a@mail.acme.com', kind: 'custom' }], 'acme.com')).toBeNull()
  })
})

describe('suspendedDomainMessage', () => {
  it('explains each suspension cause', () => {
    expect(suspendedDomainMessage('sender_rejected')).toContain('your email provider refused to send from this domain')
    expect(suspendedDomainMessage('dns_missing')).toContain('DNS records no longer found')
    expect(suspendedDomainMessage('other')).toContain('Click Verify now')
    // Older servers did not send a reason; DNS was the only cause then.
    expect(suspendedDomainMessage(undefined)).toContain('DNS records no longer found')
  })
})
