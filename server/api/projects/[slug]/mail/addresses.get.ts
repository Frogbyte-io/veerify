/**
 * @openapi
 * /api/projects/{slug}/mail/addresses:
 *   get:
 *     tags: [Projects]
 *     summary: List the project's email addresses
 *     description: >
 *       Lists every email address of the project across its inboxes (custom and platform forwarding addresses, catch-alls included), with the inbox it delivers to, its behaviour (`mail` or `helpdesk`), its product tag and the provider route status. Sorted by domain, then catch-all last, then address. Also returns the project's domains with their receiving status, whether the deployment forwards mail (`forwarding`) and the workspace's mail usage against its tier limits. The project is looked up by slug in the active workspace (override with the `X-Veerify-Organization` header when using an API key). Any project member may read. Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: listProjectMailAddresses
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         description: "Project slug"
 *         schema: { type: string }
 *     responses:
 *       200: { description: "ProjectMailAddressesResponse plus usage: { addresses: ProjectMailAddressItem[] (each with deliverToInbox, inboxFallback (forward-only address still delivering to the inbox because no forward is confirmed yet) and forwards: [{ id, email, status, statusReason, verificationSentAt }]), domains: [{ id, domain, receivingStatus, forwardingPaused }], forwarding: boolean, usage: MailUsage }" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "No access to the project" }
 *       404: { description: "Project not found in the active workspace" }
 */
import { and, eq, ne } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { product } from '~/server/database/schema/feedback'
import { projectMailAddress, projectMailDomain, supportInbox } from '~/server/database/schema/support'
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { getMailUsage } from '~/server/utils/mail-limits'
import { createSuccessResponse } from '~/server/utils/response'
import { isCatchAllAddress, isMailAddressBehaviour, splitMailAddress } from '~/lib/mail-address'
import type { ProjectMailAddressesResponse, ProjectMailAddressItem, ProjectMailDomainItem } from '~/lib/mail-address'
import { getSendingDomainProvider } from '~/server/services/sending-domains'
import { isSendingDomainsEnabled } from '~/server/utils/sending-domains'
import { loadAddressForwards } from '~/server/utils/mail-forwards'

function compareAddresses(a: ProjectMailAddressItem, b: ProjectMailAddressItem) {
  const domainA = splitMailAddress(a.address)?.domain ?? ''
  const domainB = splitMailAddress(b.address)?.domain ?? ''
  if (domainA !== domainB) return domainA < domainB ? -1 : 1
  if (a.isCatchAll !== b.isCatchAll) return a.isCatchAll ? 1 : -1
  return a.address < b.address ? -1 : a.address > b.address ? 1 : 0
}

export default defineEventHandler(async (event) => {
  const { project, organizationId } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '')

  const rows = await db
    .select({
      id: projectMailAddress.id,
      address: projectMailAddress.address,
      kind: projectMailAddress.kind,
      isPrimary: projectMailAddress.isPrimary,
      behaviour: projectMailAddress.behaviour,
      inboxId: projectMailAddress.inboxId,
      inboxName: supportInbox.name,
      productId: projectMailAddress.productId,
      productName: product.name,
      domainId: projectMailAddress.domainId,
      routeStatus: projectMailAddress.providerRouteStatus,
      deliverToInbox: projectMailAddress.deliverToInbox,
      inboxFallback: projectMailAddress.providerRouteInboxFallback,
      createdAt: projectMailAddress.createdAt,
    })
    .from(projectMailAddress)
    .innerJoin(supportInbox, eq(supportInbox.id, projectMailAddress.inboxId))
    .leftJoin(product, eq(product.id, projectMailAddress.productId))
    .where(eq(projectMailAddress.projectId, project.id))

  const forwardsByAddress = await loadAddressForwards(rows.map((row) => row.id))

  const addresses: ProjectMailAddressItem[] = rows
    .map((row) => ({
      id: row.id,
      address: row.address,
      isCatchAll: isCatchAllAddress(row.address),
      kind: row.kind === 'platform' ? ('platform' as const) : ('custom' as const),
      isPrimary: row.isPrimary,
      behaviour: isMailAddressBehaviour(row.behaviour) ? row.behaviour : ('helpdesk' as const),
      inboxId: row.inboxId,
      inboxName: row.inboxName,
      productId: row.productId ?? null,
      productName: row.productName ?? null,
      domainId: row.domainId ?? null,
      routeStatus:
        row.routeStatus === 'active' ? ('active' as const) : row.routeStatus === 'failed' ? ('failed' as const) : null,
      deliverToInbox: row.deliverToInbox,
      // Only while the route that carries the fallback is live.
      inboxFallback: !row.deliverToInbox && row.inboxFallback && row.routeStatus === 'active',
      forwards: forwardsByAddress.get(row.id) ?? [],
      createdAt: new Date(row.createdAt).toISOString(),
    }))
    .sort(compareAddresses)

  const domainRows = await db
    .select({
      id: projectMailDomain.id,
      domain: projectMailDomain.domain,
      receivingStatus: projectMailDomain.receivingStatus,
      forwardingPausedAt: projectMailDomain.forwardingPausedAt,
    })
    .from(projectMailDomain)
    .where(and(eq(projectMailDomain.projectId, project.id), ne(projectMailDomain.status, 'deleting')))
  const domains: ProjectMailDomainItem[] = domainRows
    .map((row) => ({
      id: row.id,
      domain: row.domain,
      receivingStatus: (row.receivingStatus ?? null) as ProjectMailDomainItem['receivingStatus'],
      forwardingPaused: row.forwardingPausedAt !== null,
    }))
    .sort((a, b) => (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0))
  const forwarding = isSendingDomainsEnabled() && Boolean(getSendingDomainProvider()?.capabilities.forwarding)

  const usage = await getMailUsage(organizationId)
  const data: ProjectMailAddressesResponse = { addresses, domains, forwarding }
  return createSuccessResponse({ ...data, usage })
})
