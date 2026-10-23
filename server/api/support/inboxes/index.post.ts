/**
 * @openapi
 * /api/support/inboxes:
 *   post:
 *     tags: [Support]
 *     summary: Create an inbox
 *     description: >
 *       The creator is added as a supportInboxMember with role "admin" in the
 *       same transaction - otherwise a project member who isn't a project admin
 *       could create an inbox they have no access to afterward. When
 *       `SUPPORT_PLATFORM_MAIL_DOMAIN` is set, a platform forwarding address
 *       is generated in the same transaction and returned as `platformAddress`
 *       (null when the feature is off).
 *     operationId: createSupportInbox
 *     responses:
 *       200: { description: Inbox created }
 *       403: { description: Not a member of the project }
 *       409: { description: An inbox with this slug already exists in the project }
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireProjectAdmin } from '~/server/utils/project-access'
import { isUniqueViolation } from '~/server/utils/support-errors'
import { validateBody, commonSchemas } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { supportInbox, supportInboxMember } from '~/server/database/schema/support'
import { ensurePlatformAddress } from '~/server/utils/platform-address'

const bodySchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  slug: commonSchemas.slug,
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await validateBody(event, bodySchema)

  const owningProject = await requireProjectAdmin(body.projectId, session.user.id)

  const now = new Date()
  const inboxId = randomUUID()

  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(supportInbox)
        .values({
          id: inboxId,
          projectId: body.projectId,
          name: body.name,
          slug: body.slug,
          createdAt: now,
          updatedAt: now,
        })
        .returning()

      await tx.insert(supportInboxMember).values({
        id: randomUUID(),
        inboxId,
        userId: session.user.id,
        role: 'admin',
        createdAt: now,
      })

      // Platform forwarding address (design §9.1); null without a platform domain.
      const platformAddress = await ensurePlatformAddress(
        tx,
        { id: inboxId, slug: created.slug, projectId: created.projectId },
        owningProject.slug
      )

      return createSuccessResponse({ inbox: created, platformAddress })
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'An inbox with this slug or email address already exists'),
      })
    }
    throw error
  }
})
