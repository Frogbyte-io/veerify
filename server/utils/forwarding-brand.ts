/**
 * The sender brand of Frogmail's forward-confirmation emails
 * (`forwarding_brand_name` on `/api/v1/domains/{domain}/receiving`). Veerify
 * sends the project's display name, so a recipient sees who asks them to
 * confirm forwarding instead of the shared Frogmail project's name.
 *
 * Sent with `PUT` when receiving is enabled, and with a separate `PATCH` when
 * the project is renamed or the poller sees Frogmail report another value. A
 * Frogmail without brand support ignores the field on `PUT` and answers 422 to
 * the `PATCH` (`forwarding_paused` is required there); that failure is logged
 * and ignored, so an older Frogmail keeps working.
 */
import { and, eq, isNotNull, ne } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { projectMailDomain } from '~/server/database/schema/support'
import { getSendingDomainProvider } from '~/server/services/sending-domains'
import type { ProviderReceivingState, SendingDomainProvider } from '~/server/services/sending-domains/types'
import { isSendingDomainsEnabled } from '~/server/utils/sending-domains'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('forwarding-brand')

/** Frogmail's limit on `forwarding_brand_name`. */
export const MAX_FORWARDING_BRAND_LENGTH = 80

/** One line, no control characters, at most 80 characters; null when nothing is left. */
export function toForwardingBrandName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null
  const line = [...name]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0
      return code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029 ? ' ' : char
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  if (!line) return null
  return [...line].slice(0, MAX_FORWARDING_BRAND_LENGTH).join('').trim() || null
}

/** The brand for a domain claim: its project's name. Null when the claim or project is gone. */
export async function forwardingBrandForDomain(domainId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: project.name })
    .from(projectMailDomain)
    .innerJoin(project, eq(project.id, projectMailDomain.projectId))
    .where(eq(projectMailDomain.id, domainId))
    .limit(1)
  return toForwardingBrandName(row?.name)
}

export type ForwardingBrandSyncOutcome = 'updated' | 'unchanged' | 'unsupported' | 'failed'

/**
 * Bring Frogmail's brand for `domain` in line with `brandName`.
 *
 * `reported` is the receiving state just read from Frogmail, when there is one:
 * a value equal to `brandName` needs no call, and a state without the field
 * comes from a Frogmail without brand support (`unsupported`, no call). Without
 * a state the PATCH is sent unconditionally (a project rename). Never throws.
 */
export async function syncForwardingBrand(input: {
  provider: SendingDomainProvider
  domain: string
  brandName: string | null
  reported?: ProviderReceivingState | null
}): Promise<ForwardingBrandSyncOutcome> {
  if (!input.provider.setForwardingBrandName) return 'unsupported'
  if (input.reported) {
    if (input.reported.forwardingBrandName === undefined) return 'unsupported'
    if ((input.reported.forwardingBrandName ?? null) === input.brandName) return 'unchanged'
  }
  try {
    await input.provider.setForwardingBrandName(input.domain, input.brandName)
    return 'updated'
  } catch (error) {
    logger.warn('Could not set the forwarding brand name; Frogmail keeps its own', {
      domain: input.domain,
      error: error instanceof Error ? error.message : String(error),
    })
    return 'failed'
  }
}

/**
 * After a project rename: send the new brand for every domain of the project
 * that receives through the configured provider. Fire-and-forget safe: never
 * throws. Returns the number of domains updated.
 */
export async function syncProjectForwardingBrand(
  projectId: string,
  deps: { provider?: SendingDomainProvider | null } = {}
): Promise<number> {
  try {
    if (deps.provider === undefined && !isSendingDomainsEnabled()) return 0
    const provider = deps.provider !== undefined ? deps.provider : getSendingDomainProvider()
    if (!provider?.capabilities.forwarding || !provider.setForwardingBrandName) return 0

    const [owner] = await db.select({ name: project.name }).from(project).where(eq(project.id, projectId)).limit(1)
    if (!owner) return 0
    const brandName = toForwardingBrandName(owner.name)

    const domains = await db
      .select({ domain: projectMailDomain.domain })
      .from(projectMailDomain)
      .where(
        and(
          eq(projectMailDomain.projectId, projectId),
          eq(projectMailDomain.provider, provider.name),
          eq(projectMailDomain.providerAccountKey, provider.accountKey),
          isNotNull(projectMailDomain.receivingStatus),
          ne(projectMailDomain.receivingStatus, 'disabled'),
          ne(projectMailDomain.status, 'deleting')
        )
      )

    let updated = 0
    for (const row of domains) {
      if ((await syncForwardingBrand({ provider, domain: row.domain, brandName })) === 'updated') updated++
    }
    return updated
  } catch (error) {
    logger.warn('Forwarding brand sync after a project rename failed', {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }
}
