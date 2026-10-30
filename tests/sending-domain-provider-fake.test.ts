import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSendingDomainProvider } from '../server/services/sending-domains'
import {
  FakeSendingDomainProvider,
  fakeInboundRoutes,
  resetFakeSendingDomainState,
} from '../server/services/sending-domains/providers/fake'
import { MailgunSendingDomainProvider } from '../server/services/sending-domains/providers/mailgun'
import { PostmarkSendingDomainProvider } from '../server/services/sending-domains/providers/postmark'

beforeEach(() => resetFakeSendingDomainState())
afterEach(() => vi.unstubAllEnvs())

describe('fake provider', () => {
  it('turns active after the first verify for *.verify-ok.test', async () => {
    const provider = new FakeSendingDomainProvider()
    const registered = await provider.register('acme.verify-ok.test')
    expect(registered).toMatchObject({ state: 'unverified', ownership: 'created' })
    expect((await provider.get('acme.verify-ok.test'))?.state).toBe('unverified')
    expect((await provider.verify('acme.verify-ok.test')).state).toBe('active')
    expect((await provider.get('acme.verify-ok.test'))?.state).toBe('active')
  })

  it('refuses *.owned-elsewhere.test', async () => {
    await expect(new FakeSendingDomainProvider().register('x.owned-elsewhere.test')).rejects.toMatchObject({
      code: 'owned_elsewhere',
    })
  })

  it('fails once for *.flaky.test, then succeeds', async () => {
    const provider = new FakeSendingDomainProvider()
    await expect(provider.register('y.flaky.test')).rejects.toMatchObject({
      code: 'provider_unavailable',
      retryable: true,
    })
    expect((await provider.register('y.flaky.test')).state).toBe('unverified')
  })

  it('keeps other domains unverified, adopts repeats and forgets on remove', async () => {
    const provider = new FakeSendingDomainProvider()
    await provider.register('acme.test')
    expect((await provider.verify('acme.test')).state).toBe('unverified')
    expect((await provider.register('acme.test')).ownership).toBe('adopted')
    await provider.remove('acme.test')
    expect(await provider.get('acme.test')).toBeNull()
  })

  it('creates and deletes routes in memory', async () => {
    const provider = new FakeSendingDomainProvider()
    const { routeId } = await provider.createInboundRoute({
      address: 'a@b.test',
      forwardUrl: 'https://x',
      description: 'd',
    })
    await expect(provider.deleteInboundRoute(routeId)).resolves.toBeUndefined()
  })

  it('records exact and catch-all routes with the Mailgun expression and priority', async () => {
    const provider = new FakeSendingDomainProvider()
    await provider.createInboundRoute({ address: 'hello@acme.test', forwardUrl: 'https://x', description: 'd' })
    await provider.createInboundRoute({ address: '*@acme.test', forwardUrl: 'https://x', description: 'd' })
    expect(fakeInboundRoutes()).toMatchObject([
      { address: 'hello@acme.test', expression: 'match_recipient("^hello@acme\\.test$")', priority: 10 },
      { address: '*@acme.test', expression: 'match_recipient("^.*@acme\\.test$")', priority: 100 },
    ])
  })
})

describe('getSendingDomainProvider', () => {
  it('defaults to Postmark and selects Mailgun by SUPPORT_CHANNEL_PROVIDER', () => {
    expect(getSendingDomainProvider({})).toBeInstanceOf(PostmarkSendingDomainProvider)
    expect(getSendingDomainProvider({ SUPPORT_CHANNEL_PROVIDER: ' Mailgun ' })).toBeInstanceOf(
      MailgunSendingDomainProvider
    )
  })

  it('returns null for an unknown provider', () => {
    expect(getSendingDomainProvider({ SUPPORT_CHANNEL_PROVIDER: 'typo' })).toBeNull()
  })

  it('honours the fake override outside production', () => {
    expect(
      getSendingDomainProvider({ SUPPORT_CHANNEL_PROVIDER: 'mailgun', SUPPORT_SENDING_DOMAIN_PROVIDER: 'fake' })
    ).toBeInstanceOf(FakeSendingDomainProvider)
  })

  it('refuses the fake override in production', () => {
    const provider = getSendingDomainProvider({
      SUPPORT_CHANNEL_PROVIDER: 'mailgun',
      SUPPORT_SENDING_DOMAIN_PROVIDER: 'fake',
      NODE_ENV: 'production',
    })
    expect(provider).toBeInstanceOf(MailgunSendingDomainProvider)
  })

  it('refuses the fake override in production on a real origin', () => {
    const provider = getSendingDomainProvider({
      SUPPORT_CHANNEL_PROVIDER: 'mailgun',
      SUPPORT_SENDING_DOMAIN_PROVIDER: 'fake',
      NODE_ENV: 'production',
      BETTER_AUTH_URL: 'https://app.veerify.io',
    })
    expect(provider).toBeInstanceOf(MailgunSendingDomainProvider)
  })

  it.each(['http://localhost:4173', 'http://127.0.0.1:3000'])(
    'allows the fake override in a production build served from %s (e2e)',
    (url) => {
      const provider = getSendingDomainProvider({
        SUPPORT_CHANNEL_PROVIDER: 'mailgun',
        SUPPORT_SENDING_DOMAIN_PROVIDER: 'fake',
        NODE_ENV: 'production',
        BETTER_AUTH_URL: url,
      })
      expect(provider).toBeInstanceOf(FakeSendingDomainProvider)
    }
  )

  it('does not treat a lookalike host as loopback', () => {
    const provider = getSendingDomainProvider({
      SUPPORT_CHANNEL_PROVIDER: 'mailgun',
      SUPPORT_SENDING_DOMAIN_PROVIDER: 'fake',
      NODE_ENV: 'production',
      BETTER_AUTH_URL: 'https://localhost.evil.example',
    })
    expect(provider).toBeInstanceOf(MailgunSendingDomainProvider)
  })
})
