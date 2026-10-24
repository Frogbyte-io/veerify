/**
 * @openapi
 * /api/workspace/api-keys/{provider}:
 *   delete:
 *     tags: [Marketing]
 *     summary: Remove a workspace API key
 *     description: Workspace owners and admins only.
 *     operationId: deleteMarketingCredential
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema: { type: string, enum: [anthropic, openai, perplexity, gemini, firecrawl, pagespeed] }
 *     responses:
 *       200: { description: Key removed }
 *       403: { description: Workspace owner or admin required }
 *       404: { description: No key stored for this provider }
 */
import { requireAuthWithOrganization } from '~/server/utils/project-context'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { deleteOrgCredential } from '~/server/utils/org-credentials'
import { requireCredentialProvider, requireCredentialAdmin } from '~/server/utils/marketing-credential-routes'

export default defineEventHandler(async (event) => {
  const { session, organizationId } = await requireAuthWithOrganization(event)
  const provider = requireCredentialProvider(event)
  await requireCredentialAdmin(organizationId, session.user.id)

  const deleted = await deleteOrgCredential(organizationId, provider)
  if (!deleted) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'No key stored for this provider'),
    })
  }

  return createSuccessResponse({ provider })
})
