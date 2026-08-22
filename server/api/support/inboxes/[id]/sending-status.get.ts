/**
 * @openapi
 * /api/support/inboxes/{id}/sending-status:
 *   get:
 *     tags: [Support]
 *     summary: Whether this inbox's From address is authorized to send with the configured provider
 *     description: >
 *       `supportInbox.emailAddress` is free text - nothing stops a team from
 *       setting a From the provider will reject at send time. This surfaces
 *       that in settings instead. `authorization` is null when no address is
 *       set yet (there is nothing to check); otherwise it is the driver's
 *       three-state verdict - `unknown` is not a failure, it is what every
 *       deployment reports until a provider account credential is set, and
 *       must not be rendered as "not authorized".
 *     operationId: getSupportInboxSendingStatus
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Sending authorization status }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Inbox not found }
 */
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxAccess } from '~/server/utils/support-access'
import { getConfiguredChannelDriver } from '~/server/services/support-channels'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const inboxId = getRouterParam(event, 'id') as string

  const inbox = await requireInboxAccess(inboxId, session.user.id)

  if (!inbox.emailAddress) {
    return createSuccessResponse({ address: null, authorization: null })
  }

  const driver = getConfiguredChannelDriver()
  const authorization = driver
    ? await driver.checkSendingAuthorization(inbox.emailAddress)
    : { status: 'unknown' as const, reason: 'No channel provider is configured for this deployment' }

  return createSuccessResponse({ address: inbox.emailAddress, authorization })
})
