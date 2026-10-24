import { createError } from 'h3'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'

export type CsatInboxAccess = {
  effectiveRole: 'agent' | 'supervisor' | 'admin'
  isProjectAdmin: boolean
}

export type CsatInboxScope =
  | { kind: 'all' }
  | { kind: 'member'; projectId: string; userId: string }
  | { kind: 'explicit'; inboxId: string }

type ResolveCsatInboxScopeInput = {
  projectId: string
  userId: string
  projectAccess: CsatInboxAccess
  requestedInboxId?: string
  requestedInboxProjectId?: string
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
 * runs. The project-id comparison remains here so a member of an inbox in a
 * different project cannot use a valid inbox membership to cross the route's
 * project boundary.
 */
export function resolveCsatInboxScope(input: ResolveCsatInboxScopeInput): CsatInboxScope {
  if (input.requestedInboxId) {
    if (input.requestedInboxProjectId !== input.projectId) throwForbidden()
    return { kind: 'explicit', inboxId: input.requestedInboxId }
  }

  if (input.projectAccess.isProjectAdmin) return { kind: 'all' }
  return { kind: 'member', projectId: input.projectId, userId: input.userId }
}
