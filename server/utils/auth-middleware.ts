/**
 * Authentication middleware utilities
 * Provides session validation and anonymous session handling
 */

import type { H3Event } from 'h3'
import { eq, and } from 'drizzle-orm'
import { auth } from '~/lib/auth'
import { db } from '~/server/database/drizzle'
import { member } from '~/server/database/schema/auth'
import { getAuthHeaders } from './auth-headers'
import { ErrorCode, createErrorResponse } from './response'
import { resolveUserApiKeyPrincipal } from './user-api-keys'

export interface AuthSession {
  user: {
    id: string
    email: string
    name: string
    emailVerified: boolean
    image?: string
    createdAt: Date
    updatedAt: Date
  }
  session: {
    id: string
    userId: string
    expiresAt: Date
    token: string
    ipAddress?: string
    userAgent?: string
    activeOrganizationId?: string
    activeProjectId?: string | null
  }
  /**
   * Set when the principal was resolved from a personal API key rather than a browser session.
   * `contextOverride`: org/project came from request headers, so they must not be persisted.
   */
  credential?: { kind: 'user_api_key'; id: string; contextOverride?: boolean }
}

/**
 * Requires authentication - throws 401 if not authenticated
 * @param event - H3 event
 * @returns Authenticated session
 * @throws 401 Unauthorized if no valid session
 */
export async function requireAuth(event: H3Event): Promise<AuthSession> {
  // A personal API key wins over any cookie; an invalid key throws 401 without fallback.
  const principal = await resolveUserApiKeyPrincipal(event)
  if (principal) return principal

  const session = await auth.api.getSession({
    headers: getAuthHeaders(event),
  })

  if (!session?.user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      data: createErrorResponse(ErrorCode.UNAUTHORIZED, 'Authentication required'),
    })
  }

  return session as AuthSession
}

/**
 * Optional authentication - returns session if available, null otherwise
 * Does not throw, suitable for endpoints that work with or without auth
 * @param event - H3 event
 * @returns Authenticated session or null
 */
export async function optionalAuth(event: H3Event): Promise<AuthSession | null> {
  // Errors here (401 invalid key, 403 bad context headers) must propagate, never degrade to anonymous.
  const principal = await resolveUserApiKeyPrincipal(event)
  if (principal) return principal

  try {
    const session = await auth.api.getSession({
      headers: getAuthHeaders(event),
    })

    if (!session?.user) {
      return null
    }

    return session as AuthSession
  } catch (error) {
    return null
  }
}

/** True when the principal came from a personal API key rather than a browser session. */
export function isCredentialPrincipal(session: AuthSession): boolean {
  return Boolean(session.credential)
}

/**
 * Requires a direct (cookie) sign-in. Personal API key principals get 403.
 */
export async function requireInteractiveSession(event: H3Event): Promise<AuthSession> {
  const session = await requireAuth(event)
  if (isCredentialPrincipal(session)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'This action requires signing in to Veerify directly'),
    })
  }
  return session
}

/**
 * Checks if user has a specific role in an organization
 * @param session - Auth session
 * @param organizationId - Organization ID to check
 * @param allowedRoles - Array of allowed roles (defaults to ['admin', 'owner'])
 * @returns True if user has required role
 */
export async function hasOrganizationRole(
  session: AuthSession,
  organizationId: string,
  allowedRoles: string[] = ['admin', 'owner']
): Promise<boolean> {
  const [membership] = await db
    .select()
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
    .limit(1)

  if (!membership) return false
  return allowedRoles.includes(membership.role)
}

/**
 * Requires specific organization role - throws 403 if insufficient permissions
 * @param event - H3 event
 * @param organizationId - Organization ID
 * @param allowedRoles - Array of allowed roles
 * @throws 401 if not authenticated, 403 if insufficient permissions
 */
export async function requireOrganizationRole(
  event: H3Event,
  organizationId: string,
  allowedRoles: string[] = ['admin', 'owner']
): Promise<AuthSession> {
  const session = await requireAuth(event)

  const hasRole = await hasOrganizationRole(session, organizationId, allowedRoles)

  if (!hasRole) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'Insufficient permissions'),
    })
  }

  return session
}
