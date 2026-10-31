/**
 * Delivery webhooks for customer sending domains.
 *
 * Support replies sent from a customer domain report their delivery status
 * through the provider's per-domain webhooks (Mailgun `/v3/domains/{d}/webhooks`;
 * on Frogmail they belong to the project). Veerify ensures them itself for every
 * verified claim, from the domain poll and the manual Verify route, instead of an
 * operator creating them by hand.
 *
 * `project_mail_domain.delivery_webhooks_key` records what was last ensured (a hash
 * of provider, URL and events), so a verified claim costs no provider call once it
 * is done. A changed URL or event list, or a re-registration (which clears the
 * key), ensures them again. Failures are logged and retried on a later check.
 */
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { projectMailDomain } from '~/server/database/schema/support'
import { SendingDomainProviderError, type SendingDomainProvider } from '~/server/services/sending-domains/types'
import { createLogger } from './logger'

const logger = createLogger('sending-domain-webhooks')

/** Every event the delivery route (`/api/support/delivery/<provider>`) handles. */
export const DELIVERY_WEBHOOK_EVENTS = ['delivered', 'permanent_fail', 'temporary_fail', 'complained'] as const

/** `SUPPORT_DELIVERY_WEBHOOK_URL`, else `${BETTER_AUTH_URL}/api/support/delivery/<provider>`. */
export function deliveryWebhookUrl(providerName: string): string {
  const configured = (process.env.SUPPORT_DELIVERY_WEBHOOK_URL ?? '').trim()
  if (configured) return configured
  const base = (process.env.BETTER_AUTH_URL ?? '').trim().replace(/\/+$/, '')
  return `${base}/api/support/delivery/${providerName}`
}

/** The marker stored once the webhooks are in place. Not a secret. */
export function deliveryWebhooksKey(
  provider: Pick<SendingDomainProvider, 'name' | 'accountKey'>,
  url: string,
  events: readonly string[] = DELIVERY_WEBHOOK_EVENTS
): string {
  const input = [provider.name, provider.accountKey, url, [...events].sort().join(',')].join('\n')
  return `v1:${createHash('sha256').update(input).digest('hex').slice(0, 32)}`
}

export interface DeliveryWebhooksSyncResult {
  status: 'unsupported' | 'no_url' | 'unchanged' | 'ensured' | 'incomplete' | 'error'
  /** Provider error code when `status` is `error`. */
  code?: string
}

export interface DeliveryWebhooksSyncDeps {
  /** Records the marker; defaults to updating the claim row. */
  saveKey?: (id: string, key: string) => Promise<void>
}

async function saveDeliveryWebhooksKey(id: string, key: string): Promise<void> {
  await db.update(projectMailDomain).set({ deliveryWebhooksKey: key }).where(eq(projectMailDomain.id, id))
}

/**
 * Ensure the delivery webhooks for a verified claim. A no-op for providers without
 * webhook management (Postmark, the fake provider) and when the marker matches.
 * Never throws.
 */
export async function syncDeliveryWebhooks(
  row: { id: string; domain: string; deliveryWebhooksKey: string | null },
  provider: SendingDomainProvider,
  deps: DeliveryWebhooksSyncDeps = {}
): Promise<DeliveryWebhooksSyncResult> {
  if (!provider.ensureDeliveryWebhooks) return { status: 'unsupported' }

  const url = deliveryWebhookUrl(provider.name)
  if (!/^https?:\/\/[^/]/i.test(url)) {
    logger.warn('Delivery webhook URL is not absolute; set BETTER_AUTH_URL or SUPPORT_DELIVERY_WEBHOOK_URL', {
      domainId: row.id,
    })
    return { status: 'no_url' }
  }

  const key = deliveryWebhooksKey(provider, url)
  if (row.deliveryWebhooksKey === key) return { status: 'unchanged' }

  try {
    const result = await provider.ensureDeliveryWebhooks(row.domain, url, DELIVERY_WEBHOOK_EVENTS)
    if (result.signingKeyIssued) {
      // The key was in the response; it is deliberately dropped, never logged or stored.
      logger.warn(
        'The mail provider issued a new webhook signing key while creating delivery webhooks. ' +
          'Veerify did not keep it: rotate or look up the key with the provider and update SUPPORT_MAILGUN_SIGNING_KEY, ' +
          'or delivery and inbound webhooks will fail signature checks.',
        { domainId: row.id, provider: provider.name }
      )
    }
    if (result.created.length > 0 || result.updated.length > 0) {
      logger.info('Ensured delivery webhooks', {
        domainId: row.id,
        created: result.created,
        updated: result.updated,
      })
    }
    if (result.full.length > 0) {
      logger.warn('Delivery webhook events already have the maximum number of URLs; ours was not added', {
        domainId: row.id,
        events: result.full,
      })
      return { status: 'incomplete' }
    }
    await (deps.saveKey ?? saveDeliveryWebhooksKey)(row.id, key)
    return { status: 'ensured' }
  } catch (raw) {
    const code = raw instanceof SendingDomainProviderError ? raw.code : 'internal_error'
    logger.warn('Could not ensure delivery webhooks; retrying on a later check', { domainId: row.id, code })
    return { status: 'error', code }
  }
}
