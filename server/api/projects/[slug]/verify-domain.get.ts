/**
 * @openapi
 * /api/projects/{slug}/verify-domain:
 *   get:
 *     tags: [Projects]
 *     summary: Verify custom domain
 *     description: >
 *       Checks DNS and provider status of the project's configured custom domain and stores the result. The `domain` query parameter must equal the project's current custom domain. Project admins only (organization owners and admins count as project admins). The project is looked up by slug in the active workspace (override with the `X-Veerify-Organization` header when using an API key). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: verifyProjectDomain
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         description: "Project slug"
 *         schema: { type: string }
 *       - in: query
 *         name: domain
 *         required: true
 *         description: "The project's configured custom domain"
 *         schema: { type: string }
 *     responses:
 *       200: { description: "Provider verification result (verified flag, status, DNS records)" }
 *       400: { description: "domain missing or does not match the configured custom domain" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Caller is not a project admin" }
 *       404: { description: "Project not found in the active workspace" }
 */
import { eq } from 'drizzle-orm'
import { sendCustomDomainVerifiedEmail } from '~/lib/email'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'
import {
  buildDomainSettingsPatch,
  normalizeCustomDomainInput,
  normalizeDomainSettings,
  shouldSendDomainVerifiedEmail,
  verifyProjectCustomDomain,
} from '~/server/services/domains/domain-service'
import { getStoredProviderDomain, persistProjectDomainResult } from '~/server/services/domains/domain-repository'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('projects')

export default defineEventHandler(async (event) => {
  const { session, project: selectedProject } = await requireProjectCategoryAccess(event, { admin: true })

  const query = getQuery(event)
  const domain = normalizeCustomDomainInput((query.domain as string | undefined) || null)

  if (!domain) {
    throw createError({ statusCode: 400, statusMessage: 'domain query parameter is required' })
  }
  if (!selectedProject.customDomain || selectedProject.customDomain !== domain) {
    throw createError({ statusCode: 400, statusMessage: 'domain must match the configured custom domain' })
  }

  const currentSettings = normalizeDomainSettings(selectedProject.settings)
  const stored = await getStoredProviderDomain(domain)
  const result = await verifyProjectCustomDomain(domain, { providerDomainId: stored?.providerDomainId })

  // Already-active domains (including ones adopted from another provider) never re-send.
  const sendVerifiedEmail = shouldSendDomainVerifiedEmail({
    verified: result.verified,
    domain,
    settings: currentSettings,
    previousStatus: stored?.status,
  })

  if (sendVerifiedEmail && session?.user?.email) {
    sendCustomDomainVerifiedEmail({
      to: session.user.email,
      name: session.user.name || 'there',
      projectName: selectedProject.name,
      domain,
    }).catch((err) => {
      logger.error('Failed to send custom domain verified email', {
        projectName: selectedProject.name,
        domain,
        error: err instanceof Error ? err.message : err,
      })
    })
  }

  const settingsUpdate = buildDomainSettingsPatch(currentSettings, result)
  if (result.verified) {
    settingsUpdate.domainVerifiedEmailSentFor = domain
    settingsUpdate.domainVerifiedEmailSentAt = new Date().toISOString()
  }

  await db.transaction(async (tx) => {
    await tx
      .update(project)
      .set({
        settings: settingsUpdate,
        updatedAt: new Date(),
      })
      .where(eq(project.id, selectedProject.id))

    await persistProjectDomainResult(selectedProject.id, result, tx)
  })

  return result
})
