import { and, eq, ne } from 'drizzle-orm'
import { getRequestURL } from 'h3'
import {
  isAllowedRedirectProtocol,
  isAppHostedRedirectHost,
  normalizeHostname,
  parseRedirectUrl,
} from '~/lib/auth-redirect'
import { db } from '~/server/database/drizzle'
import { project, projectDomain } from '~/server/database/schema/feedback'

export async function resolveAllowedPublicRedirectTarget(
  event: Parameters<typeof getRequestURL>[0],
  rawTarget: string
) {
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
    .from(projectDomain)
    .innerJoin(project, eq(projectDomain.projectId, project.id))
    .where(
      and(eq(projectDomain.hostname, redirectHost), ne(projectDomain.status, 'detached'), eq(project.isPublic, true))
    )
    .limit(1)

  if (!matchingProject) {
    return null
  }

  return parsed
}
