/**
 * @openapi
 * /api/support/projects/{projectId}/forms:
 *   post:
 *     tags: [Support]
 *     summary: Create a website form
 *     description: >
 *       A form files each submission into its inbox as a new conversation from
 *       the submitter, like an inbound email. Sites submit with a project server
 *       key (`POST /api/v1/forms/{slug}/submissions`) or, when browser
 *       submissions are on, from an allowed origin with the form's public id.
 *       See docs/forms-api.md. Project admins only.
 *     operationId: createSupportForm
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, slug, inboxId, fields, fieldMapping]
 *             properties:
 *               name: { type: string, maxLength: 80 }
 *               slug: { type: string, maxLength: 60, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }
 *               inboxId: { type: string }
 *               fields:
 *                 type: array
 *                 maxItems: 30
 *                 items:
 *                   type: object
 *                   required: [key, label, type]
 *                   properties:
 *                     key: { type: string, maxLength: 40, pattern: '^[a-z0-9][a-z0-9_-]*$' }
 *                     label: { type: string, maxLength: 120 }
 *                     type: { type: string, enum: [text, email, textarea, select, checkbox] }
 *                     required: { type: boolean }
 *                     options:
 *                       type: array
 *                       maxItems: 50
 *                       items:
 *                         type: object
 *                         required: [value, label]
 *                         properties:
 *                           value: { type: string, maxLength: 120 }
 *                           label: { type: string, maxLength: 120 }
 *               fieldMapping:
 *                 type: object
 *                 required: [email]
 *                 properties:
 *                   email: { type: string, description: Key of a required email field }
 *                   name: { type: string, nullable: true, description: Key of a text field }
 *                   subject: { type: string, nullable: true, description: Key of a text or select field }
 *               autoReplyMode: { type: string, enum: [inbox, custom, off], default: inbox }
 *               autoReplyTemplate: { type: string, nullable: true, maxLength: 5000 }
 *               allowedOrigins: { type: array, maxItems: 20, items: { type: string, maxLength: 300 }, description: 'e.g. https://shop.example.com or https://*.example.com' }
 *               browserSubmissionsEnabled: { type: boolean, default: false }
 *               isEnabled: { type: boolean, default: true }
 *     responses:
 *       201: { description: Form created }
 *       400: { description: Validation failed }
 *       403: { description: Not a project admin }
 *       409: { description: Slug already used in this project }
 */
import { randomUUID } from 'node:crypto'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireProjectAdmin } from '~/server/utils/project-access'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { supportForm } from '~/server/database/schema/support'
import { formDefinitionSchema, generateFormPublicId } from '~/server/services/support-forms/definition'
import { requireInboxInProject, rethrowSlugConflict, serializeForm } from '~/server/services/support-forms/admin'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId') as string
  await requireProjectAdmin(projectId, session.user.id)

  const body = await validateBody(event, formDefinitionSchema)
  await requireInboxInProject(projectId, body.inboxId)

  const now = new Date()
  const [created] = await db
    .insert(supportForm)
    .values({
      id: randomUUID(),
      projectId,
      publicId: generateFormPublicId(),
      ...body,
      createdByUserId: session.user.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .catch(rethrowSlugConflict)

  setResponseStatus(event, 201)
  return createSuccessResponse({ form: serializeForm(created) })
})
