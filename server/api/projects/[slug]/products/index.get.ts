import { listProducts } from '~/server/utils/project-access'
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { toProductSummary } from '~/server/utils/project-summary'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '')
  const products = await listProducts(project.id)
  return createSuccessResponse(products.map(toProductSummary))
})
