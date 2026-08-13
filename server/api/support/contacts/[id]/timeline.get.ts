/**
 * @openapi
 * /api/support/contacts/{id}/timeline:
 *   get:
 *     tags: [Support]
 *     summary: Get a contact's linked and probable feedback timeline
 *     operationId: getSupportContactTimeline
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Linked entities and probable feedback suggestions }
 *       403: { description: Not a member of the contact's team }
 *       404: { description: Contact not found }
 */
import { and, eq, or } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireContactAccess } from '~/server/utils/support-access'
import { buildContactTimeline } from '~/server/utils/support-timeline'
import { db } from '~/server/database/drizzle'
import { contactLink } from '~/server/database/schema/support'
import { feedback, project } from '~/server/database/schema/feedback'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const contactId = getRouterParam(event, 'id') as string
  const contact = await requireContactAccess(contactId, session.user.id)

  const linked = await db.select().from(contactLink).where(eq(contactLink.contactId, contactId))

  const matchConditions = []
  if (contact.email) matchConditions.push(eq(feedback.authorEmail, contact.email))
  if (contact.userId) matchConditions.push(eq(feedback.authorUserId, contact.userId))

  const probableRows = matchConditions.length
    ? await db
        .select({ feedback, project: { id: project.id, name: project.name, slug: project.slug } })
        .from(feedback)
        .innerJoin(project, eq(project.id, feedback.projectId))
        .where(and(eq(project.teamId, contact.teamId), or(...matchConditions)))
    : []

  const probableFeedback = probableRows.map((row) => ({ ...row.feedback, project: row.project }))
  return createSuccessResponse(buildContactTimeline(linked, probableFeedback))
})
