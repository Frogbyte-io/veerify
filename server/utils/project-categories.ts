import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { requireAuthWithOrganization } from './project-context'
import { requireProjectRole } from './project-access'
import { createErrorResponse, ErrorCode } from './response'

export function toCategorySlug(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export interface ProjectSlugAccessOptions {
  /** Require project admin (org owner/admin or project admin). Defaults to any project member. */
  admin?: boolean
}

/**
 * Resolves `projectSlug` inside the caller's active organization and verifies
 * access (404 when missing, 403 without access / without admin when requested).
 */
export async function requireProjectBySlug(
  event: H3Event,
  projectSlug: string,
  options: ProjectSlugAccessOptions = {}
) {
  const { session, organizationId } = await requireAuthWithOrganization(event)

  if (!projectSlug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Project slug is required'),
    })
  }

  const [selectedProject] = await db
    .select()
    .from(project)
    .where(and(eq(project.slug, projectSlug), eq(project.organizationId, organizationId)))
    .limit(1)

  if (!selectedProject) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Project not found'),
    })
  }

  const { project: accessible, role } = await requireProjectRole(selectedProject.id, session.user.id)
  if (options.admin && role !== 'admin') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'Only project admins can do this'),
    })
  }

  return { session, project: accessible, role, organizationId }
}

export async function requireProjectCategoryAccessBySlug(
  event: H3Event,
  projectSlug: string,
  options: ProjectSlugAccessOptions = {}
) {
  return requireProjectBySlug(event, projectSlug, options)
}

export async function requireProjectCategoryAccess(event: H3Event, options: ProjectSlugAccessOptions = {}) {
  const projectSlug = getRouterParam(event, 'slug') ?? getRouterParam(event, 'projectSlug')
  return requireProjectBySlug(event, projectSlug ?? '', options)
}
