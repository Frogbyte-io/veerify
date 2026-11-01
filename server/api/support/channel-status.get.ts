/**
 * @openapi
 * /api/support/channel-status:
 *   get:
 *     tags: [Support]
 *     summary: Report how inbound mail is configured for this deployment
 *     description: >
 *       Read-only. The provider and its webhook credentials are deployment
 *       environment configuration, not per-project settings, so this reports
 *       whether they are set - never their values. `platformAddress` is the
 *       inbox's platform forwarding address (customers forward their support
 *       address to it), or null when none exists yet.
 *       `platformForwardingEnabled` is true when the deployment sets
 *       `SUPPORT_PLATFORM_MAIL_DOMAIN`, so the UI can offer to create one for
 *       an inbox that predates it. `missingEnvVars` is always empty: missing
 *       setting names are logged on the server instead.
 *     operationId: getSupportChannelStatus
 *     responses:
 *       200: { description: Channel status }
 *       401: { description: Not signed in }
 */
import { createSuccessResponse } from '~/server/utils/response'
import { createLogger } from '~/server/utils/logger'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxRole } from '~/server/utils/support-access'
import { validateQuery } from '~/server/utils/validation'
import { z } from 'zod'
import { findPlatformAddress, getPlatformMailDomain } from '~/server/utils/platform-address'
import {
  SUPPORT_CHANNEL_PROVIDERS,
  getConfiguredChannelDriver,
  getConfiguredChannelProviderName,
} from '~/server/services/support-channels'

const logger = createLogger('support-channel')
let loggedMissing = ''

/** Setting names are for the operator: logged once per process and set of names, never sent to customers. */
function logMissingChannelSettings(provider: string, missing: string[]) {
  const key = `${provider}:${missing.join(',')}`
  if (key === loggedMissing) return
  loggedMissing = key
  logger.warn('The support mail channel is not configured; inbound mail is rejected', { provider, missing })
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { inboxId } = validateQuery(event, z.object({ inboxId: z.string().min(1) }))
  await requireInboxRole(inboxId, session.user.id, 'agent')

  const platformForwardingEnabled = getPlatformMailDomain() !== null
  const platformAddress = platformForwardingEnabled ? await findPlatformAddress(inboxId) : null

  const provider = getConfiguredChannelProviderName()
  const driver = getConfiguredChannelDriver()
  const driverAvailable = driver !== null
  const missing = driver?.isConfigured().missing ?? []
  if (!driverAvailable) logMissingChannelSettings(provider, ['SUPPORT_CHANNEL_PROVIDER'])
  else if (missing.length > 0) logMissingChannelSettings(provider, missing)

  return createSuccessResponse({
    provider,
    supportedProviders: [...SUPPORT_CHANNEL_PROVIDERS],
    /** False when `SUPPORT_CHANNEL_PROVIDER` names something unrecognised. */
    driverAvailable,
    /** True only when every credential the provider needs is present. */
    credentialsConfigured: missing.length === 0,
    /**
     * Always empty: missing setting names go to the server log for the operator,
     * not to customers. Kept for older clients.
     */
    missingEnvVars: [] as string[],
    /** Where the provider should be told to POST inbound mail. */
    inboundPath: `/api/support/inbound/${provider}`,
    platformForwardingEnabled,
    platformAddress: platformAddress?.address ?? null,
  })
})
