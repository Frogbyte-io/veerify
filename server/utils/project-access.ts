/**
 * Project access model (replaces team membership).
 *
 *   Organization (workspace) → Project → Product
 *
 * - Organization owners/admins administer every project in their organization.
 * - Other organization members:
 *     accessMode 'workspace'  → every member can open the project (role 'member'),
 *                               a `project_member` row with role 'admin' makes them admin.
 *     accessMode 'restricted' → only members with a `project_member` row can open it.
 * - Users outside the organization never have access.
 *
 * Public (anonymous) access is separate: a project's public site exists when
 * `project.isPublic`, and a product's board is public when the project AND the
 * product are public.
 */
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { member, organization } from '~/server/database/schema/auth'
import {
  project,
  projectDomain,
  projectMember,
  product,
  feedback,
  type ProjectMemberRole,
} from '~/server/database/schema/feedback'
import { createErrorResponse, ErrorCode } from './response'

export type ProjectRow = typeof project.$inferSelect
export type ProductRow = typeof product.$inferSelect
export type OrganizationRole = 'owner' | 'admin' | 'member'

/** The caller's effective role on a project; null means no access. */
export type ProjectRole = ProjectMemberRole

const ORG_ADMIN_ROLES = new Set(['owner', 'admin'])

function notFound(message: string): never {
  throw createError({
    statusCode: 404,
    statusMessage: 'Not Found',
    data: createErrorResponse(ErrorCode.NOT_FOUND, message),
  })
}

function forbidden(message: string): never {
  throw createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    data: createErrorResponse(ErrorCode.FORBIDDEN, message),
  })
}

export async function getOrganizationRole(organizationId: string, userId: string): Promise<OrganizationRole | null> {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)
  if (!row) return null
  return (row.role as OrganizationRole) || 'member'
}

export function isOrganizationAdminRole(role: string | null | undefined): boolean {
  return !!role && ORG_ADMIN_ROLES.has(role)
}

/** Effective role of `userId` on an already-loaded project, or null when they have no access. */
export async function resolveProjectRole(proj: ProjectRow, userId: string): Promise<ProjectRole | null> {
  const orgRole = await getOrganizationRole(proj.organizationId, userId)
  if (!orgRole) return null
  if (isOrganizationAdminRole(orgRole)) return 'admin'

  const [membership] = await db
    .select({ role: projectMember.role })
    .from(projectMember)
    .where(and(eq(projectMember.projectId, proj.id), eq(projectMember.userId, userId)))
    .limit(1)

  if (membership) return membership.role === 'admin' ? 'admin' : 'member'
  return proj.accessMode === 'restricted' ? null : 'member'
}

export async function getProjectById(projectId: string): Promise<ProjectRow | null> {
  const [proj] = await db.select().from(project).where(eq(project.id, projectId)).limit(1)
  return proj ?? null
}

/** Effective role by project id; null when the project is missing or the user has no access. */
export async function getProjectRole(projectId: string, userId: string): Promise<ProjectRole | null> {
  const proj = await getProjectById(projectId)
  if (!proj) return null
  return resolveProjectRole(proj, userId)
}

export async function hasProjectAccess(projectId: string, userId: string): Promise<boolean> {
  return (await getProjectRole(projectId, userId)) !== null
}

export async function isProjectAdmin(projectId: string, userId: string): Promise<boolean> {
  return (await getProjectRole(projectId, userId)) === 'admin'
}

/**
 * Verifies the user can open the project.
 * Throws 404 if the project does not exist, 403 if the user has no access.
 */
export async function requireProjectAccess(projectId: string, userId: string): Promise<ProjectRow> {
  const { project: proj } = await requireProjectRole(projectId, userId)
  return proj
}

/** Like requireProjectAccess but also returns the caller's effective role. */
export async function requireProjectRole(
  projectId: string,
  userId: string
): Promise<{ project: ProjectRow; role: ProjectRole }> {
  const proj = await getProjectById(projectId)
  if (!proj) notFound('Project not found')
  const role = await resolveProjectRole(proj, userId)
  if (!role) forbidden('You do not have access to this project')
  return { project: proj, role }
}

/** Verifies the user administers the project (org owner/admin or project admin). */
export async function requireProjectAdmin(projectId: string, userId: string): Promise<ProjectRow> {
  const { project: proj, role } = await requireProjectRole(projectId, userId)
  if (role !== 'admin') forbidden('Only project admins can do this')
  return proj
}

/** Verifies the user is an owner/admin of the organization. */
export async function requireOrganizationAdmin(organizationId: string, userId: string): Promise<OrganizationRole> {
  const role = await getOrganizationRole(organizationId, userId)
  if (!role) forbidden('You are not a member of this organization')
  if (!isOrganizationAdminRole(role)) forbidden('Only organization owners and admins can do this')
  return role
}

/** Verifies the user is a member of the organization (any role). */
export async function requireOrganizationMember(organizationId: string, userId: string): Promise<OrganizationRole> {
  const role = await getOrganizationRole(organizationId, userId)
  if (!role) forbidden('You are not a member of this organization')
  return role
}

/**
 * Projects in an organization the user can open, with their effective role,
 * ordered by creation. Empty when the user is not an organization member.
 */
export async function listAccessibleProjects(
  organizationId: string,
  userId: string
): Promise<Array<ProjectRow & { role: ProjectRole }>> {
  const orgRole = await getOrganizationRole(organizationId, userId)
  if (!orgRole) return []

  const projects = await db
    .select()
    .from(project)
    .where(eq(project.organizationId, organizationId))
    .orderBy(asc(project.createdAt), asc(project.id))
  if (projects.length === 0) return []

  if (isOrganizationAdminRole(orgRole)) return projects.map((p) => ({ ...p, role: 'admin' as const }))

  const memberships = await db
    .select({ projectId: projectMember.projectId, role: projectMember.role })
    .from(projectMember)
    .where(
      and(
        eq(projectMember.userId, userId),
        inArray(
          projectMember.projectId,
          projects.map((p) => p.id)
        )
      )
    )
  const byProject = new Map(memberships.map((m) => [m.projectId, m.role]))

  const result: Array<ProjectRow & { role: ProjectRole }> = []
  for (const p of projects) {
    const explicit = byProject.get(p.id)
    if (explicit) result.push({ ...p, role: explicit === 'admin' ? 'admin' : 'member' })
    else if (p.accessMode !== 'restricted') result.push({ ...p, role: 'member' })
  }
  return result
}

/** Ids of every project the user can open across all their organizations. */
export async function listAccessibleProjectIds(userId: string): Promise<string[]> {
  const orgs = await db.select({ organizationId: member.organizationId }).from(member).where(eq(member.userId, userId))
  const ids: string[] = []
  for (const { organizationId } of orgs) {
    const projects = await listAccessibleProjects(organizationId, userId)
    ids.push(...projects.map((p) => p.id))
  }
  return ids
}

/**
 * Verifies user has access to feedback's project.
 * Throws 404 if feedback not found, 403 if no access.
 */
export async function requireFeedbackAccess(feedbackId: string, userId: string) {
  const [fb] = await db.select().from(feedback).where(eq(feedback.id, feedbackId)).limit(1)
  if (!fb) notFound('Feedback not found')

  const proj = await requireProjectAccess(fb.projectId, userId)
  return { feedback: fb, project: proj }
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export async function listProducts(projectId: string): Promise<ProductRow[]> {
  return db
    .select()
    .from(product)
    .where(eq(product.projectId, projectId))
    .orderBy(asc(product.sortOrder), asc(product.createdAt), asc(product.id))
}

/** The project's first product (by sort order); every project has at least one. */
export async function getDefaultProduct(projectId: string): Promise<ProductRow | null> {
  const [first] = await listProducts(projectId)
  return first ?? null
}

/**
 * Loads a product and checks it belongs to the project. With no `productId`,
 * returns the project's default product. Throws 404 when not found / mismatched.
 */
export async function requireProductInProject(projectId: string, productId?: string | null): Promise<ProductRow> {
  if (!productId) {
    const fallback = await getDefaultProduct(projectId)
    if (!fallback) notFound('Product not found')
    return fallback
  }
  const [row] = await db
    .select()
    .from(product)
    .where(and(eq(product.id, productId), eq(product.projectId, projectId)))
    .limit(1)
  if (!row) notFound('Product not found')
  return row
}

// ---------------------------------------------------------------------------
// Public (anonymous) access
// ---------------------------------------------------------------------------

/**
 * Checks if a project is publicly accessible (for anonymous users).
 * Returns project if public, throws 404 if not found, 403 if not public.
 */
export async function requirePublicProject(projectId: string): Promise<ProjectRow> {
  const proj = await getProjectById(projectId)
  if (!proj) notFound('Project not found')
  if (!proj.isPublic) forbidden('This project does not accept public feedback')
  return proj
}

/**
 * A product whose board is visible to anonymous users: the project and the
 * product must both be public. Private products 404 so their existence is not revealed.
 */
export async function requirePublicProduct(proj: ProjectRow, productSlugOrId?: string | null): Promise<ProductRow> {
  if (!proj.isPublic) forbidden('This project is not publicly accessible')
  const products = await listProducts(proj.id)
  const match = productSlugOrId
    ? products.find((p) => p.slug === productSlugOrId || p.id === productSlugOrId)
    : products.find((p) => p.isPublic)
  if (!match || !match.isPublic) notFound('Product not found')
  return match
}

/** Public products of a project, in display order. */
export async function listPublicProducts(projectId: string): Promise<ProductRow[]> {
  return (await listProducts(projectId)).filter((p) => p.isPublic)
}

export type OrganizationRow = typeof organization.$inferSelect

/**
 * Resolves a public project by organization slug and project slug.
 * Throws 404 if organization/project not found, 403 if project is not public.
 */
export async function resolvePublicProject(orgSlug: string, projectSlug: string) {
  const [org] = await db.select().from(organization).where(eq(organization.slug, orgSlug)).limit(1)
  if (!org) notFound('Organization not found')

  const [proj] = await db
    .select()
    .from(project)
    .where(and(eq(project.organizationId, org.id), eq(project.slug, projectSlug)))
    .limit(1)
  if (!proj) notFound('Project not found')
  if (!proj.isPublic) forbidden('This project is not publicly accessible')

  return { organization: org, project: proj }
}

/**
 * Finds a public project by its configured custom domain.
 * Returns null when the hostname is not mapped to a public project.
 */
export async function findPublicProjectByDomain(hostname: string) {
  const normalizedHostname = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (!normalizedHostname) return null

  const [result] = await db
    .select({ project, organization, domainStatus: projectDomain.status })
    .from(projectDomain)
    .innerJoin(project, eq(projectDomain.projectId, project.id))
    .innerJoin(organization, eq(project.organizationId, organization.id))
    .where(
      and(
        eq(projectDomain.hostname, normalizedHostname),
        eq(projectDomain.status, 'active'),
        eq(project.isPublic, true)
      )
    )
    .limit(1)

  return result || null
}
