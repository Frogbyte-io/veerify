import { promises as dns } from 'dns'
import { eq } from 'drizzle-orm'
import { sendCustomDomainVerifiedEmail } from '~/lib/email'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'

export default defineEventHandler(async (event) => {
  const { session, project: selectedProject } = await requireProjectCategoryAccess(event)

  const query = getQuery(event)
  const domain = (query.domain as string | undefined)?.trim()

  if (!domain) {
    throw createError({ statusCode: 400, statusMessage: 'domain query parameter is required' })
  }
  if (!selectedProject.customDomain || selectedProject.customDomain !== domain) {
    throw createError({ statusCode: 400, statusMessage: 'domain must match the configured custom domain' })
  }

  const cnameTarget = useRuntimeConfig().public.cnameTarget as string
  const currentSettings = selectedProject.settings && typeof selectedProject.settings === 'object'
    ? selectedProject.settings
    : {}

  try {
    const cnames = await dns.resolveCname(domain)
    const matched = cnames.some(
      (c) => c.toLowerCase().replace(/\.$/, '') === cnameTarget.toLowerCase().replace(/\.$/, ''),
    )

    if (
      matched
      && session?.user?.email
      && currentSettings.domainVerifiedEmailSentFor !== domain
    ) {
      sendCustomDomainVerifiedEmail({
        to: session.user.email,
        name: session.user.name || 'there',
        projectName: selectedProject.name,
        domain,
      }).catch((err) => {
        console.error('Failed to send custom domain verified email:', err)
      })

      await db
        .update(project)
        .set({
          settings: {
            ...currentSettings,
            domainVerifiedEmailSentFor: domain,
            domainVerifiedEmailSentAt: new Date().toISOString(),
          },
          updatedAt: new Date(),
        })
        .where(eq(project.id, selectedProject.id))
    }

    return {
      verified: matched,
      resolvedTo: cnames,
      expected: cnameTarget,
    }
  } catch (err: any) {
    // ENOTFOUND = domain doesn't exist; ENODATA = no CNAME record found
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA' || err.code === 'ESERVFAIL') {
      return {
        verified: false,
        resolvedTo: [],
        expected: cnameTarget,
      }
    }
    throw createError({ statusCode: 500, statusMessage: 'DNS lookup failed' })
  }
})
