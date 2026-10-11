/**
 * @openapi
 * /api/marketing/teams/{teamId}/integrations/{id}/test:
 *   post:
 *     tags: [Marketing]
 *     summary: Test one Marketing integration
 *     description: >
 *       Team admins only. Runs the cheapest real check for the integration
 *       (key validation, one search, an encryption round trip, ...) and reports
 *       what was checked. Never returns keys. A rejected team key is marked
 *       invalid and a working one valid. Limited to 10 tests per hour per team.
 *     operationId: testMarketingIntegration
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           enum: [secrets, firecrawl, pagespeed, anthropic, openai, gemini, perplexity, hackernews, reddit, bluesky, google]
 *     responses:
 *       200:
 *         description: Test result (ok may be false)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     ok: { type: boolean }
 *                     durationMs: { type: integer }
 *                     detail: { type: string }
 *                     source: { type: string, nullable: true, enum: [team, instance] }
 *       400: { description: Unknown integration }
 *       403: { description: Team admin required }
 *       429: { description: Too many tests }
 */
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { requireRateLimit } from '~/server/utils/rate-limit'
import { createSuccessResponse } from '~/server/utils/response'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { badRequest, requireCredentialAdmin } from '~/server/utils/marketing-credential-routes'
import { dayStamp, requireDbLimit } from '~/server/utils/marketing-db-limit'
import { recordUsage } from '~/server/utils/marketing-usage'
import { isIntegrationId, runIntegrationTest } from '~/server/services/marketing/integration-test'

const TESTS_PER_HOUR = 10

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const teamId = requireRouteParam(event, 'teamId')
  const id = requireRouteParam(event, 'id')
  await requireCredentialAdmin(teamId, session.user.id)
  if (!isIntegrationId(id)) badRequest(`Unknown integration: ${id}`)

  await requireRateLimit(event, {
    maxRequests: TESTS_PER_HOUR,
    windowSeconds: 3600,
    identifier: 'marketing-integration-test',
    subject: teamId,
  })
  // Holds across serverless instances; keyed by UTC hour
  await requireDbLimit(
    teamId,
    `ratelimit:integration-test:${dayStamp()}T${new Date().getUTCHours()}`,
    TESTS_PER_HOUR,
    'Too many connection tests this hour. Try again later.'
  )

  const result = await runIntegrationTest(teamId, id)
  await recordUsage(teamId, 'integrations:tests', 1)
  return createSuccessResponse(result)
})
