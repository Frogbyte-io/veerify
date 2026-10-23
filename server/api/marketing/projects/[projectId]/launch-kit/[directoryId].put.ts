/**
 * @openapi
 * /api/marketing/projects/{projectId}/launch-kit/{directoryId}:
 *   put:
 *     tags: [Marketing]
 *     summary: Set the status, listing URL and notes of a launch kit directory
 *     description: >
 *       Upserts the product's item for a catalog directory, or updates an existing
 *       custom directory (`custom:<id>`). `submittedAt` and `liveAt` are set the first
 *       time the status becomes submitted or live. Omitting `url` or `notes` keeps
 *       the current value; null or an empty string clears it.
 *     operationId: updateMarketingLaunchKitItem
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: directoryId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [todo, in_progress, submitted, live, rejected, skipped] }
 *               url: { type: string, nullable: true, maxLength: 500, description: https URL }
 *               notes: { type: string, nullable: true, maxLength: 1000 }
 *     responses:
 *       200: { description: Item saved }
 *       400: { description: Validation failed }
 *       403: { description: Not a team member, or Marketing is off }
 *       404: { description: Unknown directory }
 */
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { launchKitItem } from '~/server/database/schema/marketing'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { createSuccessResponse } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { requireRouteParam } from '~/server/utils/marketing-site'
import {
  findItem,
  getLaunchDirectory,
  isCustomId,
  launchKitNotFound,
  serializeCustomItem,
  updateItemSchema,
} from '~/server/utils/marketing-launch-kit'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouteParam(event, 'projectId')
  const directoryId = requireRouteParam(event, 'directoryId')
  await requireMarketingAccess(projectId, session.user.id)
  const body = await validateBody(event, updateItemSchema)

  const custom = isCustomId(directoryId)
  if (!custom && !getLaunchDirectory(directoryId)) launchKitNotFound()

  // Custom ids are scoped to the project, so another product's id is a 404 here
  const current = await findItem(projectId, directoryId)
  if (custom && !current) launchKitNotFound()

  const now = new Date()
  const fields = {
    status: body.status,
    url: body.url === undefined ? (current?.url ?? null) : body.url,
    notes: body.notes === undefined ? (current?.notes ?? null) : body.notes,
    submittedAt: current?.submittedAt ?? (body.status === 'submitted' ? now : null),
    liveAt: current?.liveAt ?? (body.status === 'live' ? now : null),
    updatedByUserId: session.user.id,
    updatedAt: now,
  }

  let row
  if (current) {
    ;[row] = await db
      .update(launchKitItem)
      .set(fields)
      .where(and(eq(launchKitItem.id, current.id), eq(launchKitItem.projectId, projectId)))
      .returning()
  } else {
    ;[row] = await db
      .insert(launchKitItem)
      .values({ id: randomUUID(), projectId, directoryId, createdAt: now, ...fields })
      .onConflictDoUpdate({
        target: [launchKitItem.projectId, launchKitItem.directoryId],
        set: fields,
      })
      .returning()
  }

  return createSuccessResponse({
    item: custom
      ? serializeCustomItem(row)
      : {
          id: directoryId,
          custom: false,
          status: row.status,
          url: row.url,
          notes: row.notes,
          submittedAt: row.submittedAt,
          liveAt: row.liveAt,
        },
  })
})
