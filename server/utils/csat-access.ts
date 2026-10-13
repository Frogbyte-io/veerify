import { createError } from 'h3'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'

export type CsatInboxAccess = {
  effectiveRole: 'agent' | 'supervisor' | 'admin'
  isTeamAdmin: boolean
}

export type CsatInboxScope =
  | { kind: 'all' }
  | { kind: 'member'; teamId: string; userId: string }
  | { kind: 'explicit'; inboxId: string }

type ResolveCsatInboxScopeInput = {
  teamId: string
  userId: string
  teamAccess: CsatInboxAccess
  requestedInboxId?: string
  requestedInboxTeamId?: string
}

function throwForbidden(): never {
  throw createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    data: createErrorResponse(ErrorCode.FORBIDDEN, 'You do not have access to this support inbox'),
  })
}

/**
 * Resolve the row scope for the authenticated CSAT summary.
 *
 * Explicit inbox access is checked by `requireInboxAccess` before this helper
 * runs. The team-id comparison remains here so a member of an inbox in a
 * different team cannot use a valid inbox membership to cross the route's
 * team boundary.
 */
export function resolveCsatInboxScope(input: ResolveCsatInboxScopeInput): CsatInboxScope {
  if (input.requestedInboxId) {
    if (input.requestedInboxTeamId !== input.teamId) throwForbidden()
    return { kind: 'explicit', inboxId: input.requestedInboxId }
  }

  if (input.teamAccess.isTeamAdmin) return { kind: 'all' }
  return { kind: 'member', teamId: input.teamId, userId: input.userId }
}
