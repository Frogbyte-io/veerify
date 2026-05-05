import { requireAuth } from '~/server/utils/auth-middleware'
import { getDashboardBootstrapData } from '~/server/utils/dashboard-bootstrap'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const bootstrap = await getDashboardBootstrapData(session)

  return createSuccessResponse(bootstrap)
})
