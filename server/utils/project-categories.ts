import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { teamMember } from '~/server/database/schema/auth'
import { requireAuthWithResolvedTeam } from './team-context'
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

export async function requireProjectCategoryAccess(event: H3Event) {
  const { session, activeTeam } = await requireAuthWithResolvedTeam(event)

  const projectSlug = getRouterParam(event, 'slug') ?? getRouterParam(event, 'projectSlug')
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
    .where(and(eq(project.slug, projectSlug), eq(project.teamId, activeTeam.id)))
    .limit(1)

  if (!selectedProject) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Project not found'),
    })
  }

  const [membership] = await db
    .select()
    .from(teamMember)
    .where(and(eq(teamMember.teamId, selectedProject.teamId), eq(teamMember.userId, session.user.id)))
    .limit(1)

  if (!membership) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'You are not a member of this project team'),
    })
  }

  return {
    session,
    project: selectedProject,
  }
}
