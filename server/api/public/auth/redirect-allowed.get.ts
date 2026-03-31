import { z } from 'zod'
import { createSuccessResponse } from '~/server/utils/response'
import { resolveAllowedPublicRedirectTarget } from '~/server/utils/public-auth-redirect'
import { validateQuery } from '~/server/utils/validation'

const querySchema = z.object({
  target: z.string().trim().min(1).max(3000),
})

function denied() {
  return createSuccessResponse({
    allowed: false,
    target: null,
  })
}

export default defineEventHandler(async (event) => {
  const query = validateQuery(event, querySchema)
  const redirectTarget = await resolveAllowedPublicRedirectTarget(event, query.target)
  if (!redirectTarget) {
    return denied()
  }

  return createSuccessResponse({
    allowed: true,
    target: redirectTarget.toString(),
  })
})
