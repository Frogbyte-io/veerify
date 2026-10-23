// Imported explicitly rather than relying on Nuxt's auto-import, so this module
// can be unit tested outside the Nitro runtime.
import { createError } from 'h3'
import { isModuleEnabled } from '~/lib/modules'
import { requireProjectRole } from './project-access'
import { createErrorResponse, ErrorCode } from './response'

function forbidden(message: string): never {
  throw createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    data: createErrorResponse(ErrorCode.FORBIDDEN, message),
  })
}

/**
 * Authorizes a marketing endpoint for a project.
 *
 * Verifies project access (404 unknown project, 403 no access), then that the
 * Marketing tool is switched on for the project (`project.settings.marketingEnabled`,
 * default off). Any project member passes; `organizationId` is where keys, budgets,
 * usage, suppression and consent live.
 */
export async function requireMarketingAccess(projectId: string, userId: string) {
  const { project, role } = await requireProjectRole(projectId, userId)

  if (!isModuleEnabled(project.settings as Record<string, unknown> | null, 'marketingEnabled')) {
    forbidden('Marketing is not enabled for this project')
  }

  return { project, organizationId: project.organizationId, role }
}

/** Marketing access plus project admin, for managing site settings, terms and review settings. */
export async function requireMarketingAdmin(projectId: string, userId: string) {
  const access = await requireMarketingAccess(projectId, userId)
  if (access.role !== 'admin') forbidden('Only project admins can manage Marketing settings')
  return access
}

/**
 * Project admin, whether or not Marketing is currently switched on. Exporting or deleting a
 * project's Marketing data must stay possible after the tool is turned off, because switching
 * it off hides the data but does not remove it.
 */
export async function requireMarketingDataAdmin(projectId: string, userId: string) {
  const { project, role } = await requireProjectRole(projectId, userId)
  if (role !== 'admin') forbidden('Only project admins can export or delete Marketing data')
  return { project, organizationId: project.organizationId, role }
}
