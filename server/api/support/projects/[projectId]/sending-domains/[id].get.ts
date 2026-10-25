/**
 * @openapi
 * /api/support/projects/{projectId}/sending-domains/{id}:
 *   get:
 *     tags: [Support]
 *     summary: Get one sending domain with the inboxes that use it
 *     operationId: getSupportSendingDomain
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Sending domain detail }
 *       401: { description: Authentication required }
 *       403: { description: No support access to this project }
 *       404: { description: Feature disabled, or the domain does not belong to this project }
 */
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { getSendingDomainProvider } from '~/server/services/sending-domains'
import { getProjectSendingDomain, listProjectSendingDomains, toSendingDomainView } from '~/server/utils/sending-domains'
import {
  listInboxesUsingDomain,
  requireSendingDomainReader,
  requireSendingDomainsEnabled,
} from '~/server/utils/sending-domain-api'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId') as string
  const id = getRouterParam(event, 'id') as string
  await requireSendingDomainReader(projectId, session.user.id)
  requireSendingDomainsEnabled()

  // Cross-project ids are a 404 (never a 403), so claim ids stay opaque.
  const row = await getProjectSendingDomain(projectId, id)
  const provider = getSendingDomainProvider()
  const siblings = (await listProjectSendingDomains(projectId)).filter((other) => other.id !== row.id)
  const inboxes = await listInboxesUsingDomain(
    row,
    provider,
    siblings.map((other) => other.domain)
  )

  return createSuccessResponse({ ...toSendingDomainView(row, provider ?? undefined), inboxes })
})
