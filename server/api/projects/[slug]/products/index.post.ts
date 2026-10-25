import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { sql, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { product } from '~/server/database/schema/feedback'
import { resolveProductSlug } from '~/server/utils/product-rules'
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { toProductSummary } from '~/server/utils/project-summary'
import { createSuccessResponse } from '~/server/utils/response'
import { commonSchemas, validateBody } from '~/server/utils/validation'

const createProductSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required').max(100, 'Product name too long'),
  slug: commonSchemas.slug.optional(),
  description: z.string().max(1000, 'Description too long').optional().nullable(),
  isPublic: z.boolean().optional().default(true),
})

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  const body = await validateBody(event, createProductSchema)
  const slug = await resolveProductSlug(project.id, { name: body.name, slug: body.slug })

  const [{ next } = { next: 0 }] = await db
    .select({ next: sql<number>`coalesce(max(${product.sortOrder}) + 1, 0)::int` })
    .from(product)
    .where(eq(product.projectId, project.id))

  const now = new Date()
  const [created] = await db
    .insert(product)
    .values({
      id: randomUUID(),
      projectId: project.id,
      name: body.name,
      slug,
      description: body.description || null,
      isPublic: body.isPublic,
      sortOrder: next,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  setResponseStatus(event, 201)
  return createSuccessResponse(toProductSummary(created!))
})
