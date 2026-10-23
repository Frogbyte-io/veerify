import { and, count, eq, inArray, ne } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { feedback, product } from '~/server/database/schema/feedback'
import { changelogEntryProduct } from '~/server/database/schema/changelog'
import { listProducts, requireProductInProject } from '~/server/utils/project-access'
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'

function conflict(message: string): never {
  throw createError({
    statusCode: 409,
    statusMessage: 'Conflict',
    data: createErrorResponse(ErrorCode.CONFLICT, message),
  })
}

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  const target = await requireProductInProject(project.id, getRouterParam(event, 'productId'))

  const moveToParam = getQuery(event).moveTo
  const moveToId = typeof moveToParam === 'string' && moveToParam ? moveToParam : null

  const products = await listProducts(project.id)
  if (products.length <= 1) conflict('A project needs at least one product')

  if (moveToId === target.id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'moveTo must be a different product'),
    })
  }
  const destination = moveToId ? await requireProductInProject(project.id, moveToId) : null

  const [feedbackCount] = await db.select({ count: count() }).from(feedback).where(eq(feedback.productId, target.id))
  const hasFeedback = (feedbackCount?.count ?? 0) > 0
  if (hasFeedback && !destination) {
    conflict('This product has feedback. Choose another product to move it to (moveTo).')
  }

  let movedFeedback = 0
  await db.transaction(async (tx) => {
    // Changelog entries scoped only to this product would silently become project-wide (and
    // possibly public) once the tag cascades away, so re-tag them onto the remaining product.
    const tagged = await tx
      .select({ entryId: changelogEntryProduct.entryId })
      .from(changelogEntryProduct)
      .where(eq(changelogEntryProduct.productId, target.id))
    const entryIds = tagged.map((row) => row.entryId)
    const retagTarget = destination ?? products.find((p) => p.id !== target.id)!
    if (entryIds.length > 0) {
      const withOtherTags = await tx
        .select({ entryId: changelogEntryProduct.entryId })
        .from(changelogEntryProduct)
        .where(and(inArray(changelogEntryProduct.entryId, entryIds), ne(changelogEntryProduct.productId, target.id)))
      const hasOther = new Set(withOtherTags.map((row) => row.entryId))
      const toRetag = destination ? entryIds : entryIds.filter((id) => !hasOther.has(id))
      if (toRetag.length > 0) {
        await tx
          .insert(changelogEntryProduct)
          .values(toRetag.map((entryId) => ({ entryId, productId: retagTarget.id })))
          .onConflictDoNothing()
      }
    }

    if (destination && hasFeedback) {
      const moved = await tx
        .update(feedback)
        .set({ productId: destination.id })
        .where(eq(feedback.productId, target.id))
        .returning({ id: feedback.id })
      movedFeedback = moved.length
    }

    await tx.delete(product).where(eq(product.id, target.id))
  })

  return createSuccessResponse({ id: target.id, deleted: true, movedFeedback })
})
