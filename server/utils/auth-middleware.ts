/**
 * Authentication middleware utilities
 * Provides session validation and anonymous session handling
 */

import type { H3Event } from 'h3'
import { eq, and } from 'drizzle-orm'
import { auth } from '~/lib/auth'
import { db } from '~/server/database/drizzle'
import { member } from '~/server/database/schema/auth'
import { ErrorCode, createErrorResponse } from './response'

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
    activeTeamId?: string
  }
}

/**
 * Requires authentication - throws 401 if not authenticated
 * @param event - H3 event
 * @returns Authenticated session
 * @throws 401 Unauthorized if no valid session
 */
export async function requireAuth(event: H3Event): Promise<AuthSession> {
  const session = await auth.api.getSession({
    headers: event.node.req.headers as any,
  })

  if (!session?.user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      data: createErrorResponse(
        ErrorCode.UNAUTHORIZED,
        'Authentication required'
      )
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
  try {
    const session = await auth.api.getSession({
      headers: event.node.req.headers as any,
    })

    if (!session?.user) {
      return null
    }

    return session as AuthSession
  } catch (error) {
    return null
  }
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
      data: createErrorResponse(
        ErrorCode.FORBIDDEN,
        'Insufficient permissions'
      )
    })
  }

  return session
}
