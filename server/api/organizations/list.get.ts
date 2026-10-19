import { requireAuth } from '~/server/utils/auth-middleware'
import { listOrganizationsForUser } from '~/server/utils/dashboard-bootstrap'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  return createSuccessResponse(await listOrganizationsForUser(session.user.id))
})
