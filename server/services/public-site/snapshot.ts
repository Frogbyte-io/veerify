import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackCategory, feedbackComment, feedbackStatus } from '~/server/database/schema/feedback'
import { user } from '~/server/database/schema/auth'
import { listPublicProducts, resolvePublicProject } from '~/server/utils/project-access'
import { SYSTEM_STATUSES } from '~/server/utils/project-statuses'
import { listPublishedEntries } from '~/server/services/changelog/public'
import { resolveProjectModules, type ModuleSettings } from '~/lib/modules'

/** Bounds on what one snapshot carries; the full board stays one click away. */
export const SNAPSHOT_FEEDBACK_LIMIT = 200
export const SNAPSHOT_CHANGELOG_LIMIT = 50
export const SNAPSHOT_COMMENT_LIMIT = 200
const CACHE_TTL_MS = 60_000
const CACHE_MAX_ENTRIES = 500

export type PublicFeedbackItem = {
  id: string
  productId: string
  title: string
  body: string | null
  status: string
  tag: string | null
  category: string | null
  voteCount: number
  commentCount: number
  createdAt: Date
}

export type PublicChangelogItem = {
  title: string
  slug: string
  summary: string | null
  /** Markdown source */
  body: string
  labels: string[]
  publishedAt: Date | null
  productIds: string[]
}

/**
 * Everything an anonymous visitor can read on a public project's site, loaded
 * on the server so crawlers and agents get it without running the client app.
 * Only public products, non-hidden feedback and published changelog entries;
 * support-derived feedback is left out entirely.
 */
export type PublicProjectSnapshot = {
  organization: { name: string; slug: string }
  project: {
    id: string
    name: string
    slug: string
    description: string | null
    customDomain: string | null
    settings: Record<string, unknown> | null
    updatedAt: Date
  }
  products: Array<{ id: string; name: string; slug: string; description: string | null }>
  modules: ModuleSettings
  statuses: Array<{ value: string; name: string; description: string | null }>
  /** Pinned first, then by votes */
  feedback: PublicFeedbackItem[]
  /** Newest first */
  changelog: PublicChangelogItem[]
}

function toPublicItem(row: {
  feedback: typeof feedback.$inferSelect
  categoryName: string | null
}): PublicFeedbackItem {
  return {
    id: row.feedback.id,
    productId: row.feedback.productId,
    title: row.feedback.title,
    body: row.feedback.body,
    status: row.feedback.status,
    tag: row.feedback.metadata?.feedbackType || null,
    category: row.categoryName ?? null,
    voteCount: row.feedback.voteCount,
    commentCount: row.feedback.commentCount,
    createdAt: row.feedback.createdAt,
  }
}

const cache = new Map<string, { at: number; snapshot: PublicProjectSnapshot }>()

export function clearPublicSnapshotCache() {
  cache.clear()
}

/** Loads (or reuses, for up to a minute) the public snapshot of a project. 404/403 like the public API. */
export async function loadPublicProjectSnapshot(orgSlug: string, projectSlug: string): Promise<PublicProjectSnapshot> {
  const key = `${orgSlug}/${projectSlug}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.snapshot

  const { organization: org, project: proj } = await resolvePublicProject(orgSlug, projectSlug)
  const settings = (proj.settings as Record<string, unknown> | null) ?? null
  const modules = resolveProjectModules(settings)
  const products = await listPublicProducts(proj.id)
  const productIds = products.map((p) => p.id)

  const customStatuses = await db
    .select()
    .from(feedbackStatus)
    .where(eq(feedbackStatus.projectId, proj.id))
    .orderBy(feedbackStatus.sortOrder)
  const statuses = (customStatuses.length > 0 ? customStatuses : SYSTEM_STATUSES).map((s) => ({
    value: s.value,
    name: s.name,
    description: s.description ?? null,
  }))

  const feedbackRows =
    productIds.length > 0 && (modules.feedbackEnabled || modules.roadmapEnabled)
      ? await db
          .select({ feedback, categoryName: feedbackCategory.name })
          .from(feedback)
          .leftJoin(feedbackCategory, eq(feedback.categoryId, feedbackCategory.id))
          .where(
            and(eq(feedback.projectId, proj.id), eq(feedback.isHidden, false), inArray(feedback.productId, productIds))
          )
          .orderBy(desc(feedback.isPinned), desc(feedback.voteCount), desc(feedback.createdAt))
          .limit(SNAPSHOT_FEEDBACK_LIMIT)
      : []

  // `rows` carry the markdown source, `entries` the public product tags (same order)
  const published = modules.changelogEnabled
    ? await listPublishedEntries(proj.id, { limit: SNAPSHOT_CHANGELOG_LIMIT })
    : { rows: [], entries: [] }
  const changelog: PublicChangelogItem[] = published.rows.map((row, i) => ({
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    body: row.body,
    labels: row.labels,
    publishedAt: row.publishedAt,
    productIds: published.entries[i]?.productIds ?? [],
  }))

  const snapshot: PublicProjectSnapshot = {
    organization: { name: org.name, slug: orgSlug },
    project: {
      id: proj.id,
      name: proj.name,
      slug: proj.slug,
      description: proj.description,
      customDomain: proj.customDomain,
      settings,
      updatedAt: proj.updatedAt,
    },
    products: products.map((p) => ({ id: p.id, name: p.name, slug: p.slug, description: p.description })),
    modules,
    statuses,
    feedback: feedbackRows.filter((row) => row.feedback.metadata?.source !== 'support_conversation').map(toPublicItem),
    changelog,
  }

  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!)
  cache.set(key, { at: Date.now(), snapshot })
  return snapshot
}

export type PublicFeedbackPost = PublicFeedbackItem & {
  authorName: string | null
  comments: Array<{ id: string; authorName: string; body: string; createdAt: Date; isReply: boolean }>
}

/**
 * One feedback item of a public snapshot's project, with its public comments, or
 * null when anonymous visitors cannot see it (other project, hidden, private
 * product, support-derived, or feedback and roadmap both off).
 */
export async function loadPublicFeedbackPost(
  s: PublicProjectSnapshot,
  feedbackId: string
): Promise<PublicFeedbackPost | null> {
  if (!s.modules.feedbackEnabled && !s.modules.roadmapEnabled) return null
  const [row] = await db
    .select({ feedback, categoryName: feedbackCategory.name })
    .from(feedback)
    .leftJoin(feedbackCategory, eq(feedback.categoryId, feedbackCategory.id))
    .where(and(eq(feedback.id, feedbackId), eq(feedback.projectId, s.project.id), eq(feedback.isHidden, false)))
    .limit(1)
  if (!row) return null
  if (row.feedback.metadata?.source === 'support_conversation') return null
  if (!s.products.some((p) => p.id === row.feedback.productId)) return null

  const comments = await db
    .select({ comment: feedbackComment, userName: user.name })
    .from(feedbackComment)
    .leftJoin(user, eq(feedbackComment.authorUserId, user.id))
    .where(and(eq(feedbackComment.feedbackId, feedbackId), eq(feedbackComment.isInternal, false)))
    .orderBy(asc(feedbackComment.createdAt))
    .limit(SNAPSHOT_COMMENT_LIMIT)

  return {
    ...toPublicItem(row),
    authorName: row.feedback.authorName ?? null,
    comments: comments.map(({ comment, userName }) => ({
      id: comment.id,
      authorName: userName || comment.authorName || 'Anonymous',
      body: comment.body,
      createdAt: comment.createdAt,
      isReply: Boolean(comment.parentCommentId),
    })),
  }
}
