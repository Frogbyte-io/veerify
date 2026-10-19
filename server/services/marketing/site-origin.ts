import { eq, inArray } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { competitorWatch, seoAudit } from '~/server/database/schema/marketing'
import {
  findGscConnection,
  removeGscConnection,
  revokeStoredToken,
} from '~/server/services/marketing/search/connection'

/**
 * Data that belongs to a site origin, removed when the origin changes:
 *  - the Search Console connection (token revoked best effort) and its metrics, because the
 *    property is tied to the old origin;
 *  - SEO audits (pages, issues and file checks cascade), which describe the old origin;
 *  - competitor watches whose URL is on the old origin's host (watching your own old site).
 * Kept, because they are brand-level rather than origin-level: terms, AI visibility prompts and
 * runs, and mentions.
 */
export async function resetOriginScopedData(siteId: string, oldOrigin: string): Promise<void> {
  const conn = await findGscConnection(siteId)
  if (conn) {
    // Best effort: revoking must never block the origin change
    await revokeStoredToken(conn.encryptedRefreshToken, siteId)
    await removeGscConnection(siteId)
  }

  await db.delete(seoAudit).where(eq(seoAudit.siteId, siteId))

  let oldHost: string | null = null
  try {
    oldHost = new URL(oldOrigin).hostname.toLowerCase()
  } catch {
    oldHost = null
  }
  if (!oldHost) return
  const watches = await db
    .select({ id: competitorWatch.id, url: competitorWatch.url })
    .from(competitorWatch)
    .where(eq(competitorWatch.siteId, siteId))
  const own = watches
    .filter((watch) => {
      try {
        return new URL(watch.url).hostname.toLowerCase() === oldHost
      } catch {
        return false
      }
    })
    .map((watch) => watch.id)
  if (own.length > 0) await db.delete(competitorWatch).where(inArray(competitorWatch.id, own))
}
