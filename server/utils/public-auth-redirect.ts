import { and, eq } from 'drizzle-orm'
import { getRequestURL } from 'h3'
import {
  isAllowedRedirectProtocol,
  isAppHostedRedirectHost,
  normalizeHostname,
  parseRedirectUrl,
} from '~/lib/auth-redirect'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'

export async function resolveAllowedPublicRedirectTarget(event: Parameters<typeof getRequestURL>[0], rawTarget: string) {
  const parsed = parseRedirectUrl(rawTarget)

  if (!parsed || parsed.username || parsed.password) {
    return null
  }

  const redirectHost = normalizeHostname(parsed.hostname)
  if (!isAllowedRedirectProtocol(parsed.protocol, redirectHost)) {
    return null
  }

  const config = useRuntimeConfig()
  const appDomain = normalizeHostname(String(config.public.appDomain || 'localhost'))
  const dashboardDomain = normalizeHostname(
    String(config.public.dashboardDomain || (appDomain === 'localhost' ? 'localhost' : `app.${appDomain}`))
  )
  const currentHost = normalizeHostname(getRequestURL(event).hostname)

  if (
    isAppHostedRedirectHost({
      redirectHost,
      currentHost,
      appDomain,
      dashboardDomain,
    })
  ) {
    return parsed
  }

  const [matchingProject] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.customDomain, redirectHost), eq(project.isPublic, true)))
    .limit(1)

  if (!matchingProject) {
    return null
  }

  return parsed
}
