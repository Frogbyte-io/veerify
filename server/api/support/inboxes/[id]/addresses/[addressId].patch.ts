/**
 * @openapi
 * /api/support/inboxes/{id}/addresses/{addressId}:
 *   patch:
 *     tags: [Support]
 *     summary: Update a receiving address
 *     description: >
 *       Changes the address's behaviour (`mail` or `helpdesk`; conversations
 *       already started keep the behaviour they were created with), product tag
 *       (`productId`, null to clear; must be a product of the inbox's project),
 *       primary flag (exclusive per inbox), or moves it to another inbox of the
 *       same project with `inboxId`. Moving needs admin rights on both inboxes,
 *       keeps the provider inbound route (it targets the shared inbound webhook,
 *       not the inbox) and clears `isPrimary` unless `isPrimary: true` is sent.
 *       Platform forwarding addresses belong to their inbox and cannot be moved.
 *       The address itself cannot be changed; delete it and add a new one.
 *     operationId: updateSupportInboxAddress
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: addressId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               behaviour: { type: string, enum: [mail, helpdesk] }
 *               productId: { type: string, nullable: true }
 *               isPrimary: { type: boolean }
 *               inboxId: { type: string, description: Another inbox of the same project to move the address to }
 *               deliverToInbox: { type: boolean, description: "False for a forward-only address; needs at least one forward" }
 *               forwardTo: { type: array, maxItems: 5, items: { type: string }, description: "Replaces the address's forwards (lowercased, deduplicated); [] removes them. Needs forwarding on the deployment and a verified, receiving domain of the project; a mailbox on the address's own domain is refused" }
 *     responses:
 *       200:
 *         description: Address updated
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
 *       400: { description: Validation failed }
 *       403: { description: Not an admin of this inbox, or of the target inbox }
 *       404: { description: Inbox, target inbox or address not found }
 *       409: { description: "Platform forwarding addresses cannot be moved (PLATFORM_ADDRESS_IMMOVABLE); forwarding is unavailable or the domain cannot receive yet (FORWARDING_UNAVAILABLE, FORWARD_RECEIVING_UNAVAILABLE)" }
 *       422: { description: "productId is not a product of the project (PRODUCT_NOT_IN_PROJECT), or the target inbox belongs to another project (INBOX_NOT_IN_PROJECT)" }
 */
import { z } from 'zod'
import { createError } from 'h3'
import { and, eq, ne } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxRole } from '~/server/utils/support-access'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { projectMailAddress } from '~/server/database/schema/support'
import { syncAddressRoute } from '~/server/utils/inbound-routes'
import {
  assertDeliveryTargets,
  assertForwardsAllowed,
  loadAddressForwards,
  mapForwardProviderError,
  normalizeForwardTo,
} from '~/server/utils/mail-forwards'
import {
  addressError,
  assertProductInProject,
  lockInboxesForAddressChange,
  toInboxAddressResponse,
} from '~/server/utils/inbox-address-rules'

const bodySchema = z.object({
  behaviour: z.enum(['mail', 'helpdesk']).optional(),
  productId: z.string().min(1).nullable().optional(),
  isPrimary: z.boolean().optional(),
  inboxId: z.string().min(1).optional(),
  deliverToInbox: z.boolean().optional(),
  forwardTo: z.array(z.string()).max(20).optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const inboxId = getRouterParam(event, 'id') as string
  const addressId = getRouterParam(event, 'addressId') as string
  const body = await validateBody(event, bodySchema)

  const inbox = await requireInboxRole(inboxId, session.user.id, 'admin')

  const [existing] = await db
    .select()
    .from(projectMailAddress)
    .where(and(eq(projectMailAddress.id, addressId), eq(projectMailAddress.inboxId, inboxId)))
    .limit(1)
  if (!existing) throw addressError(404, ErrorCode.NOT_FOUND, 'Address not found on this inbox')

  const moving = body.inboxId !== undefined && body.inboxId !== inboxId
  if (moving) {
    if (existing.kind === 'platform') {
      throw addressError(
        409,
        'PLATFORM_ADDRESS_IMMOVABLE',
        'Platform forwarding addresses belong to their inbox and cannot be moved.'
      )
    }
    // 404 / 403 unless the caller administers the target inbox too.
    const target = await requireInboxRole(body.inboxId as string, session.user.id, 'admin')
    if (target.projectId !== inbox.projectId) {
      throw addressError(422, 'INBOX_NOT_IN_PROJECT', 'Addresses can only move to another inbox of the same project.')
    }
  }

  if (body.productId) await assertProductInProject(inbox.projectId, body.productId)

  // Delivery: inbox, forwards, or both. `forwardTo` replaces the stored forwards.
  let forwardTo: string[] | undefined
  if (body.forwardTo !== undefined) {
    const forwards = normalizeForwardTo(body.forwardTo)
    if (!forwards.ok) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Validation failed',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, forwards.message),
      })
    }
    forwardTo = forwards.emails
  }
  const touchesDelivery = body.deliverToInbox !== undefined || forwardTo !== undefined
  if (touchesDelivery && existing.kind === 'platform') {
    throw addressError(409, 'FORWARDING_UNAVAILABLE', 'Platform forwarding addresses always deliver to their inbox.')
  }
  if (touchesDelivery) {
    const effectiveForwards =
      forwardTo ?? (await loadAddressForwards([addressId])).get(addressId)?.map((f) => f.email) ?? []
    assertDeliveryTargets(body.deliverToInbox ?? existing.deliverToInbox, effectiveForwards)
    if (forwardTo && forwardTo.length > 0) {
      await assertForwardsAllowed({ projectId: inbox.projectId, address: existing.address, forwardTo })
    }
  }

  const targetInboxId = moving ? (body.inboxId as string) : inboxId
  const patch: Partial<typeof projectMailAddress.$inferInsert> = {}
  if (body.behaviour !== undefined) patch.behaviour = body.behaviour
  if (body.productId !== undefined) patch.productId = body.productId
  if (body.deliverToInbox !== undefined) patch.deliverToInbox = body.deliverToInbox
  if (moving) patch.inboxId = targetInboxId
  // A moved address must not become a second primary on the target inbox.
  if (body.isPrimary !== undefined) patch.isPrimary = body.isPrimary
  else if (moving) patch.isPrimary = false

  if (Object.keys(patch).length === 0 && forwardTo === undefined) {
    const forwards = (await loadAddressForwards([addressId])).get(addressId) ?? []
    return createSuccessResponse({ address: { ...toInboxAddressResponse(existing), forwards } })
  }

  // The provider route first: if it refuses the forwards nothing is saved.
  let routeStatus: 'active' | 'failed' | null = null
  if (touchesDelivery) {
    try {
      const synced = await syncAddressRoute(addressId, {
        deliverToInbox: body.deliverToInbox,
        forwardTo,
        strict: true,
      })
      routeStatus = synced.status
    } catch (error) {
      throw mapForwardProviderError(error)
    }
  }

  const updated = await db.transaction(async (tx) => {
    await lockInboxesForAddressChange(tx, [inboxId, targetInboxId])
    if (patch.isPrimary) {
      await tx
        .update(projectMailAddress)
        .set({ isPrimary: false })
        .where(and(eq(projectMailAddress.inboxId, targetInboxId), ne(projectMailAddress.id, addressId)))
    }
    // Only forwards changed: the row itself stays as it is.
    if (Object.keys(patch).length === 0) return existing
    const [row] = await tx
      .update(projectMailAddress)
      .set(patch)
      .where(and(eq(projectMailAddress.id, addressId), eq(projectMailAddress.inboxId, inboxId)))
      .returning()
    // Deleted or moved by someone else between the read and the write: roll back.
    if (!row) throw addressError(404, ErrorCode.NOT_FOUND, 'Address not found on this inbox')
    return row
  })

  const forwards = (await loadAddressForwards([addressId])).get(addressId) ?? []
  return createSuccessResponse({
    address: {
      ...toInboxAddressResponse(routeStatus ? { ...updated, providerRouteStatus: routeStatus } : updated),
      forwards,
    },
  })
})
