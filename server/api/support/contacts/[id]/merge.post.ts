/**
 * @openapi
 * /api/support/contacts/{id}/merge:
 *   post:
 *     tags: [Support]
 *     summary: Merge another contact into this one
 *     description: >
 *       The path contact survives. The source contact is retained as a tombstone
 *       with mergedIntoContactId set, so stale references still resolve.
 *     operationId: mergeSupportContact
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Merged }
 *       400: { description: Contacts cannot be merged }
 *       403: { description: Not a member of the contact's team }
 *       404: { description: Contact not found }
 */
import { z } from 'zod'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireContactAccess } from '~/server/utils/support-access'
import { canMerge } from '~/server/utils/contact-merge'
import { mergeContactsInTransaction } from '~/server/utils/contact-merge-transaction'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'

const bodySchema = z.object({
  sourceContactId: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const survivorId = getRouterParam(event, 'id') as string
  const body = await validateBody(event, bodySchema)

  // Access is checked on BOTH contacts. Holding access to the survivor says
  // nothing about the source, and the source id comes straight from the request.
  const survivor = await requireContactAccess(survivorId, session.user.id)
  const loser = await requireContactAccess(body.sourceContactId, session.user.id)

  const check = canMerge(survivor, loser)
  if (!check.ok) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, check.reason),
    })
  }

  const { contact: merged, loser: mergedLoser } = await db.transaction((tx) =>
    mergeContactsInTransaction(tx, survivorId, body.sourceContactId)
  )

  return createSuccessResponse({ contact: merged, mergedFrom: mergedLoser.id })
})
