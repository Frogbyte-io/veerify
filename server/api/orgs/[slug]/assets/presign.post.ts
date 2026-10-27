/**
 * @openapi
 * /api/orgs/{slug}/assets/presign:
 *   post:
 *     tags: [Organizations]
 *     summary: Presign organization logo upload
 *     description: >
 *       Creates a short-lived upload target for an organization logo. Upload the file to `uploadUrl` with the returned method and headers, then pass `uploadId` as `logoUploadId` to PUT /api/orgs/{slug}. Owners and admins only. Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: presignOrganizationAsset
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         description: "Organization (workspace) slug"
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [kind, filename, contentType, sizeBytes]
 *             properties:
 *               kind: { type: string, enum: [logo] }
 *               filename: { type: string, minLength: 1, maxLength: 255 }
 *               contentType: { type: string, minLength: 1, maxLength: 100, description: "Image MIME type; validated with sizeBytes against the logo limits" }
 *               sizeBytes: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: "{ uploadId, uploadUrl, method, headers, expiresAt }" }
 *       400: { description: "Validation failed or unsupported image type or size" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Caller is not an owner or admin" }
 *       404: { description: "Organization not found" }
 *       429: { description: "Rate limit exceeded" }
 */
import { z } from 'zod'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireRateLimit, rateLimits } from '~/server/utils/rate-limit'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireOrganizationRoleBySlug } from '~/server/utils/organization-access'
import { validateBody } from '~/server/utils/validation'
import { getStorageProvider } from '~/server/utils/storage'
import {
  buildTempObjectKey,
  TEMP_UPLOAD_EXPIRES_SECONDS,
  validateImageUploadInput,
  type UploadAssetKind,
} from '~/server/utils/storage/media'
import { createUploadToken } from '~/server/utils/upload-token'

const presignSchema = z.object({
  kind: z.enum(['logo']),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  await requireRateLimit(event, rateLimits.standard)

  const slug = getRouterParam(event, 'slug')
  if (!slug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Organization slug is required'),
    })
  }

  const { org } = await requireOrganizationRoleBySlug(session, slug, ['owner', 'admin'])
  const body = await validateBody(event, presignSchema)
  const kind = body.kind as UploadAssetKind
  const normalizedContentType = body.contentType.trim().toLowerCase()
  validateImageUploadInput(kind, normalizedContentType, body.sizeBytes)

  const tempKey = buildTempObjectKey(org.id, kind, body.filename)
  const { token: uploadId, expiresAt } = createUploadToken(
    {
      projectId: org.id,
      userId: session.user.id,
      kind,
      tempKey,
      contentType: normalizedContentType,
    },
    TEMP_UPLOAD_EXPIRES_SECONDS
  )

  const storage = getStorageProvider()
  const presignedTarget =
    storage.driver === 'local'
      ? await storage.getPresignedUploadTarget(uploadId, normalizedContentType, TEMP_UPLOAD_EXPIRES_SECONDS)
      : await storage.getPresignedUploadTarget(tempKey, normalizedContentType, TEMP_UPLOAD_EXPIRES_SECONDS, {
          expectedSizeBytes: body.sizeBytes,
        })

  return createSuccessResponse({
    uploadId,
    uploadUrl: presignedTarget.uploadUrl,
    method: presignedTarget.method,
    headers: presignedTarget.headers,
    expiresAt,
  })
})
