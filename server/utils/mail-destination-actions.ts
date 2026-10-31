/**
 * Resend and revoke for a forward destination (E3). The local row mirrors
 * Frogmail's; the call goes to Frogmail by `frogmailDestinationId`, then the
 * answer is written back.
 */
import type { H3Event } from 'h3'
import { createError, setResponseHeader } from 'h3'
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { mailForwardDestination } from '~/server/database/schema/support'
import { getSendingDomainProvider } from '~/server/services/sending-domains'
import { SendingDomainProviderError } from '~/server/services/sending-domains/types'
import type { ProviderForwardDestination, SendingDomainProvider } from '~/server/services/sending-domains/types'
import { isSendingDomainsEnabled } from '~/server/utils/sending-domains'
import { resyncForwardOnlyRoutes } from '~/server/utils/inbound-routes'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import type { MailForwardStatus, ProjectMailAddressForward } from '~/lib/mail-address'

type DestinationRow = typeof mailForwardDestination.$inferSelect

export function toDestinationItem(row: DestinationRow): ProjectMailAddressForward {
  return {
    id: row.id,
    email: row.email,
    status: row.status as MailForwardStatus,
    statusReason: row.statusReason ?? null,
    verificationSentAt: row.verificationSentAt ? new Date(row.verificationSentAt).toISOString() : null,
  }
}

function fail(statusCode: number, statusMessage: string, code: string, message: string) {
  return createError({
    statusCode,
    statusMessage,
    data: { ...createErrorResponse(code === 'NOT_FOUND' ? ErrorCode.NOT_FOUND : ErrorCode.CONFLICT, message), code },
  })
}

async function loadDestination(projectId: string, id: string): Promise<DestinationRow> {
  const [row] = await db
    .select()
    .from(mailForwardDestination)
    .where(and(eq(mailForwardDestination.id, id), eq(mailForwardDestination.projectId, projectId)))
    .limit(1)
  if (!row) throw fail(404, 'Not Found', 'NOT_FOUND', 'Forward destination not found')
  return row
}

function requireForwardingProvider(): SendingDomainProvider {
  const provider = isSendingDomainsEnabled() ? getSendingDomainProvider() : null
  if (!provider?.capabilities.forwarding) {
    throw fail(409, 'Conflict', 'FORWARDING_UNAVAILABLE', 'Email forwarding is not available on this deployment.')
  }
  return provider
}

/** Maps a provider error: 429 keeps Retry-After, 409 conflict stays 409, unknown id is 404. */
function mapError(event: H3Event, error: unknown) {
  if (!(error instanceof SendingDomainProviderError)) return error
  if (error.code === 'rate_limited' || error.code === 'verification_throttled') {
    const seconds = error.retryAfterSeconds && error.retryAfterSeconds > 0 ? Math.ceil(error.retryAfterSeconds) : 60
    setResponseHeader(event, 'Retry-After', seconds)
    return createError({
      statusCode: 429,
      statusMessage: 'Too Many Requests',
      data: { ...createErrorResponse(ErrorCode.RATE_LIMITED, 'Try again in a moment.'), code: 'RATE_LIMITED' },
    })
  }
  if (error.code === 'conflict') {
    return fail(409, 'Conflict', 'FORWARD_DESTINATION_VERIFIED', 'This address has already confirmed forwarding.')
  }
  if (error.code === 'not_found') {
    return fail(404, 'Not Found', 'NOT_FOUND', 'Forward destination not found')
  }
  return error
}

async function store(row: DestinationRow, remote: ProviderForwardDestination): Promise<DestinationRow> {
  const [updated] = await db
    .update(mailForwardDestination)
    .set({
      frogmailDestinationId: remote.id,
      status: remote.status,
      statusReason: remote.statusReason,
      verificationSentAt: remote.verificationSentAt ?? row.verificationSentAt,
      verifiedAt: remote.verifiedAt ?? row.verifiedAt,
      updatedAt: new Date(),
    })
    .where(eq(mailForwardDestination.id, row.id))
    .returning()
  // A status change can switch a forward-only address's inbox fallback on or off.
  if (updated && updated.status !== row.status) await resyncForwardOnlyRoutes({ destinationIds: [row.id] })
  return updated ?? row
}

export async function resendForwardDestination(event: H3Event, projectId: string, id: string): Promise<DestinationRow> {
  const row = await loadDestination(projectId, id)
  const provider = requireForwardingProvider()
  if (row.status === 'verified') {
    throw fail(409, 'Conflict', 'FORWARD_DESTINATION_VERIFIED', 'This address has already confirmed forwarding.')
  }
  if (!row.frogmailDestinationId || !provider.resendForwardDestination) {
    throw fail(409, 'Conflict', 'FORWARD_DESTINATION_NOT_SYNCED', 'The confirmation email has not been requested yet.')
  }
  try {
    return await store(row, await provider.resendForwardDestination(row.frogmailDestinationId))
  } catch (error) {
    throw mapError(event, error)
  }
}

export async function revokeForwardDestination(event: H3Event, projectId: string, id: string): Promise<DestinationRow> {
  const row = await loadDestination(projectId, id)
  const provider = requireForwardingProvider()
  if (!row.frogmailDestinationId || !provider.deleteForwardDestination) {
    throw fail(409, 'Conflict', 'FORWARD_DESTINATION_NOT_SYNCED', 'This destination has not been sent to the provider.')
  }
  try {
    const remote = await provider.deleteForwardDestination(row.frogmailDestinationId)
    if (!remote) {
      // Gone at the provider: nothing forwards there any more.
      const [updated] = await db
        .update(mailForwardDestination)
        .set({ status: 'revoked', statusReason: 'api', updatedAt: new Date() })
        .where(eq(mailForwardDestination.id, row.id))
        .returning()
      if (row.status !== 'revoked') await resyncForwardOnlyRoutes({ destinationIds: [row.id] })
      return updated ?? row
    }
    return await store(row, remote)
  } catch (error) {
    throw mapError(event, error)
  }
}
