import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import { marketingSite, seoAudit } from '~/server/database/schema/marketing'
import { createErrorResponse, ErrorCode } from './response'
import { requireMarketingAccess } from './marketing-access'

function notFound(message: string): never {
  throw createError({
    statusCode: 404,
    statusMessage: 'Not Found',
    data: createErrorResponse(ErrorCode.NOT_FOUND, message),
  })
}

/** The product's marketing site, or null when none has been added yet. */
export async function findSiteForProject(projectId: string) {
  const [site] = await db.select().from(marketingSite).where(eq(marketingSite.projectId, projectId)).limit(1)
  return site ?? null
}

/**
 * Marketing access for the product, plus proof that the audit belongs to that
 * product's site. An audit id from another product or team reads as 404, so
 * ids cannot be probed across tenants.
 */
export async function requireAuditAccess(projectId: string, auditId: string, userId: string) {
  const access = await requireMarketingAccess(projectId, userId)
  const site = await findSiteForProject(projectId)
  if (!site) notFound('Audit not found')

  const [audit] = await db
    .select()
    .from(seoAudit)
    .where(and(eq(seoAudit.id, auditId), eq(seoAudit.siteId, site.id)))
    .limit(1)
  if (!audit) notFound('Audit not found')

  return { ...access, site, audit }
}
