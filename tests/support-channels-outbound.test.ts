import { describe, expect, it } from 'vitest'

import { PostmarkChannelDriver } from '../server/services/support-channels/webhook/postmark'
import { MailgunChannelDriver } from '../server/services/support-channels/webhook/mailgun'

/**
 * SUP-04-1's second half: `ChannelDriver` had no outbound surface at all
 * (name / verifySignature / extractEventId / parse), so SUP-04-6's
 * "warn when the From address is not provider-authorized" had nothing to call.
 *
 * `isConfigured()` also closes delta D-34, which flagged that
 * `channel-status.get.ts` hard-codes each provider's env vars in a REQUIRED_ENV
 * map because the driver could not answer the question itself.
 */
describe('isConfigured - which credentials a provider is missing', () => {
  it('reports Postmark configured when both webhook credentials are present', () => {
    const driver = new PostmarkChannelDriver({ user: 'hook', password: 'secret' })

    expect(driver.isConfigured()).toEqual({ configured: true, missing: [] })
  })

  it('names the missing Postmark variable without leaking the one that is set', () => {
    const driver = new PostmarkChannelDriver({ user: 'hook', password: '' })
    const status = driver.isConfigured()

    expect(status.configured).toBe(false)
    expect(status.missing).toEqual(['SUPPORT_POSTMARK_WEBHOOK_PASSWORD'])
    // The card built in SUP-03-13 shows these to any team member, so it must
    // report names and never values.
    expect(JSON.stringify(status)).not.toContain('hook')
  })

  it('names both Postmark variables when neither is set', () => {
    const driver = new PostmarkChannelDriver({ user: '', password: '' })

    expect(driver.isConfigured().missing).toEqual([
      'SUPPORT_POSTMARK_WEBHOOK_USER',
      'SUPPORT_POSTMARK_WEBHOOK_PASSWORD',
    ])
  })

  it('names the missing Mailgun signing key', () => {
    expect(new MailgunChannelDriver({ signingKey: '' }).isConfigured()).toEqual({
      configured: false,
      missing: ['SUPPORT_MAILGUN_SIGNING_KEY'],
    })
  })

  it('reports Mailgun configured when the signing key is present', () => {
    expect(new MailgunChannelDriver({ signingKey: 'key-123' }).isConfigured()).toEqual({
      configured: true,
      missing: [],
    })
  })
})

describe('checkSendingAuthorization - can this inbox send as this address', () => {
  /**
   * The distinction that matters: "not authorized" and "could not check" are
   * different answers. A settings warning that says the address is
   * unauthorized when we simply had no API credential would be a false alarm
   * on every deployment that has not set one - worse than staying quiet.
   */
  const postmarkReturning = (body: unknown, status = 200) =>
    new PostmarkChannelDriver({
      apiToken: 'token',
      fetchImpl: async () => new Response(JSON.stringify(body), { status }),
    })

  it('returns unknown, naming the variable to set, when no API credential is configured', async () => {
    const driver = new PostmarkChannelDriver({ user: 'hook', password: 'secret', apiToken: '' })

    const result = await driver.checkSendingAuthorization('support@acme.com')

    expect(result.status).toBe('unknown')
    expect(result.status === 'unknown' && result.reason).toContain('SUPPORT_POSTMARK_ACCOUNT_TOKEN')
  })

  it('authorizes an address whose domain the provider has verified', async () => {
    const driver = postmarkReturning({
      Domains: [{ Name: 'acme.com', DKIMVerified: true, ReturnPathDomainVerified: true }],
    })

    expect(await driver.checkSendingAuthorization('support@acme.com')).toEqual({ status: 'authorized' })
  })

  it('reports unauthorized and lists what IS verified, so settings can say what to fix', async () => {
    const driver = postmarkReturning({
      Domains: [{ Name: 'acme.com', DKIMVerified: true, ReturnPathDomainVerified: true }],
    })

    expect(await driver.checkSendingAuthorization('support@other.com')).toEqual({
      status: 'unauthorized',
      verifiedDomains: ['acme.com'],
    })
  })

  it('treats an unverified domain as not authorized even though it is listed', async () => {
    // Postmark lists domains that exist on the account but have not passed
    // DKIM. Sending as one of those fails at send time, which is exactly what
    // this check exists to catch before it happens.
    const driver = postmarkReturning({
      Domains: [{ Name: 'acme.com', DKIMVerified: false, ReturnPathDomainVerified: false }],
    })

    expect((await driver.checkSendingAuthorization('support@acme.com')).status).toBe('unauthorized')
  })

  it('returns unknown rather than unauthorized when the provider call fails', async () => {
    const driver = new PostmarkChannelDriver({
      apiToken: 'token',
      fetchImpl: async () => new Response('nope', { status: 500 }),
    })

    expect((await driver.checkSendingAuthorization('support@acme.com')).status).toBe('unknown')
  })

  it('returns unknown rather than unauthorized when the network throws', async () => {
    const driver = new PostmarkChannelDriver({
      apiToken: 'token',
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED')
      },
    })

    expect((await driver.checkSendingAuthorization('support@acme.com')).status).toBe('unknown')
  })

  it('matches the domain case-insensitively', async () => {
    const driver = postmarkReturning({
      Domains: [{ Name: 'Acme.COM', DKIMVerified: true, ReturnPathDomainVerified: true }],
    })

    expect(await driver.checkSendingAuthorization('Support@ACME.com')).toEqual({ status: 'authorized' })
  })

  it('returns unknown for an address it cannot parse a domain from', async () => {
    const driver = postmarkReturning({ Domains: [] })

    expect((await driver.checkSendingAuthorization('not-an-address')).status).toBe('unknown')
  })

  it('authorizes against Mailgun verified domains', async () => {
    const driver = new MailgunChannelDriver({
      signingKey: 'key',
      apiKey: 'api-key',
      fetchImpl: async () =>
        new Response(JSON.stringify({ items: [{ name: 'acme.com', state: 'active' }] }), { status: 200 }),
    })

    expect(await driver.checkSendingAuthorization('support@acme.com')).toEqual({ status: 'authorized' })
  })

  it('does not authorize a Mailgun domain that is not active', async () => {
    const driver = new MailgunChannelDriver({
      signingKey: 'key',
      apiKey: 'api-key',
      fetchImpl: async () =>
        new Response(JSON.stringify({ items: [{ name: 'acme.com', state: 'unverified' }] }), { status: 200 }),
    })

    expect((await driver.checkSendingAuthorization('support@acme.com')).status).toBe('unauthorized')
  })
})
