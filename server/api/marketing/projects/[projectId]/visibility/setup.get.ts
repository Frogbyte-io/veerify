/**
 * @openapi
 * /api/marketing/projects/{projectId}/visibility/setup:
 *   get:
 *     tags: [Marketing]
 *     summary: Setup checklist for AI visibility
 *     description: Whether the site is verified, brand terms and prompts exist, and which LLM providers have a usable key.
 *     operationId: getVisibilitySetup
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Setup state }
 *       403: { description: Marketing is not enabled or no project access }
 *       404: { description: Project not found }
 */
import { and, eq, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { aiVisibilityPrompt, marketingSite, marketingTerm } from '~/server/database/schema/marketing'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { requireAuth } from '~/server/utils/auth-middleware'
import { LLM_PROVIDERS } from '~/server/services/llm'
import { listOrgCredentials } from '~/server/utils/org-credentials'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId') ?? ''
  const { organizationId } = await requireMarketingAccess(projectId, session.user.id)

  const [site] = await db.select().from(marketingSite).where(eq(marketingSite.projectId, projectId)).limit(1)
  const credentials = await listOrgCredentials(organizationId)
  const providers = LLM_PROVIDERS.map((p) => {
    const credential = credentials.find((c) => c.provider === p.id)
    return { id: p.id, label: p.label, status: credential?.status ?? 'missing' }
  })

  let brandTermCount = 0
  let activePromptCount = 0
  if (site) {
    const [terms] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(marketingTerm)
      .where(and(eq(marketingTerm.siteId, site.id), eq(marketingTerm.kind, 'brand')))
    const [prompts] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(aiVisibilityPrompt)
      .where(and(eq(aiVisibilityPrompt.siteId, site.id), eq(aiVisibilityPrompt.active, true)))
    brandTermCount = terms?.n ?? 0
    activePromptCount = prompts?.n ?? 0
  }

  const hasSite = Boolean(site)
  const siteVerified = Boolean(site?.verifiedAt)
  const hasUsableKey = providers.some((p) => p.status === 'valid' || p.status === 'unchecked')

  return createSuccessResponse({
    hasSite,
    siteVerified,
    siteOrigin: site?.origin ?? null,
    brandTermCount,
    activePromptCount,
    providers,
    hasUsableKey,
    canRun: siteVerified && brandTermCount > 0 && activePromptCount > 0 && hasUsableKey,
  })
})
