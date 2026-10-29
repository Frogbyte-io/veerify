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
 *       other addresses in the same transaction.
 *       A catch-all is written `*@domain` (the local part exactly `*`). It takes
 *       mail to every address of that exact domain that no other address
 *       matches, and is accepted only when the domain is one of the project's
 *       email domains in any status except deleting (422
 *       CATCH_ALL_DOMAIN_REQUIRED). `domainId` is set when the address's domain
 *       equals one of the project's email domains. `behaviour` decides whether
 *       the inbox's auto-reply, SLA, CSAT and automation rules apply to
 *       conversations started on the address (`helpdesk`, the default) or not
 *       (`mail`). `productId` tags the address with a product of the inbox's
 *       project. Custom addresses count toward the workspace's address limit
 *       (409 MAIL_ADDRESS_LIMIT_REACHED).
 *       Under the project sender policy, an address on a domain (or subdomain of
 *       one) claimed by another project is refused, and addresses on the platform
 *       mail domain cannot be added by hand - use the platform address
 *       endpoint. When the deployment's provider routes inbound mail by the To/Cc
 *       header (Postmark), an address is only accepted on one of the project's own
 *       verified sending domains, because a header address on someone else's
 *       domain would capture that mail. Mailgun and Frogmail route by envelope
 *       recipient, so unclaimed domains stay allowed there. When the address is
 *       on one of the project's verified sending domains that receives mail
 *       through the provider, a provider inbound route is created best-effort
 *       (a catch-all gets a domain-wide route that exact addresses take
 *       precedence over).
 *     operationId: createSupportInboxAddress
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [address]
 *             properties:
 *               address: { type: string, maxLength: 320, description: "An email address, or *@domain for a catch-all" }
 *               isPrimary: { type: boolean, default: false }
 *               behaviour: { type: string, enum: [mail, helpdesk], default: helpdesk }
 *               productId: { type: string, nullable: true, description: "A product of the inbox's project" }
 *     responses:
 *       200:
 *         description: Address created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     address: { $ref: '#/components/schemas/SupportInboxAddress' }
 *       400: { description: "Validation failed: not an email address or a well-formed *@domain" }
 *       403: { description: Not a member of this inbox or a project admin }
 *       404: { description: Inbox not found }
 *       409: { description: "This address is already in use, its domain is claimed by another project (ADDRESS_DOMAIN_CLAIMED), or the workspace address limit is reached (MAIL_ADDRESS_LIMIT_REACHED)" }
 *       422: { description: "The address is on the platform mail domain (ADDRESS_DOMAIN_RESERVED), the provider routes inbound mail by header (Postmark) and the address domain is not on this project's verified sending domain (ADDRESS_DOMAIN_UNVERIFIED), a catch-all's domain is not one of the project's email domains (CATCH_ALL_DOMAIN_REQUIRED), or productId is not a product of the project (PRODUCT_NOT_IN_PROJECT)" }
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxRole } from '~/server/utils/support-access'
import { isUniqueViolation } from '~/server/utils/support-errors'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { projectMailAddress } from '~/server/database/schema/support'
import { assertReceivingAddressAllowed } from '~/server/utils/sending-domains'
import { createDirectRouteForAddress } from '~/server/utils/inbound-routes'
import { assertCanAddMailAddress, getOrganizationIdForProject, lockMailUsage } from '~/server/utils/mail-limits'
import {
  addressError,
  assertProductInProject,
  MAX_ADDRESS_LENGTH,
  parseReceivingAddress,
  resolveAddressDomainId,
  toInboxAddressResponse,
} from '~/server/utils/inbox-address-rules'
import { DEFAULT_MAIL_ADDRESS_BEHAVIOUR } from '~/lib/mail-address'

const bodySchema = z.object({
  // Syntax (including the *@domain catch-all form) is checked by parseReceivingAddress.
  address: z.string().max(MAX_ADDRESS_LENGTH),
  isPrimary: z.boolean().optional().default(false),
  behaviour: z.enum(['mail', 'helpdesk']).optional().default(DEFAULT_MAIL_ADDRESS_BEHAVIOUR),
  productId: z.string().min(1).nullable().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const inboxId = getRouterParam(event, 'id') as string
  const body = await validateBody(event, bodySchema)

  const parsed = parseReceivingAddress(body.address)
  if (!parsed.ok) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Validation failed',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, parsed.message),
    })
  }

  const inbox = await requireInboxRole(inboxId, session.user.id, 'admin')

  // Project sender policy (design §9.3; a no-op under the effective legacy policy).
  // Throws 409 ADDRESS_DOMAIN_CLAIMED, or 422 ADDRESS_DOMAIN_RESERVED /
  // ADDRESS_DOMAIN_UNVERIFIED. It reads only the domain, so *@domain is covered.
  await assertReceivingAddressAllowed(inbox.projectId, parsed.address)

  if (body.productId) await assertProductInProject(inbox.projectId, body.productId)

  let created: typeof projectMailAddress.$inferSelect
  try {
    created = await db.transaction(async (tx) => {
      // Workspace address limit: count and insert under the workspace lock, so
      // two concurrent creates cannot both pass the check.
      const organizationId = await getOrganizationIdForProject(inbox.projectId, tx)
      await lockMailUsage(organizationId, tx)
      await assertCanAddMailAddress(organizationId, tx)

      // 422 CATCH_ALL_DOMAIN_REQUIRED when a catch-all's domain is not one of
      // the project's email domains.
      const domainId = await resolveAddressDomainId(inbox.projectId, parsed, tx)

      if (body.isPrimary) {
        await tx.update(projectMailAddress).set({ isPrimary: false }).where(eq(projectMailAddress.inboxId, inboxId))
      }

      const [row] = await tx
        .insert(projectMailAddress)
        .values({
          id: randomUUID(),
          inboxId,
          address: parsed.address,
          projectId: inbox.projectId,
          isPrimary: body.isPrimary,
          kind: 'custom',
          domainId,
          productId: body.productId ?? null,
          behaviour: body.behaviour,
          createdAt: new Date(),
        })
        .returning()

      return row
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw addressError(409, ErrorCode.CONFLICT, 'This address is already in use')
    }
    throw error
  }

  // Direct receiving (design §9.2): after commit, best-effort, never fails the
  // request. The response reflects the stored route state.
  const routeStatus = await createDirectRouteForAddress({
    projectId: inbox.projectId,
    inboxId,
    address: created,
  }).catch(() => null)

  return createSuccessResponse({
    address: toInboxAddressResponse(routeStatus ? { ...created, providerRouteStatus: routeStatus } : created),
  })
})
