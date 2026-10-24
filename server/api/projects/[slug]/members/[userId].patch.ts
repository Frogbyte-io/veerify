import { z } from 'zod'
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { requireAssignableUser, upsertProjectMember } from '~/server/utils/project-members'
import { listProjectMembers } from '~/server/utils/project-summary'
import { createSuccessResponse } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'

const updateMemberSchema = z.object({
  role: z.enum(['admin', 'member']),
})

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  const userId = getRouterParam(event, 'userId') ?? ''
  const body = await validateBody(event, updateMemberSchema)

  await requireAssignableUser(project, userId)
  await upsertProjectMember(project.id, userId, body.role)

  const entry = (await listProjectMembers(project)).find((m) => m.userId === userId)
  return createSuccessResponse(entry ?? null)
})
