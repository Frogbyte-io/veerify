/**
 * @openapi
 * /api/support/inboxes/{id}/addresses/platform:
 *   post:
 *     tags: [Support]
 *     summary: Get or create the inbox's platform forwarding address
 *     description: >
 *       Idempotent. Returns the inbox's existing platform address, or creates
 *       one (`<team>-<inbox>-<random>@SUPPORT_PLATFORM_MAIL_DOMAIN`) for inboxes
 *       that predate the feature. Customers forward their own support address
 *       to it. Platform addresses cannot be deleted; send `regenerate: true` to
 *       replace the address with a fresh one (the old address stops receiving).
 *       Inbox admins only. Returns 404 when no platform mail domain is
 *       configured for this deployment.
 *     operationId: createSupportInboxPlatformAddress
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               regenerate: { type: boolean, default: false }
 *     responses:
 *       200: { description: The inbox's platform address (existing or newly created) }
 *       400: { description: Validation failed }
 *       403: { description: Not an admin of this inbox }
 *       404: { description: "Inbox not found, or platform forwarding addresses are not enabled" }
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxRole } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { team } from '~/server/database/schema/auth'
import { ensurePlatformAddress, findPlatformAddress, getPlatformMailDomain } from '~/server/utils/platform-address'

const bodySchema = z.object({ regenerate: z.boolean().optional().default(false) }).strict()

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const inboxId = getRouterParam(event, 'id') as string

  const raw = (await readBody(event).catch(() => undefined)) ?? {}
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Validation failed', parsed.error.flatten()),
    })
  }

  const inbox = await requireInboxRole(inboxId, session.user.id, 'admin')

  if (!getPlatformMailDomain()) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Platform forwarding addresses are not enabled'),
    })
  }

  const existing = parsed.data.regenerate ? null : await findPlatformAddress(inboxId)

  const address =
    existing ??
    (await db.transaction(async (tx) => {
      const [owningTeam] = await tx.select({ slug: team.slug }).from(team).where(eq(team.id, inbox.teamId)).limit(1)
      if (!owningTeam) return null
      return ensurePlatformAddress(tx, { id: inbox.id, slug: inbox.slug }, owningTeam.slug, {
        regenerate: parsed.data.regenerate,
      })
    }))

  if (!address) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Inbox not found'),
    })
  }

  return createSuccessResponse({ address, created: existing === null })
})
