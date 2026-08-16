import { createLogger } from '~/server/utils/logger'
import { MailgunChannelDriver } from './webhook/mailgun'
import { PostmarkChannelDriver } from './webhook/postmark'
import type { ChannelDriver } from './types'

export * from './types'

const logger = createLogger('support-channels')

/**
 * Inbound channel driver selection, mirroring the `DOMAIN_PROVIDER` pattern in
 * `server/services/domains/`.
 *
 * Two lookups exist on purpose:
 *
 * - `getChannelDriver(name)` resolves the driver for the `[provider]` segment
 *   of an inbound request. The URL decides, because a deployment can have
 *   several providers pointed at it at once during a migration.
 * - `getConfiguredChannelDriver()` resolves the single driver named by
 *   `SUPPORT_CHANNEL_PROVIDER`, for code that needs the deployment's default
 *   without a request in hand.
 *
 * Unknown names return null rather than falling back to a default. Silently
 * accepting `/api/support/inbound/typo` under a real driver would mean
 * verifying signatures with the wrong scheme.
 */

export const SUPPORT_CHANNEL_PROVIDERS = ['postmark', 'mailgun'] as const
export type SupportChannelProvider = (typeof SUPPORT_CHANNEL_PROVIDERS)[number]

export function isSupportChannelProvider(value: string): value is SupportChannelProvider {
  return (SUPPORT_CHANNEL_PROVIDERS as readonly string[]).includes(value)
}

/** Build a driver by name. Returns null for anything unrecognised. */
export function getChannelDriver(name: string | null | undefined): ChannelDriver | null {
  const normalized = String(name ?? '')
    .trim()
    .toLowerCase()

  switch (normalized) {
    case 'postmark':
      return new PostmarkChannelDriver()
    case 'mailgun':
      return new MailgunChannelDriver()
    default:
      return null
  }
}

/** The provider named by `SUPPORT_CHANNEL_PROVIDER`, defaulting to Postmark. */
export function getConfiguredChannelProviderName(): string {
  return (process.env.SUPPORT_CHANNEL_PROVIDER || 'postmark').trim().toLowerCase()
}

export function getConfiguredChannelDriver(): ChannelDriver | null {
  const name = getConfiguredChannelProviderName()
  const driver = getChannelDriver(name)

  if (!driver) {
    logger.error('SUPPORT_CHANNEL_PROVIDER names an unknown provider; inbound mail will not be accepted', {
      provider: name,
      supported: SUPPORT_CHANNEL_PROVIDERS.join(', '),
    })
  }

  return driver
}
