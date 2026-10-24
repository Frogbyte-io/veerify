/**
 * Response shapes for the project/product context (see docs/plans/2026-10-23-projects-products/design.md).
 */
import { asc, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { member, organization, user } from '~/server/database/schema/auth'
import { projectMember } from '~/server/database/schema/feedback'
import { resolveProjectModules, type ModuleSettings } from '~/lib/modules'
import {
  getOrganizationRole,
  isOrganizationAdminRole,
  listProducts,
  type OrganizationRole,
  type ProductRow,
  type ProjectRole,
  type ProjectRow,
} from './project-access'

export type ProductSummary = {
  id: string
  name: string
  slug: string
  description: string | null
  isPublic: boolean
  sortOrder: number
}

export type ProjectSummary = {
  id: string
  name: string
  slug: string
  description: string | null
  isPublic: boolean
  accessMode: 'workspace' | 'restricted'
  role: ProjectRole
  organizationId: string
}

export type ActiveProjectContext = {
  project: ProjectSummary & { settings: Record<string, unknown> }
  organization: { id: string; name: string; slug: string; logo: string | null; role: OrganizationRole }
  products: ProductSummary[]
  modules: ModuleSettings
}

export function toProductSummary(row: ProductRow): ProductSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? null,
    isPublic: row.isPublic,
    sortOrder: row.sortOrder,
  }
}

export function toProjectSummary(row: ProjectRow & { role: ProjectRole }): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? null,
    isPublic: row.isPublic,
    accessMode: row.accessMode === 'restricted' ? 'restricted' : 'workspace',
    role: row.role,
    organizationId: row.organizationId,
  }
}

export async function buildActiveProjectContext(
  activeProject: ProjectRow & { role: ProjectRole },
  userId: string
): Promise<ActiveProjectContext> {
  const [orgRows, orgRole, products] = await Promise.all([
    db.select().from(organization).where(eq(organization.id, activeProject.organizationId)).limit(1),
    getOrganizationRole(activeProject.organizationId, userId),
    listProducts(activeProject.id),
  ])
  const org = orgRows[0]
  const settings = (activeProject.settings ?? {}) as Record<string, unknown>

  return {
    project: { ...toProjectSummary(activeProject), settings },
    organization: {
      id: activeProject.organizationId,
      name: org?.name ?? '',
      slug: org?.slug ?? '',
      logo: org?.logo ?? null,
      role: orgRole ?? 'member',
    },
    products: products.map(toProductSummary),
    modules: resolveProjectModules(settings),
  }
}

export type ProjectMemberSource = 'organization_admin' | 'project_member' | 'workspace'

export type ProjectMemberEntry = {
  userId: string
  name: string
  email: string
  image: string | null
  role: ProjectRole
  source: ProjectMemberSource
}

/**
 * Every organization member who can open the project, with their effective
 * role and why they have access. Restricted projects exclude plain members
 * without a `project_member` row.
 */
export async function listProjectMembers(proj: ProjectRow): Promise<ProjectMemberEntry[]> {
  const [orgMembers, explicit] = await Promise.all([
    db
      .select({ userId: member.userId, orgRole: member.role, name: user.name, email: user.email, image: user.image })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.organizationId, proj.organizationId))
      .orderBy(asc(user.name), asc(user.id)),
    db
      .select({ userId: projectMember.userId, role: projectMember.role })
      .from(projectMember)
      .where(eq(projectMember.projectId, proj.id)),
  ])
  const explicitByUser = new Map(explicit.map((row) => [row.userId, row.role]))

  const result: ProjectMemberEntry[] = []
  for (const row of orgMembers) {
    const base = { userId: row.userId, name: row.name, email: row.email, image: row.image ?? null }
    if (isOrganizationAdminRole(row.orgRole)) {
      result.push({ ...base, role: 'admin', source: 'organization_admin' })
      continue
    }
    const projectRole = explicitByUser.get(row.userId)
    if (projectRole) {
      result.push({ ...base, role: projectRole === 'admin' ? 'admin' : 'member', source: 'project_member' })
    } else if (proj.accessMode !== 'restricted') {
      result.push({ ...base, role: 'member', source: 'workspace' })
    }
  }
  return result
}
