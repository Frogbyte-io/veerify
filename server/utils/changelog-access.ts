// Imported explicitly rather than relying on Nuxt's auto-import, so this module
// can be unit tested outside the Nitro runtime.
import { createError } from 'h3'
import { isModuleEnabled } from '~/lib/modules'
import { requireProjectAccess } from './project-access'
import { createErrorResponse, ErrorCode } from './response'

function forbidden(message: string): never {
  throw createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    data: createErrorResponse(ErrorCode.FORBIDDEN, message),
  })
}

/**
 * Authorizes a changelog endpoint for a project.
 *
 * Verifies project access (404 unknown project, 403 no access), then that the
 * Changelog tool is switched on in `project.settings` (default: off).
 */
export async function requireChangelogAccess(projectId: string, userId: string) {
  const project = await requireProjectAccess(projectId, userId)

  if (!isModuleEnabled(project.settings as Record<string, unknown> | null, 'changelogEnabled')) {
    forbidden('Changelog is not enabled for this project')
  }

  return { project }
}
