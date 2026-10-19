/**
 * @openapi
 * /api/support/channel-status:
 *   get:
 *     tags: [Support]
 *     summary: Report how inbound mail is configured for this deployment
 *     description: >
 *       Read-only. The provider and its webhook credentials are deployment
 *       environment configuration, not per-team settings, so this reports
 *       whether they are set - never their values.
 *     operationId: getSupportChannelStatus
 *     responses:
 *       200: { description: Channel status }
 *       401: { description: Not signed in }
 */
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxRole } from '~/server/utils/support-access'
import { validateQuery } from '~/server/utils/validation'
import { z } from 'zod'
import {
  SUPPORT_CHANNEL_PROVIDERS,
  getConfiguredChannelDriver,
  getConfiguredChannelProviderName,
} from '~/server/services/support-channels'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { inboxId } = validateQuery(event, z.object({ inboxId: z.string().min(1) }))
  await requireInboxRole(inboxId, session.user.id, 'agent')

  const provider = getConfiguredChannelProviderName()
  const driver = getConfiguredChannelDriver()
  const driverAvailable = driver !== null
  const missing = driver?.isConfigured().missing ?? []

  return createSuccessResponse({
    provider,
    supportedProviders: [...SUPPORT_CHANNEL_PROVIDERS],
    /** False when `SUPPORT_CHANNEL_PROVIDER` names something unrecognised. */
    driverAvailable,
    /** True only when every credential the provider needs is present. */
    credentialsConfigured: missing.length === 0,
    /**
     * Names only, never values — enough for an admin to know what to set
     * without this endpoint becoming a way to read secrets back out.
     */
    missingEnvVars: missing,
    /** Where the provider should be told to POST inbound mail. */
    inboundPath: `/api/support/inbound/${provider}`,
  })
})
