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
  const { project, session } = await requireProjectCategoryAccess(event)
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
      : await storage.getPresignedUploadTarget(tempKey, normalizedContentType, TEMP_UPLOAD_EXPIRES_SECONDS)

  return createSuccessResponse({
    uploadId,
    uploadUrl: presignedTarget.uploadUrl,
    method: presignedTarget.method,
    headers: presignedTarget.headers,
    expiresAt,
  })
})
