/**
 * Shared pieces of the admin form routes (`/api/support/projects/{projectId}/forms`).
 */
import { createError } from 'h3'
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { supportForm, supportInbox } from '~/server/database/schema/support'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { isUniqueViolation } from '~/server/utils/support-errors'
import type { SupportFormRow } from './submit'

/** What the admin API returns for a form. */
export function serializeForm(row: SupportFormRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    inboxId: row.inboxId,
    name: row.name,
    slug: row.slug,
    publicId: row.publicId,
    fields: row.fields,
    fieldMapping: row.fieldMapping,
    autoReplyMode: row.autoReplyMode,
    autoReplyTemplate: row.autoReplyTemplate,
    allowedOrigins: row.allowedOrigins,
    browserSubmissionsEnabled: row.browserSubmissionsEnabled,
    isEnabled: row.isEnabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function requireInboxInProject(projectId: string, inboxId: string): Promise<void> {
  const [inbox] = await db
    .select({ id: supportInbox.id })
    .from(supportInbox)
    .where(and(eq(supportInbox.id, inboxId), eq(supportInbox.projectId, projectId)))
    .limit(1)
  if (!inbox) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Validation failed',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'That inbox does not belong to this project'),
    })
  }
}

export async function requireFormInProject(projectId: string, formId: string): Promise<SupportFormRow> {
  const [row] = await db
    .select()
    .from(supportForm)
    .where(and(eq(supportForm.id, formId), eq(supportForm.projectId, projectId)))
    .limit(1)
  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Form not found'),
    })
  }
  return row
}

export function rethrowSlugConflict(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(ErrorCode.CONFLICT, 'Another form in this project already uses that slug'),
    })
  }
  throw error
}
