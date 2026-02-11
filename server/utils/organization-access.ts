import { and, count, eq, ne } from 'drizzle-orm'
import type { AuthSession } from './auth-middleware'
import { db } from '~/server/database/drizzle'
import { member, organization, user } from '~/server/database/schema/auth'
import { project } from '~/server/database/schema/feedback'
import { createErrorResponse, ErrorCode } from './response'

export type OrganizationMemberSummary = {
  id: string
  userId: string
  role: string
  name: string
  email: string
  image: string | null
  createdAt: Date
}

export type OrganizationDetails = {
  id: string
  name: string
  slug: string | null
  logo: string | null
  createdAt: Date
  updatedAt: Date
  metadata: string | null
  settings: Record<string, any> | null
  memberCount: number
  currentUserRole: string
  projectCount: number
  members: OrganizationMemberSummary[]
}

export async function findOrganizationBySlug(slug: string) {
  const [org] = await db.select().from(organization).where(eq(organization.slug, slug)).limit(1)
  return org || null
}

export async function assertOrganizationSlugAvailable(slug: string, excludeOrganizationId?: string) {
  const [existing] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(
      excludeOrganizationId
        ? and(eq(organization.slug, slug), ne(organization.id, excludeOrganizationId))
        : eq(organization.slug, slug)
    )
    .limit(1)

  if (existing) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(ErrorCode.CONFLICT, 'Organization slug already exists'),
    })
  }
}

export async function getOrganizationMembership(params: { organizationId: string; userId: string }) {
  const [membership] = await db
    .select()
    .from(member)
    .where(and(eq(member.organizationId, params.organizationId), eq(member.userId, params.userId)))
    .limit(1)

  return membership || null
}

export async function requireOrganizationMembershipBySlug(session: AuthSession, slug: string) {
  const org = await findOrganizationBySlug(slug)
  if (!org) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Organization not found'),
    })
  }

  const membership = await getOrganizationMembership({
    organizationId: org.id,
    userId: session.user.id,
  })

  if (!membership) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'You are not a member of this organization'),
    })
  }

  return { org, membership }
}

export async function requireOrganizationRoleBySlug(
  session: AuthSession,
  slug: string,
  allowedRoles: string[]
) {
  const { org, membership } = await requireOrganizationMembershipBySlug(session, slug)
  if (!allowedRoles.includes(membership.role)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'Insufficient permissions'),
    })
  }

  return { org, membership }
}

export async function getOrganizationDetails(organizationId: string, currentUserId: string): Promise<OrganizationDetails> {
  const [org] = await db.select().from(organization).where(eq(organization.id, organizationId)).limit(1)
  if (!org) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Organization not found'),
    })
  }

  const [membership] = await db
    .select()
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, currentUserId)))
    .limit(1)

  if (!membership) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'You are not a member of this organization'),
    })
  }

  const [memberCountResult] = await db
    .select({ value: count() })
    .from(member)
    .where(eq(member.organizationId, organizationId))
  const memberCount = Number(memberCountResult?.value || 0)

  const [projectCountResult] = await db
    .select({ value: count() })
    .from(project)
    .where(eq(project.organizationId, organizationId))
  const projectCount = Number(projectCountResult?.value || 0)

  const members = await db
    .select({
      id: member.id,
      userId: member.userId,
      role: member.role,
      name: user.name,
      email: user.email,
      image: user.image,
      createdAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, organizationId))

  return {
    ...org,
    memberCount,
    currentUserRole: membership.role,
    projectCount,
    members,
  }
}
