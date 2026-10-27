/**
 * @openapi
 * /api/projects/{slug}/assets/presign:
 *   post:
 *     tags: [Projects]
 *     summary: Presign project asset upload
 *     description: >
 *       Creates a short-lived upload target for a project logo or banner. Upload the file to `uploadUrl` with the returned method and headers, then pass `uploadId` as `settings.logoUploadId` or `settings.bannerUploadId` to PUT /api/projects/{slug}. Project admins only (organization owners and admins count as project admins). The project is looked up by slug in the active workspace (override with the `X-Veerify-Organization` header when using an API key). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: presignProjectAsset
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         description: "Project slug"
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [kind, filename, contentType, sizeBytes]
 *             properties:
 *               kind: { type: string, enum: [logo, banner] }
 *               filename: { type: string, minLength: 1, maxLength: 255 }
 *               contentType: { type: string, minLength: 1, maxLength: 100, description: "Image MIME type; validated with sizeBytes against the limits for the kind" }
 *               sizeBytes: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: "{ uploadId, uploadUrl, method, headers, expiresAt }" }
 *       400: { description: "Validation failed or unsupported image type or size" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Caller is not a project admin" }
 *       404: { description: "Project not found in the active workspace" }
 */
import { z } from 'zod'
import { createSuccessResponse } from '~/server/utils/response'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'
import { validateBody } from '~/server/utils/validation'
import {
  buildTempObjectKey,
  TEMP_UPLOAD_EXPIRES_SECONDS,
  validateImageUploadInput,
  type UploadAssetKind,
} from '~/server/utils/storage/media'
import { createUploadToken } from '~/server/utils/upload-token'
import { getStorageProvider } from '~/server/utils/storage'

const presignSchema = z.object({
  kind: z.enum(['logo', 'banner']),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
})

export default defineEventHandler(async (event) => {
  const { project, session } = await requireProjectCategoryAccess(event, { admin: true })
  const body = await validateBody(event, presignSchema)

  const kind = body.kind as UploadAssetKind
  const normalizedContentType = body.contentType.trim().toLowerCase()
  validateImageUploadInput(kind, normalizedContentType, body.sizeBytes)

  const tempKey = buildTempObjectKey(project.id, kind, body.filename)
  const { token: uploadId, expiresAt } = createUploadToken(
    {
      projectId: project.id,
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
