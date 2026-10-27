import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { changelogEntry, changelogEntryFeedback, changelogEntryProduct } from '~/server/database/schema/changelog'
import { product } from '~/server/database/schema/feedback'
import { generateUniqueSlug } from '~/server/services/changelog/slug'
import { isUniqueViolation } from '~/server/utils/support-errors'
import type { ImportChangelog } from '../format'
import { SYNC_FIELDS, changelogIncoming, changelogLinkIssues, deepEqual, planFieldSync, snapshotFor } from '../planner'
import { loadFeedback, type CommitContext, type CommitPhase, type FeedbackRef } from './context'

type ChangelogState = { feedback: Map<string, FeedbackRef>; products: { id: string; slug: string }[] }

const SLUG_ATTEMPTS = 3

/**
 * Changelog entries, inserted directly (not createEntry) so nothing publishes: no publishEntry, no published hooks,
 * no marketing drafts. Feedback/product links are written with the entry (on insert only; a re-import never re-adds
 * a link the team removed).
 */
export const changelogPhase: CommitPhase<ChangelogState, ImportChangelog> = {
  name: 'changelog',
  items: (ctx) => ctx.batch.changelog,
  load: async (ctx) => ({
    feedback: await loadFeedback(ctx),
    products: await db
      .select({ id: product.id, slug: product.slug })
      .from(product)
      .where(eq(product.projectId, ctx.run.projectId)),
  }),
  async apply(ctx, state, rec) {
    const { incoming, issues } = changelogIncoming(rec)
    issues.forEach(ctx.issue)
    changelogLinkIssues(rec, new Set(state.feedback.keys())).forEach(ctx.issue)

    const existing = await findEntry(ctx, rec.externalId)
    let outcome: { result: 'create' | 'update' | 'unchanged'; kept: boolean } | null = null
    if (!existing) outcome = await insertEntry(ctx, state, rec, incoming)
    if (!outcome) outcome = ctx.sync ? await syncEntry(ctx, rec, incoming) : { result: 'unchanged', kept: false }
    ctx.counts.changelog[outcome.result]++
    if (outcome.kept) ctx.kept++
  },
}

async function findEntry(ctx: CommitContext, externalId: string) {
  const [row] = await db
    .select({ id: changelogEntry.id })
    .from(changelogEntry)
    .where(
      and(
        eq(changelogEntry.projectId, ctx.run.projectId),
        eq(changelogEntry.externalSource, ctx.run.source),
        eq(changelogEntry.externalId, externalId)
      )
    )
    .limit(1)
  return row ?? null
}

/** Returns null when another writer created the entry first (then it is synced instead). */
async function insertEntry(
  ctx: CommitContext,
  state: ChangelogState,
  rec: ImportChangelog,
  incoming: Record<string, unknown>
): Promise<{ result: 'create'; kept: false } | null> {
  const { run } = ctx
  const now = ctx.now()
  const status = rec.status ?? (rec.publishedAt ? 'published' : 'draft')
  const publishedAt = rec.publishedAt ? new Date(rec.publishedAt) : status === 'published' ? now : null
  const feedbackIds = (rec.feedbackExternalIds ?? []).flatMap((fid) => state.feedback.get(fid)?.id ?? [])
  const productIds: string[] = []
  for (const key of rec.products ?? []) {
    const found = state.products.find((p) => p.id === key || p.slug === key)
    if (found) productIds.push(found.id)
    else
      ctx.issue({
        severity: 'warning',
        entityType: 'changelog',
        externalId: rec.externalId,
        message: `Product "${key}" is not a product of this project; tag skipped`,
      })
  }

  for (let attempt = 1; ; attempt++) {
    const slug = await generateUniqueSlug(run.projectId, rec.title)
    try {
      return await db.transaction(async (tx) => {
        const values = {
          id: randomUUID(),
          projectId: run.projectId,
          title: rec.title,
          slug,
          summary: null,
          body: rec.body,
          labels: (incoming.labels as typeof changelogEntry.$inferInsert.labels) ?? [],
          status,
          publishedAt,
          authorUserId: null,
          externalSource: run.source,
          externalId: rec.externalId,
          createdAt: publishedAt ?? now,
          updatedAt: now,
        }
        const [inserted] = await tx
          .insert(changelogEntry)
          .values({ ...values, importSnapshot: snapshotFor('changelog', values) })
          .onConflictDoNothing({
            target: [changelogEntry.projectId, changelogEntry.externalSource, changelogEntry.externalId],
          })
          .returning({ id: changelogEntry.id })
        if (!inserted) return null
        if (feedbackIds.length)
          await tx
            .insert(changelogEntryFeedback)
            .values(
              [...new Set(feedbackIds)].map((feedbackId) => ({ entryId: inserted.id, feedbackId, createdAt: now }))
            )
            .onConflictDoNothing()
        if (productIds.length)
          await tx
            .insert(changelogEntryProduct)
            .values([...new Set(productIds)].map((productId) => ({ entryId: inserted.id, productId })))
            .onConflictDoNothing()
        return { result: 'create' as const, kept: false as const }
      })
    } catch (error) {
      // A concurrent entry took the slug between lookup and insert: pick another
      if (!isUniqueViolation(error) || attempt >= SLUG_ATTEMPTS) throw error
    }
  }
}

async function syncEntry(
  ctx: CommitContext,
  rec: ImportChangelog,
  incoming: Record<string, unknown>
): Promise<{ result: 'update' | 'unchanged'; kept: boolean }> {
  const { run } = ctx
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(changelogEntry)
      .where(
        and(
          eq(changelogEntry.projectId, run.projectId),
          eq(changelogEntry.externalSource, run.source),
          eq(changelogEntry.externalId, rec.externalId)
        )
      )
      .for('update')
      .limit(1)
    if (!row) return { result: 'unchanged', kept: false }
    const plan = planFieldSync(row, row.importSnapshot ?? null, incoming, SYNC_FIELDS.changelog)
    const applied = Object.keys(plan.apply).length > 0
    const set: Partial<typeof changelogEntry.$inferInsert> = {}
    if (applied) {
      Object.assign(set, plan.apply, { updatedAt: ctx.now() })
      if (typeof plan.apply.publishedAt === 'string') set.publishedAt = new Date(plan.apply.publishedAt)
    }
    if (!deepEqual(plan.nextSnapshot, row.importSnapshot)) set.importSnapshot = plan.nextSnapshot
    if (Object.keys(set).length) await tx.update(changelogEntry).set(set).where(eq(changelogEntry.id, row.id))
    return { result: applied ? 'update' : 'unchanged', kept: plan.kept.length > 0 }
  })
}
