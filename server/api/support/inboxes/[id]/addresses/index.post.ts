/**
 * @openapi
 * /api/support/inboxes/{id}/addresses:
 *   post:
 *     tags: [Support]
 *     summary: Add a receiving address to an inbox
 *     description: >
 *       Address matching in resolveInboxByAddress is case-insensitive, so the
 *       address is normalized to lowercase on write - two rows differing only
 *       by case would otherwise both silently match the same inbound mail.
 *       isPrimary is exclusive: setting it clears the flag on the inbox's
 *       other addresses in the same transaction (not specified in
 *       design.md - a self-consistent reading of "primary" implying one).
 *       Under the team sender policy, an address on a domain (or subdomain of
 *       one) claimed by another team is refused, and addresses on the platform
 *       mail domain cannot be added by hand - use the platform address
 *       endpoint. When the deployment's provider routes inbound mail by the To/Cc
 *       header (Postmark), an address is only accepted on one of the team's own
 *       verified sending domains, because a header address on someone else's
 *       domain would capture that mail. Mailgun and Frogmail route by envelope
 *       recipient, so unclaimed domains stay allowed there. When the address is on one of the team's verified sending
 *       domains that receives mail through the provider, a provider inbound
 *       route is created best-effort.
 *     operationId: createSupportInboxAddress
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Address created }
 *       400: { description: projectId does not belong to this team }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Inbox not found }
 *       409: { description: "This address is already in use, or its domain is claimed by another team (ADDRESS_DOMAIN_CLAIMED)" }
 *       422: { description: "The address is on the platform mail domain (ADDRESS_DOMAIN_RESERVED), or the provider routes inbound mail by header (Postmark) and the address domain is not on this team's verified sending domain (ADDRESS_DOMAIN_UNVERIFIED)" }
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxRole } from '~/server/utils/support-access'
import { isUniqueViolation } from '~/server/utils/support-errors'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { supportInboxAddress } from '~/server/database/schema/support'
import { project } from '~/server/database/schema/feedback'
import { assertReceivingAddressAllowed } from '~/server/utils/sending-domains'
import { createDirectRouteForAddress } from '~/server/utils/inbound-routes'

const bodySchema = z.object({
  address: z.string().trim().toLowerCase().email().max(320),
  projectId: z.string().optional(),
  isPrimary: z.boolean().optional().default(false),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const inboxId = getRouterParam(event, 'id') as string
  const body = await validateBody(event, bodySchema)

  const inbox = await requireInboxRole(inboxId, session.user.id, 'admin')

  if (body.projectId) {
    const [matchedProject] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, body.projectId), eq(project.teamId, inbox.teamId)))
      .limit(1)

    if (!matchedProject) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Project is not part of this team'),
      })
    }
  }

  // Team sender policy (design §9.3; a no-op under the effective legacy policy).
  // Throws 409 ADDRESS_DOMAIN_CLAIMED, or 422 ADDRESS_DOMAIN_RESERVED /
  // ADDRESS_DOMAIN_UNVERIFIED.
  await assertReceivingAddressAllowed(inbox.teamId, body.address)

  let created: typeof supportInboxAddress.$inferSelect
  try {
    created = await db.transaction(async (tx) => {
      if (body.isPrimary) {
        await tx.update(supportInboxAddress).set({ isPrimary: false }).where(eq(supportInboxAddress.inboxId, inboxId))
      }

      const [row] = await tx
        .insert(supportInboxAddress)
        .values({
          id: randomUUID(),
          inboxId,
          address: body.address,
          projectId: body.projectId ?? null,
          isPrimary: body.isPrimary,
          createdAt: new Date(),
        })
        .returning()

      return row
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'This address is already in use'),
      })
    }
    throw error
  }

  // Direct receiving (design §9.2): after commit, best-effort, never fails the
  // request. The response reflects the stored route state.
  const routeStatus = await createDirectRouteForAddress({ teamId: inbox.teamId, inboxId, address: created }).catch(
    () => null
  )

  return createSuccessResponse({
    address: routeStatus ? { ...created, providerRouteStatus: routeStatus } : created,
  })
})
