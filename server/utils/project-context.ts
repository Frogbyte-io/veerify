/**
 * Active project for a principal (replaces the old active-team context).
 *
 * The session row (or the user_api_key row for key principals) stores `activeOrganizationId` and `activeProjectId`. Every
 * dashboard request that works "in the current project" resolves it through
 * `requireAuthWithResolvedProject`, which validates the stored project against
 * the access model in `project-access.ts` and repairs the stored context when the
 * project was deleted or access was revoked.
 *
 * `activeProjectScope = 'all'` means the principal works in All projects: every project of the active
 * organization they can open, combined. `activeProjectId` then keeps the last single project, which
 * project-only pages (Marketing, project settings) keep using. Routes that combine projects resolve
 * the set through `requireAuthWithProjectScope` / `requireScopedProjects`.
 */
import { and, asc, eq } from 'drizzle-orm'
import { resolveProjectModules, type ModuleKey } from '~/lib/modules'
import type { H3Event } from 'h3'
import { db } from '~/server/database/drizzle'
import { member, session as sessionTable } from '~/server/database/schema/auth'
import { userApiKey } from '~/server/database/schema/credentials'
import type { AuthSession } from './auth-middleware'
import { requireAuth } from './auth-middleware'
import {
  getOrganizationRole,
  getProjectById,
  listAccessibleProjects,
  resolveProjectRole,
  type OrganizationRole,
  type ProjectRole,
  type ProjectRow,
} from './project-access'
import { createErrorResponse, ErrorCode } from './response'
import { rememberLastContext } from './last-context'

/** `'all'`: All projects (every project the user can open in the active organization). */
export type ProjectScope = 'project' | 'all'

/** All projects only exists with at least this many projects the user can open. */
export const ALL_PROJECTS_MIN = 2

export interface ResolvedProject extends ProjectRow {
  role: ProjectRole
}

/** Where active context lives: the session row (cookie) or the API key row (credential principal). */
export type ContextTarget = { kind: 'session'; token: string } | { kind: 'user_api_key'; id: string; userId: string }

type ContextTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export function contextTargetFor(session: AuthSession): ContextTarget {
  if (session.credential) return { kind: session.credential.kind, id: session.credential.id, userId: session.user.id }
  return { kind: 'session', token: session.session.token }
}

/**
 * Store the active context. `scope` is only written when given, so repairs that fix a stale
 * organization or project keep the user in All projects.
 */
export async function writeContext(
  target: ContextTarget,
  organizationId: string | null,
  projectId: string | null,
  tx: ContextTransaction | typeof db = db,
  scope?: ProjectScope
) {
  const values: {
    activeOrganizationId: string | null
    activeProjectId: string | null
    activeProjectScope?: string | null
  } = { activeOrganizationId: organizationId, activeProjectId: projectId }
  if (scope !== undefined) values.activeProjectScope = scope === 'all' ? 'all' : null
  if (target.kind === 'user_api_key') {
    await tx
      .update(userApiKey)
      .set(values)
      .where(and(eq(userApiKey.id, target.id), eq(userApiKey.userId, target.userId)))
  } else {
    await tx.update(sessionTable).set(values).where(eq(sessionTable.token, target.token))
  }
}

/** Switch the stored context to a project the user can open (and to that project's organization). */
export async function setActiveProjectForSession(params: {
  target: ContextTarget
  userId: string
  projectId: string
}): Promise<ResolvedProject> {
  const proj = await getProjectById(params.projectId)
  if (!proj) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Project not found'),
    })
  }
  const role = await resolveProjectRole(proj, params.userId)
  if (!role) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'You do not have access to this project'),
    })
  }
  await writeContext(params.target, proj.organizationId, proj.id, db, 'project')
  if (params.target.kind === 'session') {
    await rememberLastContext(params.userId, {
      organizationId: proj.organizationId,
      projectId: proj.id,
      scope: 'project',
    })
  }
  return { ...proj, role }
}

/**
 * Switch to All projects in the given organization. Keeps the current project as the last single
 * one when it belongs there (else the first accessible). 409 when the user can open fewer than two.
 */
export async function setAllProjectsForSession(params: {
  target: ContextTarget
  userId: string
  organizationId: string
  currentProjectId?: string | null
}): Promise<ResolvedProject> {
  const projects = await listAccessibleProjects(params.organizationId, params.userId)
  if (projects.length < ALL_PROJECTS_MIN) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(ErrorCode.CONFLICT, 'All projects needs at least two projects you can open'),
    })
  }
  const keep = projects.find((p) => p.id === params.currentProjectId) ?? projects[0]!
  await writeContext(params.target, params.organizationId, keep.id, db, 'all')
  if (params.target.kind === 'session') {
    await rememberLastContext(params.userId, {
      organizationId: params.organizationId,
      projectId: keep.id,
      scope: 'all',
    })
  }
  return keep
}

/**
 * Switch the stored context to another organization and, in the same update, to a
 * project inside it, so it never holds a project from the previous
 * organization. `preferredProjectId` (last used) is honoured when accessible.
 * The project is null when the user can open no project in that organization yet.
 */
export async function setActiveOrganizationForSession(params: {
  target: ContextTarget
  userId: string
  organizationId: string
  preferredProjectId?: string | null
}): Promise<ResolvedProject | null> {
  const orgRole = await getOrganizationRole(params.organizationId, params.userId)
  if (!orgRole) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'You are not a member of this organization'),
    })
  }

  const projects = await listAccessibleProjects(params.organizationId, params.userId)
  const selected =
    (params.preferredProjectId && projects.find((p) => p.id === params.preferredProjectId)) || projects[0] || null

  await writeContext(params.target, params.organizationId, selected?.id ?? null, db, 'project')
  if (params.target.kind === 'session') {
    await rememberLastContext(params.userId, {
      organizationId: params.organizationId,
      projectId: selected?.id ?? null,
      scope: 'project',
    })
  }
  return selected
}

async function firstOrganizationIdForUser(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt))
    .limit(1)
  return row?.organizationId ?? null
}

/**
 * Implicit repair write. Skipped when the context came from per-request headers
 * (credential.contextOverride): the request uses the resolved values in memory
 * but headers never become the stored context.
 */
async function repairContext(session: AuthSession, organizationId: string | null, projectId: string | null) {
  if (session.credential?.contextOverride) return
  await writeContext(contextTargetFor(session), organizationId, projectId)
}

/**
 * The principal's active project, validated and repaired. Falls back to the
 * first accessible project in the active organization, then in the user's
 * first organization. Returns null when the user can open no project at all.
 */
export async function resolveActiveProjectForSession(session: AuthSession): Promise<ResolvedProject | null> {
  const userId = session.user.id
  const storedProjectId = session.session.activeProjectId ?? null
  const storedOrgId = session.session.activeOrganizationId ?? null

  if (storedProjectId) {
    const proj = await getProjectById(storedProjectId)
    if (proj) {
      const role = await resolveProjectRole(proj, userId)
      if (role) {
        if (storedOrgId !== proj.organizationId) await repairContext(session, proj.organizationId, proj.id)
        return { ...proj, role }
      }
    }
  }

  const orgCandidates: string[] = []
  if (storedOrgId) orgCandidates.push(storedOrgId)
  // A header-named workspace never falls back to another one.
  if (!session.credential?.contextOverride) {
    const firstOrg = await firstOrganizationIdForUser(userId)
    if (firstOrg && !orgCandidates.includes(firstOrg)) orgCandidates.push(firstOrg)
  }

  for (const orgId of orgCandidates) {
    const projects = await listAccessibleProjects(orgId, userId)
    if (projects[0]) {
      await repairContext(session, orgId, projects[0].id)
      return projects[0]
    }
  }

  if (storedProjectId) await repairContext(session, storedOrgId, null)
  return null
}

/**
 * Requires authentication and an active project. Throws 401 when signed out
 * and 409 when the user can open no project (the client sends them to create one).
 */
export async function requireAuthWithResolvedProject(event: H3Event) {
  const session = await requireAuth(event)
  const activeProject = await resolveActiveProjectForSession(session)
  if (!activeProject) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(ErrorCode.CONFLICT, 'No project found. Create a project to continue.'),
    })
  }
  return { session, activeProject }
}

/**
 * Requires authentication and an active organization the user belongs to
 * (for workspace-level endpoints: members, API keys, billing, project list).
 * Repairs `activeOrganizationId` from the user's first membership when unset.
 */
export async function requireAuthWithOrganization(event: H3Event): Promise<{
  session: AuthSession
  organizationId: string
  organizationRole: OrganizationRole
}> {
  const session = await requireAuth(event)
  const userId = session.user.id

  let organizationId = session.session.activeOrganizationId ?? null
  let organizationRole = organizationId ? await getOrganizationRole(organizationId, userId) : null

  if (!organizationRole && session.credential?.contextOverride) {
    // The header named this workspace; never silently use another one.
    organizationId = null
  } else if (!organizationRole) {
    organizationId = await firstOrganizationIdForUser(userId)
    organizationRole = organizationId ? await getOrganizationRole(organizationId, userId) : null
    if (organizationId && organizationRole) {
      await repairContext(session, organizationId, null)
    }
  }

  if (!organizationId || !organizationRole) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(ErrorCode.CONFLICT, 'No workspace found. Create a workspace to continue.'),
    })
  }

  return { session, organizationId, organizationRole }
}

export interface ProjectScopeContext {
  session: AuthSession
  /** The last single project (the one project when `scope` is `'project'`). */
  activeProject: ResolvedProject
  scope: ProjectScope
  /** Projects the request works in: every accessible project for `'all'`, else just `activeProject`. */
  projects: ResolvedProject[]
}

/** The stored scope, if the session asks for All projects and the user can still open two or more. */
export async function resolveProjectScope(session: AuthSession, activeProject: ResolvedProject) {
  if (session.session.activeProjectScope !== 'all') {
    return { scope: 'project' as ProjectScope, projects: [activeProject] }
  }
  const projects = await listAccessibleProjects(activeProject.organizationId, session.user.id)
  if (projects.length < ALL_PROJECTS_MIN) {
    if (!session.credential?.contextOverride) {
      await writeContext(contextTargetFor(session), activeProject.organizationId, activeProject.id, db, 'project')
    }
    return { scope: 'project' as ProjectScope, projects: [activeProject] }
  }
  return { scope: 'all' as ProjectScope, projects }
}

/**
 * Like `requireAuthWithResolvedProject`, plus the scope: in All projects `projects` holds every
 * project the user can open in the active organization (creation order).
 */
export async function requireAuthWithProjectScope(event: H3Event): Promise<ProjectScopeContext> {
  const { session, activeProject } = await requireAuthWithResolvedProject(event)
  const { scope, projects } = await resolveProjectScope(session, activeProject)
  return { session, activeProject, scope, projects }
}

/**
 * The projects a combining route works in: the scope's projects, narrowed by the `projects` query
 * parameter (comma-separated ids, the filter chips) and to those with `module` switched on.
 * An id outside the scope is 403, never silently dropped.
 */
export async function requireScopedProjects(
  event: H3Event,
  options: { module?: ModuleKey } = {}
): Promise<ProjectScopeContext & { scopeProjects: ResolvedProject[] }> {
  const context = await requireAuthWithProjectScope(event)
  const raw = getQuery(event).projects
  const requested = (Array.isArray(raw) ? raw.join(',') : typeof raw === 'string' ? raw : '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)

  let projects = context.projects
  if (requested.length > 0) {
    const byId = new Map(context.projects.map((p) => [p.id, p]))
    const unknown = requested.filter((id) => !byId.has(id))
    if (unknown.length > 0) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
        data: createErrorResponse(ErrorCode.FORBIDDEN, 'One or more projects are not in your current scope'),
      })
    }
    const wanted = new Set(requested)
    projects = context.projects.filter((p) => wanted.has(p.id))
  }
  if (options.module) {
    const key = options.module
    projects = projects.filter((p) => resolveProjectModules((p.settings ?? {}) as Record<string, unknown>)[key])
  }
  return { ...context, projects, scopeProjects: context.projects }
}
