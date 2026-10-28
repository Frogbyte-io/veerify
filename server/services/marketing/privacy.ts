import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import {
  launchKitItem,
  marketingAnnouncementDraft,
  type EmailSuppressionReason,
  marketingEmailSuppression,
  marketingSite,
  reviewRequest,
  testimonial,
} from '~/server/database/schema/marketing'
import { eraseImportedPeople } from '~/server/services/imports/claim'
import { revokeToken } from '~/server/services/google/search-console'
import { findGscConnection, gscAad, removeGscConnection } from '~/server/services/marketing/search/connection'
import { hashEmail, hashEmailCandidates, normalizeMarketingEmail } from '~/server/utils/marketing-email-hash'
import { decryptSecret } from '~/server/utils/secrets'

export interface EraseContactResult {
  reviewRequestsDeleted: number
  testimonialsDeleted: number
  importedPeople: number
  suppressed: true
}

export function normalizeEmail(email: string): string {
  return normalizeMarketingEmail(email)
}

type SuppressionExecutor = Pick<typeof db, 'insert' | 'update'>

/**
 * Writes a durable per-workspace suppression carrying the keyed hash, and the address when it is still known.
 * With only a hash (the row was anonymised) the `email` key is `hash:<hash>`: the address is gone, and the
 * send-time checks match by hash. An older suppression that has the address but no hash is given its hash.
 */
export async function writeSuppression(
  executor: SuppressionExecutor,
  input: { organizationId: string; email: string | null; emailHash: string; reason?: EmailSuppressionReason }
): Promise<void> {
  const email = input.email ?? `hash:${input.emailHash}`
  await executor
    .insert(marketingEmailSuppression)
    .values({
      organizationId: input.organizationId,
      email,
      emailHash: input.emailHash,
      reason: input.reason ?? 'unsubscribed',
    })
    .onConflictDoNothing()
  if (input.email) {
    await executor
      .update(marketingEmailSuppression)
      .set({ emailHash: input.emailHash })
      .where(
        and(
          eq(marketingEmailSuppression.organizationId, input.organizationId),
          eq(marketingEmailSuppression.email, input.email),
          isNull(marketingEmailSuppression.emailHash),
          sql`not exists (select 1 from marketing_email_suppression s where s.organization_id = ${input.organizationId} and s.email_hash = ${input.emailHash})`
        )
      )
  }
}

/**
 * Erases one person's Marketing data across a workspace: every review request and testimonial for the
 * address in the workspace's projects, matched case-insensitively by address OR by keyed hash (rows the
 * retention task anonymised only have the hash). A suppression (address and hash) is kept or created so
 * the person is never contacted again; it is the only trace left, as the durable opt-out record.
 *
 * Testimonials are matched by their own `authorEmail` / `authorEmailHash` and by the review request they
 * came from. They are deleted first, so no review request is left referenced and every match is deleted.
 * A request already claimed by the sender is deleted too; the sender re-checks right before mailing.
 */
export async function eraseContact(organizationId: string, rawEmail: string): Promise<EraseContactResult> {
  const email = normalizeEmail(rawEmail)
  const emailHash = hashEmail(email)
  const emailHashes = hashEmailCandidates(email)

  return db.transaction(async (tx) => {
    const orgProjects = tx.select({ id: project.id }).from(project).where(eq(project.organizationId, organizationId))
    const matchesRequest = and(
      sql`${reviewRequest.projectId} in (${orgProjects})`,
      or(sql`lower(${reviewRequest.email}) = ${email}`, inArray(reviewRequest.emailHash, emailHashes))
    )
    const requests = await tx.select({ id: reviewRequest.id }).from(reviewRequest).where(matchesRequest)
    const requestIds = requests.map((row) => row.id)

    const byAuthor = or(
      sql`lower(${testimonial.authorEmail}) = ${email}`,
      inArray(testimonial.authorEmailHash, emailHashes)
    )
    const matchesPerson = requestIds.length ? or(byAuthor, inArray(testimonial.reviewRequestId, requestIds)) : byAuthor
    const removedTestimonials = await tx
      .delete(testimonial)
      .where(and(sql`${testimonial.projectId} in (${orgProjects})`, matchesPerson))
      .returning({ id: testimonial.id })

    const removedRequests = await tx.delete(reviewRequest).where(matchesRequest).returning({ id: reviewRequest.id })

    const importedPeople = await eraseImportedPeople(organizationId, email, tx)

    await writeSuppression(tx, { organizationId, email, emailHash })

    return {
      reviewRequestsDeleted: removedRequests.length,
      testimonialsDeleted: removedTestimonials.length,
      importedPeople,
      suppressed: true as const,
    }
  })
}

/**
 * The submitter takes their testimonial off the public page: consent off and un-featured.
 * Returns how many testimonials were changed (0 when none was submitted with this request).
 */
export async function withdrawTestimonialConsent(reviewRequestId: string): Promise<number> {
  const now = new Date()
  const rows = await db
    .update(testimonial)
    .set({ consentPublic: false, featured: false, withdrawnAt: now, updatedAt: now })
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
