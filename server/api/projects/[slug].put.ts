import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { createSuccessResponse } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'

const projectSettingsSchema = z.object({
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid color').optional(),
  logoUrl: z.string().url().max(500).startsWith('https://').optional().nullable(),
  showPoweredBy: z.boolean().optional(),
}).passthrough().nullable().optional()

const updateProjectSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long').optional(),
  description: z.string().max(1000, 'Description too long').nullable().optional(),
  isPublic: z.boolean().optional(),
  customDomain: z.string()
    .max(253, 'Domain too long')
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/, 'Invalid domain format')
    .nullable()
    .optional(),
  settings: projectSettingsSchema,
})

export default defineEventHandler(async (event) => {
  const { project: currentProject } = await requireProjectCategoryAccess(event)
  const body = await validateBody(event, updateProjectSchema)

  const [updated] = await db
    .update(project)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.isPublic !== undefined && { isPublic: body.isPublic }),
      ...(body.customDomain !== undefined && { customDomain: body.customDomain }),
      ...(body.settings !== undefined && { settings: body.settings }),
      updatedAt: new Date(),
    })
    .where(eq(project.id, currentProject.id))
    .returning()

  return createSuccessResponse(updated)
})
