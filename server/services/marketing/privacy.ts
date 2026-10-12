import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import {
  launchKitItem,
  marketingAnnouncementDraft,
  marketingEmailSuppression,
  marketingSite,
  reviewRequest,
  testimonial,
} from '~/server/database/schema/marketing'
import { revokeToken } from '~/server/services/google/search-console'
import { findGscConnection, gscAad, removeGscConnection } from '~/server/services/marketing/search/connection'
import { decryptSecret } from '~/server/utils/secrets'

export interface EraseContactResult {
  reviewRequestsDeleted: number
  testimonialsDeleted: number
  suppressed: true
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Erases one person's Marketing data across a team: every review request and testimonial for the
 * address (case-insensitive) in the team's products. A suppression is kept (or created) so the
 * address is never contacted again; it is the only trace left, as the durable opt-out record.
 *
 * Testimonials are matched by their own `authorEmail` and by the review request they came from
 * (the email may already have been cleared by the retention prune).
 */
export async function eraseContact(teamId: string, rawEmail: string): Promise<EraseContactResult> {
  const email = normalizeEmail(rawEmail)

  return db.transaction(async (tx) => {
    const teamProjects = tx.select({ id: project.id }).from(project).where(eq(project.teamId, teamId))
    const requests = await tx
      .select({ id: reviewRequest.id })
      .from(reviewRequest)
      .where(and(eq(reviewRequest.teamId, teamId), sql`lower(${reviewRequest.email}) = ${email}`))
    const requestIds = requests.map((row) => row.id)

    const matchesPerson = requestIds.length
      ? sql`(lower(${testimonial.authorEmail}) = ${email} or ${inArray(testimonial.reviewRequestId, requestIds)})`
      : sql`lower(${testimonial.authorEmail}) = ${email}`
    const removedTestimonials = await tx
      .delete(testimonial)
      .where(and(sql`${testimonial.projectId} in (${teamProjects})`, matchesPerson))
      .returning({ id: testimonial.id })

    const removedRequests = await tx
      .delete(reviewRequest)
      .where(and(eq(reviewRequest.teamId, teamId), sql`lower(${reviewRequest.email}) = ${email}`))
      .returning({ id: reviewRequest.id })

    await tx.insert(marketingEmailSuppression).values({ teamId, email, reason: 'unsubscribed' }).onConflictDoNothing()

    return {
      reviewRequestsDeleted: removedRequests.length,
      testimonialsDeleted: removedTestimonials.length,
      suppressed: true as const,
    }
  })
}

/**
 * The submitter takes their testimonial off the public page: consent off and un-featured.
 * Returns how many testimonials were changed (0 when none was submitted with this request).
 */
export async function withdrawTestimonialConsent(reviewRequestId: string): Promise<number> {
  const rows = await db
    .update(testimonial)
    .set({ consentPublic: false, featured: false, updatedAt: new Date() })
    .where(eq(testimonial.reviewRequestId, reviewRequestId))
    .returning({ id: testimonial.id })
  return rows.length
}

export interface DeleteProductDataResult {
  siteDeleted: boolean
  reviewRequestsDeleted: number
  testimonialsDeleted: number
  launchKitItemsDeleted: number
  announcementDraftsDeleted: number
  searchConsoleRevoked: boolean
}

/**
 * Deletes a product's Marketing data: the site (and everything hanging off it by cascade: terms, audits,
 * visibility, mentions, competitors, insights, Search Console), plus review requests, testimonials,
 * launch kit items and announcement drafts. A Search Console connection is revoked at Google first
 * (best effort) so the stored refresh token is not left valid.
 */
export async function deleteProductMarketingData(projectId: string): Promise<DeleteProductDataResult> {
  const [site] = await db
    .select({ id: marketingSite.id })
    .from(marketingSite)
    .where(eq(marketingSite.projectId, projectId))
    .limit(1)

  let searchConsoleRevoked = false
  if (site) {
    const connection = await findGscConnection(site.id)
    if (connection) {
      try {
        await revokeToken(decryptSecret(connection.encryptedRefreshToken, gscAad(site.id)))
        searchConsoleRevoked = true
      } catch {
        // Best effort: an undecryptable or already revoked token must not block the deletion.
      }
      await removeGscConnection(site.id)
    }
  }

  return db.transaction(async (tx) => {
    const siteRows = await tx
      .delete(marketingSite)
      .where(eq(marketingSite.projectId, projectId))
      .returning({ id: marketingSite.id })
    // Testimonials first: they reference review requests
    const testimonials = await tx
      .delete(testimonial)
      .where(eq(testimonial.projectId, projectId))
      .returning({ id: testimonial.id })
    const requests = await tx
      .delete(reviewRequest)
      .where(eq(reviewRequest.projectId, projectId))
      .returning({ id: reviewRequest.id })
    const kit = await tx
      .delete(launchKitItem)
      .where(eq(launchKitItem.projectId, projectId))
      .returning({ id: launchKitItem.id })
    const drafts = await tx
      .delete(marketingAnnouncementDraft)
      .where(eq(marketingAnnouncementDraft.projectId, projectId))
      .returning({ id: marketingAnnouncementDraft.id })

    return {
      siteDeleted: siteRows.length > 0,
      reviewRequestsDeleted: requests.length,
      testimonialsDeleted: testimonials.length,
      launchKitItemsDeleted: kit.length,
      announcementDraftsDeleted: drafts.length,
      searchConsoleRevoked,
    }
  })
}
