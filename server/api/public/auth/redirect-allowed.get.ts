import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  isAllowedRedirectProtocol,
  isAppHostedRedirectHost,
  normalizeHostname,
  parseRedirectUrl,
} from '~/lib/auth-redirect'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { createSuccessResponse } from '~/server/utils/response'
import { validateQuery } from '~/server/utils/validation'

const querySchema = z.object({
  target: z.string().trim().min(1).max(3000),
})

function denied() {
  return createSuccessResponse({
    allowed: false,
    target: null,
  })
}

export default defineEventHandler(async (event) => {
  const query = validateQuery(event, querySchema)
  const parsed = parseRedirectUrl(query.target)

  if (!parsed || parsed.username || parsed.password) {
    return denied()
  }

  const redirectHost = normalizeHostname(parsed.hostname)
  if (!isAllowedRedirectProtocol(parsed.protocol, redirectHost)) {
    return denied()
  }

  const config = useRuntimeConfig()
  const appDomain = normalizeHostname(String(config.public.appDomain || 'localhost'))
  const dashboardDomain = normalizeHostname(
    String(config.public.dashboardDomain || (appDomain === 'localhost' ? 'localhost' : `app.${appDomain}`))
  )

  if (
    isAppHostedRedirectHost({
      redirectHost,
      currentHost: appDomain,
      appDomain,
      dashboardDomain,
    })
  ) {
    return createSuccessResponse({
      allowed: true,
      target: parsed.toString(),
    })
  }

  const [matchingProject] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.customDomain, redirectHost), eq(project.isPublic, true)))
    .limit(1)

  if (!matchingProject) {
    return denied()
  }

  return createSuccessResponse({
    allowed: true,
    target: parsed.toString(),
  })
})
