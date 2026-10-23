/**
 * @openapi
 * /api/support/inboxes:
 *   get:
 *     tags: [Support]
 *     summary: List inboxes for a project
 *     operationId: listSupportInboxes
 *     parameters:
 *       - in: query
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Inbox list }
 *       403: { description: Not a member of the project }
 */
import { z } from 'zod'
import { and, asc, eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { capabilitiesForRole, parseSupportInboxRole, type SupportInboxRole } from '~/server/utils/support-access'
import { requireProjectRole } from '~/server/utils/project-access'
import { validateQuery } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { supportInbox, supportInboxMember } from '~/server/database/schema/support'

const querySchema = z.object({
  projectId: z.string().min(1),
})

function redactChannelConfig<T extends { channelConfig?: unknown }>(inbox: T) {
  const safeInbox = { ...inbox }
  Reflect.deleteProperty(safeInbox, 'channelConfig')
  return safeInbox
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const query = validateQuery(event, querySchema)

  const { role: projectRole } = await requireProjectRole(query.projectId, session.user.id)

  // A project's inboxes are a short, fully-loaded settings list, not an
  // open-ended feed - unlike contacts/companies, this does not paginate.
  const isProjectAdmin = projectRole === 'admin'
  if (isProjectAdmin) {
    const inboxes = await db
      .select()
      .from(supportInbox)
      .where(eq(supportInbox.projectId, query.projectId))
      .orderBy(asc(supportInbox.createdAt))

    return createSuccessResponse({
      inboxes: inboxes.map((inbox) => ({
        ...redactChannelConfig(inbox),
        effectiveRole: 'admin' as SupportInboxRole,
        isProjectAdmin: true,
        capabilities: capabilitiesForRole('admin', true),
      })),
    })
  }

  // Project the joined fields explicitly. Drizzle's default join result keys
  // are an implementation detail and must not be used to recover the role.
  const inboxes = await db
    .select({ inbox: supportInbox, role: supportInboxMember.role })
    .from(supportInbox)
    .innerJoin(supportInboxMember, eq(supportInboxMember.inboxId, supportInbox.id))
    .where(and(eq(supportInbox.projectId, query.projectId), eq(supportInboxMember.userId, session.user.id)))
    .orderBy(asc(supportInbox.createdAt))

  const data = inboxes
    .map(({ inbox, role }) => {
      const effectiveRole = parseSupportInboxRole(role)
      if (!effectiveRole) {
        return null
      }
      return {
        ...redactChannelConfig(inbox),
        effectiveRole,
        isProjectAdmin: false,
        capabilities: capabilitiesForRole(effectiveRole, false),
      }
    })
    .filter((inbox): inbox is NonNullable<typeof inbox> => inbox !== null)

  return createSuccessResponse({ inboxes: data })
})
