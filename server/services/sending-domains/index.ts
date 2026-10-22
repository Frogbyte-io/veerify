import { createLogger } from '~/server/utils/logger'
import { FakeSendingDomainProvider } from './providers/fake'
import { MailgunSendingDomainProvider } from './providers/mailgun'
import { PostmarkSendingDomainProvider } from './providers/postmark'
import type { SendingDomainProvider } from './types'

export * from './types'
export { checkDmarc, checkOwnershipTxt, ownershipRecord } from './ownership'
export { isFakeSendingDomainMode, resetFakeSendingDomainState } from './providers/fake'

const logger = createLogger('sending-domains')

/**
 * Provider for customer sending-domain management, chosen like the inbound
 * channel driver from `SUPPORT_CHANNEL_PROVIDER` (default `postmark`).
 *
 * `SUPPORT_SENDING_DOMAIN_PROVIDER=fake` swaps in the in-memory provider for
 * dev and e2e. It is refused when `NODE_ENV=production`: the override is
 * ignored (and logged) and the configured provider is used, so a stray
 * variable can never fake verification in production.
 *
 * Returns null for an unknown `SUPPORT_CHANNEL_PROVIDER`.
 */
export function getSendingDomainProvider(env: NodeJS.ProcessEnv = process.env): SendingDomainProvider | null {
  const override = env.SUPPORT_SENDING_DOMAIN_PROVIDER?.trim().toLowerCase()
  if (override === 'fake') {
    if (env.NODE_ENV === 'production') {
      logger.error('SUPPORT_SENDING_DOMAIN_PROVIDER=fake is refused in production; using the configured provider')
    } else {
      return new FakeSendingDomainProvider()
    }
  }

  const name = (env.SUPPORT_CHANNEL_PROVIDER?.trim() || 'postmark').toLowerCase()
  switch (name) {
    case 'mailgun':
      return new MailgunSendingDomainProvider()
    case 'postmark':
      return new PostmarkSendingDomainProvider()
    default:
      logger.error('SUPPORT_CHANNEL_PROVIDER names an unknown provider; sending domains are unavailable', {
        provider: name,
      })
      return null
  }
}
