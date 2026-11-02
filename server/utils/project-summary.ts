/**
 * Response shapes for the project/product context (see docs/plans/2026-10-23-projects-products/design.md).
 */
import { asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { member, organization, user } from '~/server/database/schema/auth'
import { product, project, projectMember } from '~/server/database/schema/feedback'
import { projectIdentity, type ProjectIdentity } from '~/lib/project-identity'
import { resolveProjectModules, type ModuleSettings } from '~/lib/modules'
import {
  getOrganizationRole,
  isOrganizationAdminRole,
  listAccessibleProjects,
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

/** A project as listed in All projects: summary, colour/initials and its tool switches. */
export type ScopeProject = ProjectSummary & {
  identity: ProjectIdentity
  modules: ModuleSettings
  productCount: number
}

export type ActiveProjectContext = {
  project: ProjectSummary & { settings: Record<string, unknown>; identity: ProjectIdentity }
  organization: { id: string; name: string; slug: string; logo: string | null; role: OrganizationRole }
  products: ProductSummary[]
  modules: ModuleSettings
  /** `'all'` while working in All projects; `project` then is the last single project. */
  scope: 'project' | 'all'
  /** Every project the user can open in this organization (creation order). */
  projects: ScopeProject[]
  /** Whether All projects is offered (two or more projects the user can open). */
  allProjectsAvailable: boolean
}

/** Each project's position in its organization (creation order), for stable identity colours. */
export async function projectIdentityIndex(organizationId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.organizationId, organizationId))
    .orderBy(asc(project.createdAt), asc(project.id))
  return new Map(rows.map((row, index) => [row.id, index]))
}

export async function identityFor(row: ProjectRow): Promise<ProjectIdentity> {
  const index = await projectIdentityIndex(row.organizationId)
  return projectIdentity(row, index.get(row.id) ?? 0)
}

/** Summaries with identity, tool switches and product counts for a list of accessible projects. */
export async function toScopeProjects(
  organizationId: string,
  rows: Array<ProjectRow & { role: ProjectRole }>
): Promise<ScopeProject[]> {
  if (rows.length === 0) return []
  const [index, counts] = await Promise.all([
    projectIdentityIndex(organizationId),
    db
      .select({ projectId: product.projectId, count: sql<number>`count(*)::int` })
      .from(product)
      .where(
        inArray(
          product.projectId,
          rows.map((r) => r.id)
        )
      )
      .groupBy(product.projectId),
  ])
  const countByProject = new Map(counts.map((c) => [c.projectId, c.count]))
  return rows.map((row) => ({
    ...toProjectSummary(row),
    identity: projectIdentity(row, index.get(row.id) ?? 0),
    modules: resolveProjectModules((row.settings ?? {}) as Record<string, unknown>),
    productCount: countByProject.get(row.id) ?? 0,
  }))
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

/**
 * @param storedScope the session's `activeProjectScope`; All projects is only reported while the user
 * can open two or more projects (requireAuthWithProjectScope repairs the stored value).
 */
export async function buildActiveProjectContext(
  activeProject: ProjectRow & { role: ProjectRole },
  userId: string,
  storedScope?: string | null
): Promise<ActiveProjectContext> {
  const [orgRows, orgRole, products, accessible] = await Promise.all([
    db.select().from(organization).where(eq(organization.id, activeProject.organizationId)).limit(1),
    getOrganizationRole(activeProject.organizationId, userId),
    listProducts(activeProject.id),
    listAccessibleProjects(activeProject.organizationId, userId),
  ])
  const org = orgRows[0]
  const settings = (activeProject.settings ?? {}) as Record<string, unknown>
  const projects = await toScopeProjects(activeProject.organizationId, accessible)
  const allProjectsAvailable = projects.length >= 2
  const identity = projects.find((p) => p.id === activeProject.id)?.identity ?? (await identityFor(activeProject))

  return {
    scope: storedScope === 'all' && allProjectsAvailable ? 'all' : 'project',
    projects,
    allProjectsAvailable,
    project: { ...toProjectSummary(activeProject), settings, identity },
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
