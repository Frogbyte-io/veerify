import { eq, and } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { project, feedback } from '~/server/database/schema/feedback'
import { teamMember, team } from '~/server/database/schema/auth'
import { createErrorResponse, ErrorCode } from './response'

/**
 * Verifies user has access to a project via team membership.
 * Throws 404 if project not found, 403 if no access.
 */
export async function requireProjectAccess(projectId: string, userId: string) {
  const [proj] = await db.select().from(project).where(eq(project.id, projectId)).limit(1)
  if (!proj) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Project not found'),
    })
  }

  const [membership] = await db
    .select()
    .from(teamMember)
    .where(and(eq(teamMember.teamId, proj.teamId), eq(teamMember.userId, userId)))
    .limit(1)

  if (!membership) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'You do not have access to this project'),
    })
  }

  return proj
}

/**
 * Verifies user has access to feedback's project via team membership.
 * Throws 404 if feedback not found, 403 if no access.
 */
export async function requireFeedbackAccess(feedbackId: string, userId: string) {
  const [fb] = await db.select().from(feedback).where(eq(feedback.id, feedbackId)).limit(1)
  if (!fb) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Feedback not found'),
    })
  }

  const proj = await requireProjectAccess(fb.projectId, userId)
  return { feedback: fb, project: proj }
}

/**
 * Checks if a project is publicly accessible (for anonymous users).
 * Returns project if public, throws 404 if not found, 403 if not public.
 */
export async function requirePublicProject(projectId: string) {
  const [proj] = await db.select().from(project).where(eq(project.id, projectId)).limit(1)
  if (!proj) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Project not found'),
    })
  }

  if (!proj.isPublic) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'This project does not accept public feedback'),
    })
  }

  return proj
}

/**
 * Resolves a public project by team slug and project slug.
 * Throws 404 if team/project not found, 403 if project is not public.
 */
export async function resolvePublicProjectByTeam(teamSlug: string, projectSlug: string) {
  const [t] = await db.select().from(team).where(eq(team.slug, teamSlug)).limit(1)
  if (!t) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Team not found'),
    })
  }

  const [proj] = await db
    .select()
    .from(project)
    .where(and(eq(project.teamId, t.id), eq(project.slug, projectSlug)))
    .limit(1)

  if (!proj) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Project not found'),
    })
  }

  if (!proj.isPublic) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'This project is not publicly accessible'),
    })
  }

  return { team: t, project: proj }
}
