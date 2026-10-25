import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { product } from '~/server/database/schema/feedback'
import { resolveProductSlug } from '~/server/utils/product-rules'
import { requireProductInProject } from '~/server/utils/project-access'
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { toProductSummary } from '~/server/utils/project-summary'
import { createSuccessResponse } from '~/server/utils/response'
import { commonSchemas, validateBody } from '~/server/utils/validation'

const updateProductSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required').max(100, 'Product name too long').optional(),
  slug: commonSchemas.slug.optional(),
  description: z.string().max(1000, 'Description too long').nullable().optional(),
  isPublic: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
})

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  const existing = await requireProductInProject(project.id, getRouterParam(event, 'productId'))
  const body = await validateBody(event, updateProductSchema)

  const slug =
    body.slug !== undefined && body.slug !== existing.slug
      ? await resolveProductSlug(project.id, { name: body.name ?? existing.name, slug: body.slug }, existing.id)
      : undefined

  const [updated] = await db
    .update(product)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(slug !== undefined && { slug }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.isPublic !== undefined && { isPublic: body.isPublic }),
      ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
      updatedAt: new Date(),
    })
    .where(eq(product.id, existing.id))
    .returning()

  return createSuccessResponse(toProductSummary(updated!))
})
