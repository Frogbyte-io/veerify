import { eq } from 'drizzle-orm'
import { sendCustomDomainVerifiedEmail } from '~/lib/email'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'
import {
  buildDomainSettingsPatch,
  normalizeCustomDomainInput,
  normalizeDomainSettings,
  verifyProjectCustomDomain,
} from '~/server/services/domains/domain-service'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('projects')

export default defineEventHandler(async (event) => {
  const { session, project: selectedProject } = await requireProjectCategoryAccess(event)

  const query = getQuery(event)
  const domain = normalizeCustomDomainInput((query.domain as string | undefined) || null)

  if (!domain) {
    throw createError({ statusCode: 400, statusMessage: 'domain query parameter is required' })
  }
  if (!selectedProject.customDomain || selectedProject.customDomain !== domain) {
    throw createError({ statusCode: 400, statusMessage: 'domain must match the configured custom domain' })
  }

  const currentSettings = normalizeDomainSettings(selectedProject.settings)
  const result = await verifyProjectCustomDomain(domain)

  if (result.verified && session?.user?.email && currentSettings.domainVerifiedEmailSentFor !== domain) {
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

  await db
    .update(project)
    .set({
      settings: settingsUpdate,
      updatedAt: new Date(),
    })
    .where(eq(project.id, selectedProject.id))

  return result
})
