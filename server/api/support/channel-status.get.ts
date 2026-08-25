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

/**
 * Which environment variables each provider needs before it will accept mail.
 *
 * **This duplicates knowledge that belongs in the drivers.** `ChannelDriver` has
 * no `isConfigured()`, and `server/services/support-channels/**` is the other
 * agent's territory this stage, so the mapping lives here rather than being
 * added there unilaterally. It should move onto the driver interface — see the
 * note in TODO.md. Until it does, adding a provider means updating this too.
 *
 * Only presence is ever read. No value is returned to the client.
 */
const REQUIRED_ENV: Record<string, string[]> = {
  // Postmark does not sign inbound webhooks; its documented protection is HTTP
  // Basic Auth on the webhook URL, so both halves must be set.
  postmark: ['SUPPORT_POSTMARK_WEBHOOK_USER', 'SUPPORT_POSTMARK_WEBHOOK_PASSWORD'],
  mailgun: ['SUPPORT_MAILGUN_SIGNING_KEY'],
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { inboxId } = validateQuery(event, z.object({ inboxId: z.string().min(1) }))
  await requireInboxRole(inboxId, session.user.id, 'agent')

  const provider = getConfiguredChannelProviderName()
  const driverAvailable = getConfiguredChannelDriver() !== null

  const required = REQUIRED_ENV[provider] ?? []
  const missing = required.filter((name) => !process.env[name]?.trim())

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
