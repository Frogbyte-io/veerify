import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { db } from '~/server/database/drizzle'
import { marketingSite } from '~/server/database/schema/marketing'
import { isProjectAdmin } from '~/server/utils/project-access'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'

export type MarketingSiteRow = typeof marketingSite.$inferSelect

export const VERIFICATION_FILE_PATH = '/.well-known/veerify-verification.txt'
export const VERIFICATION_META_NAME = 'veerify-site-verification'

export async function findMarketingSite(projectId: string): Promise<MarketingSiteRow | null> {
  const [site] = await db.select().from(marketingSite).where(eq(marketingSite.projectId, projectId)).limit(1)
  return site ?? null
}

/** Never includes the verification token; that is returned separately as instructions. */
export function serializeSite(site: MarketingSiteRow) {
  return {
    id: site.id,
    projectId: site.projectId,
    origin: site.origin,
    verified: site.verifiedAt !== null,
    verifiedAt: site.verifiedAt,
    verificationMethod: site.verificationMethod,
    lastVerificationError: site.lastVerificationError,
  }
}

export function buildVerificationInstructions(site: Pick<MarketingSiteRow, 'origin' | 'verificationToken'>) {
  const host = new URL(site.origin).hostname
  const token = site.verificationToken
  return {
    token,
    dnsRecord: { host: `_veerify.${host}`, type: 'TXT' as const, value: `veerify-site-verification=${token}` },
    metaTag: `<meta name="${VERIFICATION_META_NAME}" content="${token}">`,
    filePath: VERIFICATION_FILE_PATH,
    fileContent: token,
  }
}

export function serializeSiteWithVerification(site: MarketingSiteRow | null, canManage: boolean) {
  return {
    site: site ? serializeSite(site) : null,
    verification: site ? buildVerificationInstructions(site) : null,
    canManage,
  }
}

/** Non-throwing admin check for `canManage` flags on read endpoints. */
export async function isMarketingAdminOf(projectId: string, userId: string): Promise<boolean> {
  return isProjectAdmin(projectId, userId)
}

export function requireRouteParam(event: H3Event, name: string): string {
  const value = getRouterParam(event, name)
  if (!value) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, `${name} is required`),
    })
  }
  return value
}
