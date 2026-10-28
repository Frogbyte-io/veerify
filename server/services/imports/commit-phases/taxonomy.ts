import { and, eq, inArray } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { feedbackCategory } from '~/server/database/schema/feedback'
import type { CommitContext, CommitPhase } from './context'

/**
 * Taxonomy is resolved with apply:true before the phases run (see committer.ts), because the feedback phase needs
 * the mapping on every call. This phase only records what that resolution created, mirroring the preview's counts.
 */
export const taxonomyPhase: CommitPhase<void, 'taxonomy'> = {
  name: 'taxonomy',
  items: () => ['taxonomy'],
  load: async () => undefined,
  async apply(ctx: CommitContext) {
    const taxonomy = ctx.taxonomy!
    for (const issue of taxonomy.issues) ctx.issue(issue)

    const createdValues = new Set(taxonomy.toCreate.statuses.map((s) => s.value))
    ctx.counts.statuses.create += taxonomy.toCreate.statuses.length
    for (const s of ctx.batch.statuses) {
      const value = taxonomy.statusValueByExternalId.get(s.externalId)
      if (value === undefined) ctx.counts.statuses.skip++
      else if (!createdValues.has(value)) ctx.counts.statuses.unchanged++
    }

    const createdSlugs = taxonomy.toCreate.categories.map((c) => c.slug)
    const createdIds = new Set(
      createdSlugs.length
        ? (
            await db
              .select({ id: feedbackCategory.id })
              .from(feedbackCategory)
              .where(
                and(eq(feedbackCategory.projectId, ctx.run.projectId), inArray(feedbackCategory.slug, createdSlugs))
              )
          ).map((c) => c.id)
        : []
    )
    ctx.counts.categories.create += taxonomy.toCreate.categories.length
    for (const c of ctx.batch.categories) {
      const id = taxonomy.categoryIdByExternalId.get(c.externalId)
      if (!id) ctx.counts.categories.skip++
      else if (!createdIds.has(id)) ctx.counts.categories.unchanged++
    }
  },
}
