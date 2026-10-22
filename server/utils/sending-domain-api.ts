import { and, eq, like, or } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import { supportInbox } from '~/server/database/schema/support'
import type { SendingDomainProvider } from '~/server/services/sending-domains/types'
import { getSendingDomainProvider } from '~/server/services/sending-domains'
import { isSendingDomainsEnabled } from '~/server/utils/sending-domains'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { resolveSupportTeamRole } from '~/server/utils/support-access'
import type { RegisterOutcome, SendingDomainRow } from '~/server/utils/sending-domain-poller'

/** Shared helpers for the team sending-domain routes (design §7). */

export interface SendingDomainInboxRef {
  id: string
  name: string
  emailAddress: string | null
}

export function requireSendingDomainsEnabled(): void {
  if (!isSendingDomainsEnabled()) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse('FEATURE_DISABLED', 'Custom sending domains are not enabled'),
    })
  }
}

/** Any support role, or a team admin, may read. Non-members are rejected by the resolver. */
export async function requireSendingDomainReader(teamId: string, userId: string) {
  const access = await resolveSupportTeamRole(teamId, userId)
  if (!access) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'You do not have access to this support inbox'),
    })
  }
  return access
}

/** The configured provider, or a 503 that names missing settings only (D-34). */
export function requireConfiguredSendingDomainProvider(): SendingDomainProvider {
  const provider = getSendingDomainProvider()
  const status = provider?.isConfigured()
  if (!provider || !status?.configured) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      data: createErrorResponse(
        'PROVIDER_NOT_CONFIGURED',
        'The mail provider for sending domains is not configured',
        status ? { missingEnvVars: status.missing } : undefined
      ),
    })
  }
  return provider
}

export function providerMisconfiguredError() {
  return createError({
    statusCode: 503,
    statusMessage: 'Service Unavailable',
    data: createErrorResponse(
      'PROVIDER_MISCONFIGURED',
      'Sending domains are temporarily unavailable. Contact your Veerify operator.'
    ),
  })
}

/** Map a non-success register outcome to the HTTP error of design §4.3. */
export function registerOutcomeToError(outcome: Exclude<RegisterOutcome, { kind: 'ok' | 'transient' }>) {
  if (outcome.kind === 'misconfigured') return providerMisconfiguredError()
  if (outcome.code === 'owned_elsewhere') {
    return createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(
        'DOMAIN_OWNED_ELSEWHERE',
        'This domain is already used to send mail by another service. Remove it there first or use a subdomain.'
      ),
    })
  }
  return createError({
    statusCode: 422,
    statusMessage: 'Unprocessable Entity',
    data: createErrorResponse('DOMAIN_REJECTED', outcome.message),
  })
}

/**
 * Inboxes of the team whose From address is on this claim's domain (or, where the
 * provider authorizes subdomains, a subdomain of it that no more specific claim of
 * the team covers).
 */
export async function listInboxesUsingDomain(
  row: Pick<SendingDomainRow, 'id' | 'teamId' | 'domain'>,
  provider: Pick<SendingDomainProvider, 'capabilities'> | null,
  otherTeamDomains: string[]
): Promise<SendingDomainInboxRef[]> {
  const candidates = await db
    .select({ id: supportInbox.id, name: supportInbox.name, emailAddress: supportInbox.emailAddress })
    .from(supportInbox)
    .where(
      and(
        eq(supportInbox.teamId, row.teamId),
        or(like(supportInbox.emailAddress, `%@${row.domain}`), like(supportInbox.emailAddress, `%@%.${row.domain}`))
      )
    )
  return filterInboxesUsingDomain(
    row.domain,
    candidates,
    otherTeamDomains,
    provider?.capabilities.authorizesSubdomains ?? false
  )
}

/** Pure label-boundary matching, separated so it can be unit tested. */
export function filterInboxesUsingDomain(
  domain: string,
  inboxes: SendingDomainInboxRef[],
  otherTeamDomains: string[],
  authorizesSubdomains: boolean
): SendingDomainInboxRef[] {
  return inboxes.filter((inbox) => {
    const host = inbox.emailAddress?.split('@')[1]?.toLowerCase()
    if (!host) return false
    if (host === domain) return true
    if (!authorizesSubdomains || !host.endsWith(`.${domain}`)) return false
    // A longer claim of the same team that also covers this host wins.
    return !otherTeamDomains.some(
      (other) => other.length > domain.length && (host === other || host.endsWith(`.${other}`))
    )
  })
}
