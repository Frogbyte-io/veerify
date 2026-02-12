import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { organization } from '~/server/database/schema/auth'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'

export default defineEventHandler(async (event) => {
  const { activeTeam } = await requireAuthWithResolvedTeam(event)

  // Fetch organization details to include slug
  const [org] = await db
    .select()
    .from(organization)
    .where(eq(organization.id, activeTeam.organizationId))
    .limit(1)

  return createSuccessResponse({
    ...activeTeam,
    organization: org || null,
  })
})
