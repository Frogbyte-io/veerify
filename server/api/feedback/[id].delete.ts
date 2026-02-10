import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { feedback, project } from '~/server/database/schema/feedback'
import { teamMember } from '~/server/database/schema/auth'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Feedback ID is required'),
    })
  }

  const [item] = await db.select().from(feedback).where(eq(feedback.id, id)).limit(1)
  if (!item) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Feedback not found'),
    })
  }

  // Allow deletion if user is the author
  const isAuthor = item.authorUserId === session.user.id

  if (!isAuthor) {
    // Check if user is a team member of the project's team
    const [proj] = await db.select().from(project).where(eq(project.id, item.projectId)).limit(1)
    if (!proj) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        data: createErrorResponse(ErrorCode.NOT_FOUND, 'Parent project not found'),
      })
    }

    const [membership] = await db
      .select()
      .from(teamMember)
      .where(and(eq(teamMember.teamId, proj.teamId), eq(teamMember.userId, session.user.id)))
      .limit(1)

    if (!membership) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
        data: createErrorResponse(ErrorCode.FORBIDDEN, 'You do not have permission to delete this feedback'),
      })
    }
  }

  await db.delete(feedback).where(eq(feedback.id, id))

  return createSuccessResponse({ id, deleted: true })
})
