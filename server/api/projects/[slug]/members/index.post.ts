import { z } from 'zod'
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { requireAssignableUser, upsertProjectMember } from '~/server/utils/project-members'
import { listProjectMembers } from '~/server/utils/project-summary'
import { createSuccessResponse } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'

const addMemberSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  role: z.enum(['admin', 'member']).default('member'),
})

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  const body = await validateBody(event, addMemberSchema)

  await requireAssignableUser(project, body.userId)
  await upsertProjectMember(project.id, body.userId, body.role)

  const entry = (await listProjectMembers(project)).find((m) => m.userId === body.userId)
  setResponseStatus(event, 201)
  return createSuccessResponse(entry ?? null)
})
