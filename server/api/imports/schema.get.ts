/**
 * @openapi
 * /api/imports/schema:
 *   get:
 *     tags: [Imports]
 *     summary: Get the veerify-import/1 JSON Schema
 *     description: "Returns the import format identifier, its JSON Schema and a small valid example document."
 *     operationId: getImportSchema
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     responses:
 *       200: { description: "Format identifier, JSON Schema and example" }
 *       401: { description: "Not authenticated" }
 */
import { requireAuth } from '~/server/utils/auth-middleware'
import { createSuccessResponse } from '~/server/utils/response'
import { IMPORT_FORMAT, importExample, importJsonSchema } from '~/server/services/imports/format'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  return createSuccessResponse({
    format: IMPORT_FORMAT,
    schema: importJsonSchema(),
    example: importExample(),
  })
})
