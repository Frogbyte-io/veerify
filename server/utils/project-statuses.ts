import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { teamMember } from '~/server/database/schema/auth'
import { requireAuthWithResolvedTeam } from './team-context'
import { createErrorResponse, ErrorCode } from './response'

// Default system statuses returned when a project has no custom statuses
export const SYSTEM_STATUSES = [
  { value: 'open', name: 'Open', color: '#3b82f6', description: 'Newly submitted feedback', sortOrder: 0, isDefault: true },
  { value: 'planned', name: 'Planned', color: '#8b5cf6', description: 'Acknowledged and planned for a future release', sortOrder: 1, isDefault: false },
  { value: 'in_progress', name: 'In Progress', color: '#f59e0b', description: 'Actively being worked on', sortOrder: 2, isDefault: false },
  { value: 'completed', name: 'Completed', color: '#10b981', description: 'Released or resolved', sortOrder: 3, isDefault: false },
  { value: 'closed', name: 'Closed', color: '#6b7280', description: 'Closed without action', sortOrder: 4, isDefault: false },
  { value: 'declined', name: 'Declined', color: '#ef4444', description: 'Out of scope or will not fix', sortOrder: 5, isDefault: false },
]

export function toStatusValue(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/-+/g, '_')
    .replace(/^_|_$/g, '')
}

export async function requireProjectStatusAccess(event: H3Event) {
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
