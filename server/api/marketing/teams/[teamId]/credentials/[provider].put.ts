/**
 * @openapi
 * /api/marketing/teams/{teamId}/credentials/{provider}:
 *   put:
 *     tags: [Marketing]
 *     summary: Add or replace a team API key
 *     description: >
 *       Team admins only. The key is checked against the provider before it is
 *       stored. A rejected key (authentication failure) returns 400 and is not
 *       saved. Network or provider outages save the key as `unchecked`. The key
 *       is encrypted at rest and never returned. Returns 503 when the server has
 *       no SECRETS_ENCRYPTION_KEY.
 *     operationId: putMarketingCredential
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: provider
 *         required: true
 *         schema: { type: string, enum: [anthropic, openai, firecrawl, pagespeed] }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [apiKey]
 *             properties:
 *               apiKey: { type: string }
 *               monthlyBudgetCents: { type: integer, nullable: true, description: LLM providers only }
 *     responses:
 *       200: { description: Credential saved (hint and status only) }
 *       400: { description: Invalid input or the provider rejected the key }
 *       403: { description: Team admin required }
 *       503: { description: Key encryption is not configured on this server }
 */
import { z } from 'zod'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { requireTeamAdmin } from '~/server/utils/support-access'
import { requireRateLimit } from '~/server/utils/rate-limit'
import { createSuccessResponse } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { saveTeamCredential } from '~/server/utils/team-credentials'
import { requireRouteParam } from '~/server/utils/marketing-site'
import {
  badRequest,
  isLlmCredentialProvider,
  requireCredentialProvider,
  requireSecretsConfigured,
} from '~/server/utils/marketing-credential-routes'
import { getLlmProvider, type LlmProviderId } from '~/server/services/llm'
import { getCrawlProvider, resolveCrawlConfig } from '~/server/services/crawl'

const bodySchema = z.object({
  apiKey: z.string().trim().min(8, 'API key is too short').max(500, 'API key is too long'),
  monthlyBudgetCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
})

interface ValidationOutcome {
  ok: boolean
  kind?: string
  message?: string
}

async function validateWithProvider(provider: string, apiKey: string): Promise<ValidationOutcome | null> {
  try {
    if (provider === 'anthropic' || provider === 'openai') {
      return await getLlmProvider(provider as LlmProviderId).validateKey(apiKey)
    }
    if (provider === 'firecrawl') {
      const config = resolveCrawlConfig(apiKey)
      if (!config) return null
      return await getCrawlProvider('firecrawl').validateKey(config)
    }
  } catch (error) {
    return { ok: false, kind: 'network', message: error instanceof Error ? error.message : 'Validation failed' }
  }
  // PageSpeed keys are saved unchecked
  return null
}

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const teamId = requireRouteParam(event, 'teamId')
  const provider = requireCredentialProvider(event)
  await requireTeamAdmin(teamId, session.user.id)
  requireSecretsConfigured()
  const body = await validateBody(event, bodySchema)

  if (body.monthlyBudgetCents !== undefined && !isLlmCredentialProvider(provider)) {
    badRequest('A monthly budget only applies to Anthropic and OpenAI keys')
  }

  await requireRateLimit(event, {
    maxRequests: 20,
    windowSeconds: 3600,
    identifier: 'marketing-credential-save',
    subject: `${teamId}:${session.user.id}`,
  })

  const outcome = await validateWithProvider(provider, body.apiKey)
  // Provider messages should not echo keys, but never rely on that
  const safeMessage = (outcome?.message ?? '').split(body.apiKey).join('[redacted]') || null

  if (outcome && !outcome.ok && outcome.kind === 'auth') {
    badRequest(safeMessage || 'The provider rejected this API key')
  }

  const credential = await saveTeamCredential({
    teamId,
    provider,
    apiKey: body.apiKey,
    userId: session.user.id,
    status: outcome ? (outcome.ok ? 'valid' : 'unchecked') : 'unchecked',
    lastError: outcome && !outcome.ok ? safeMessage : null,
    monthlyBudgetCents: body.monthlyBudgetCents,
  })

  return createSuccessResponse({ credential })
})
