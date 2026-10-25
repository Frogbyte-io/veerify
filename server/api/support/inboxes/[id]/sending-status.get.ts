/**
 * @openapi
 * /api/support/inboxes/{id}/sending-status:
 *   get:
 *     tags: [Support]
 *     summary: Whether this inbox's From address is authorized to send with the configured provider
 *     description: >
 *       `supportInbox.emailAddress` is free text - nothing stops a project from
 *       setting a From the provider will reject at send time. This surfaces
 *       that in settings instead. `authorization` is null when no address is
 *       set yet (there is nothing to check). `policy` is the deployment's
 *       sender policy. Under `project`, the verdict is scoped to this inbox's
 *       project: `authorized`, `pending` (domain claimed but not yet verified),
 *       `unauthorized` (with a `reason` and only this project's own verified
 *       domains in `projectDomains`) or `unknown`. Under `legacy`, it is the
 *       provider's verdict for the address. Provider-wide domain lists are
 *       never returned - the provider account is shared by every project.
 *       A From on another project's domain is
 *       always `unauthorized` / `not_owned` under every policy, verified or not,
 *       and the provider is not asked. `unknown` is not a failure and must not be rendered as "not
 *       authorized".
 *     operationId: getSupportInboxSendingStatus
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Sending authorization status }
 *       403: { description: Not a member of this inbox or a project admin }
 *       404: { description: Inbox not found }
 */
import type { SendingStatusResponse, ProjectSenderVerdict } from '~/lib/support-sending-domains'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxRole } from '~/server/utils/support-access'
import { getConfiguredChannelDriver } from '~/server/services/support-channels'
import type { SendingAuthorization } from '~/server/services/support-channels'
import { evaluateProjectSender } from '~/server/utils/sender-enforcement'
import { isDomainClaimedByOtherProject, resolveEffectiveSenderPolicy } from '~/server/utils/sending-domains'
import { emailDomain } from '~/server/services/support-channels/types'

/** Legacy driver verdict, reshaped to the shared union. Carries no domain lists. */
function legacyVerdict(authorization: SendingAuthorization): ProjectSenderVerdict {
  if (authorization.status === 'authorized') return { status: 'authorized', domain: null }
  if (authorization.status === 'unauthorized') {
    return { status: 'unauthorized', reason: 'not_owned', projectDomains: [] }
  }
  return authorization
}

async function isFromOnOtherProjectsClaim(projectId: string, address: string): Promise<boolean> {
  const domain = emailDomain(address.trim().toLowerCase())
  return domain ? isDomainClaimedByOtherProject(projectId, domain) : false
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const inboxId = getRouterParam(event, 'id') as string

  const inbox = await requireInboxRole(inboxId, session.user.id, 'agent')
  const policy = await resolveEffectiveSenderPolicy()

  if (!inbox.emailAddress) {
    return createSuccessResponse({ address: null, policy, authorization: null })
  }

  const projectVerdict = await evaluateProjectSender(inbox.projectId, inbox.emailAddress)
  let authorization: ProjectSenderVerdict
  if (projectVerdict) {
    authorization = projectVerdict
  } else if (await isFromOnOtherProjectsClaim(inbox.projectId, inbox.emailAddress)) {
    // Legacy asks the shared provider project, whose answer would reveal
    // whether another project's domain is verified. Answer as for any unowned domain.
    authorization = { status: 'unauthorized', reason: 'not_owned', projectDomains: [] }
  } else {
    const driver = getConfiguredChannelDriver()
    authorization = driver
      ? legacyVerdict(await driver.checkSendingAuthorization(inbox.emailAddress))
      : { status: 'unknown', reason: 'No channel provider is configured for this deployment' }
  }

  const response: Omit<SendingStatusResponse, 'authorization'> & { authorization: ProjectSenderVerdict | null } = {
    address: inbox.emailAddress,
    policy,
    authorization,
  }
  return createSuccessResponse(response)
})
