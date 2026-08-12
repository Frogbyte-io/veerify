/**
 * Caddy on-demand TLS validation endpoint.
 *
 * Caddy calls this before issuing a certificate for an unknown hostname
 * (`on_demand_tls { ask ... }` in the Caddyfile). A 2xx means "issue", anything
 * else means "refuse".
 *
 * Without this gate the deployment is an open certificate-issuance relay:
 * anyone pointing DNS at the server triggers an ACME order, which burns Let's
 * Encrypt rate limits and gets the whole deployment throttled. So this must
 * stay strict — allow only hostnames Veerify actually serves.
 *
 * Unauthenticated by necessity: Caddy has no session. It is reachable from the
 * internet and hit once per unknown-host TLS handshake, which is exactly the
 * shape of a cheap amplification vector, so it is rate limited and does nothing
 * but a single indexed lookup.
 *
 * @openapi
 * /api/system/tls-ask:
 *   get:
 *     tags: [Internal]
 *     summary: Caddy on-demand TLS issuance check
 *     description: >
 *       Called by the reverse proxy before issuing a certificate for an unknown
 *       hostname. Returns 200 only for hostnames this instance serves.
 *     operationId: systemTlsAsk
 *     parameters:
 *       - in: query
 *         name: domain
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Certificate issuance allowed }
 *       403: { description: Hostname is not served by this instance }
 *       400: { description: Missing or malformed domain }
 */
import { findPublicProjectByDomain } from '~/server/utils/project-access'
import { buildTeamSubdomainHostname } from '~/server/services/domains/domain-service'
import { db } from '~/server/database/drizzle'
import { team } from '~/server/database/schema/auth'
import { eq } from 'drizzle-orm'
import { requireRateLimit } from '~/server/utils/rate-limit'
import { extractTeamSlug, parseAskHostname } from '~/server/utils/tls-ask'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('tls-ask')

export default defineEventHandler(async (event) => {
  // Its own bucket, so TLS probes cannot exhaust the limit for real traffic
  // from the same IP (Caddy sits in front, so that IP is often the proxy).
  await requireRateLimit(event, { maxRequests: 60, windowSeconds: 60, identifier: 'tls-ask' })

  const hostname = parseAskHostname(getQuery(event).domain)

  if (!hostname) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid domain' })
  }

  const config = useRuntimeConfig()
  const appDomain = String(config.public.appDomain || '')
    .trim()
    .toLowerCase()
  const dashboardDomain = String(config.public.dashboardDomain || '')
    .trim()
    .toLowerCase()

  // 1. The dashboard host itself.
  if (dashboardDomain && hostname === dashboardDomain) {
    return { allowed: true }
  }

  // 2. A team subdomain under the app domain, e.g. acme.veerify.io.
  //    Resolve the slug and confirm the team exists rather than trusting the
  //    suffix — otherwise any *.veerify.io label would mint a certificate.
  if (appDomain && hostname.endsWith(`.${appDomain}`)) {
    const slug = extractTeamSlug(hostname, appDomain)

    if (slug) {
      const [existing] = await db.select({ id: team.id }).from(team).where(eq(team.slug, slug)).limit(1)
      if (existing && buildTeamSubdomainHostname(slug, appDomain) === hostname) {
        return { allowed: true }
      }
    }

    logger.warn('Refused TLS issuance for unknown team subdomain', { hostname })
    throw createError({ statusCode: 403, statusMessage: 'Unknown host' })
  }

  // 3. A project custom domain, which must also be public — a private project's
  //    domain should not get a certificate it cannot serve anything from.
  const resolved = await findPublicProjectByDomain(hostname)
  if (resolved) {
    return { allowed: true }
  }

  logger.warn('Refused TLS issuance for unconfigured host', { hostname })
  throw createError({ statusCode: 403, statusMessage: 'Unknown host' })
})
