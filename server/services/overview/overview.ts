import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { changelogEntry } from '~/server/database/schema/changelog'
import { feedback, feedbackStatus, vote } from '~/server/database/schema/feedback'
import { contact, conversation } from '~/server/database/schema/support'
import { resolveProjectModules } from '~/lib/modules'
import { listAccessibleInboxes } from '~/server/utils/support-access'
import { folderCondition } from '~/server/utils/support-trash'
import {
  assembleOverview,
  WEEK_DAYS,
  SLA_ITEM_LIMIT,
  DRAFT_ITEM_LIMIT,
  type OverviewProject,
  type OverviewRaw,
  type OverviewResponse,
} from './assemble'

const DAY_MS = 86_400_000
const ACTIVE_STATUSES = ['open', 'pending'] as const

type ScopedProject = {
  id: string
  name: string
  slug: string
  role: 'admin' | 'member'
  settings: unknown
}

/**
 * Open or pending, not paused, with a response or resolution due within the hour. Same rule as
 * the "breaching soon" view of `GET /api/support/conversations`.
 */
function breachingSoon(now: Date) {
  const soon = new Date(now.getTime() + 60 * 60_000)
  return and(
    inArray(conversation.status, ACTIVE_STATUSES),
    isNull(conversation.slaPausedAt),
    or(
      and(isNotNull(conversation.firstResponseDueAt), lte(conversation.firstResponseDueAt, soon)),
      and(isNotNull(conversation.nextResponseDueAt), lte(conversation.nextResponseDueAt, soon)),
      and(isNotNull(conversation.resolutionDueAt), lte(conversation.resolutionDueAt, soon))
    )
  )!
}

/** The customer wrote last, or nobody on the team has replied yet. */
const waitingForReply = sql`(${conversation.lastAgentReplyAt} is null or coalesce(${conversation.lastCustomerReplyAt}, ${conversation.createdAt}) > ${conversation.lastAgentReplyAt})`
const waitingSince = () => sql`coalesce(${conversation.lastCustomerReplyAt}, ${conversation.createdAt})`

const num = (value: unknown) => Number(value ?? 0)
const minutes = (value: unknown) => (value === null || value === undefined ? null : Math.round(Number(value)))

/**
 * What needs attention in `projects` and how the last 7 days went compared with the 7 before.
 * `projects` must already be access-checked (`requireScopedProjects`). A tool that is off in a
 * project contributes nothing, and inbox numbers only cover inboxes the user can work in.
 */
export async function getOverview(
  userId: string,
  projects: ScopedProject[],
  now: Date = new Date()
): Promise<OverviewResponse> {
  const modulesOf = new Map(
    projects.map((p) => [p.id, resolveProjectModules((p.settings ?? {}) as Record<string, unknown>)])
  )
  const inboxProjects = projects.filter((p) => modulesOf.get(p.id)!.supportEnabled)
  const feedbackProjectIds = projects.filter((p) => modulesOf.get(p.id)!.feedbackEnabled).map((p) => p.id)
  const changelogProjectIds = projects.filter((p) => modulesOf.get(p.id)!.changelogEnabled).map((p) => p.id)

  const inboxes = await listAccessibleInboxes(userId, inboxProjects)
  const inboxIds = inboxes.map((i) => i.id)
  const inboxAccessProjects = new Set(inboxes.map((i) => i.projectId))

  const weekStart = new Date(now.getTime() - WEEK_DAYS * DAY_MS)
  const previousStart = new Date(now.getTime() - 2 * WEEK_DAYS * DAY_MS)

  const inWeek = (column: AnyColumn) => and(gte(column, weekStart), lte(column, now))!
  const inPrevious = (column: AnyColumn) => and(gte(column, previousStart), lt(column, weekStart))!

  const hasInbox = inboxIds.length > 0
  const conversationScope = hasInbox
    ? and(inArray(conversation.inboxId, inboxIds), folderCondition(undefined))!
    : sql`false`
  const firstReplyMinutes = sql`extract(epoch from (${conversation.firstResponseAt} - ${conversation.createdAt})) / 60`
  const medianReply = (window: ReturnType<typeof inWeek>) =>
    sql<
      number | null
    >`percentile_cont(0.5) within group (order by ${firstReplyMinutes}) filter (where ${window} and ${isNotNull(conversation.firstResponseAt)})`
  const [
    conversationCounts,
    conversationWeek,
    [firstReplyTotal],
    slaItems,
    oldestWaiting,
    postsWeek,
    votesWeek,
    defaultStatuses,
    drafts,
    releases,
  ] = await Promise.all([
    hasInbox
      ? db
          .select({
            projectId: conversation.projectId,
            waiting: sql<number>`count(*) filter (where ${waitingForReply})`.mapWith(Number),
            waitingOther: sql<number>`count(*) filter (where ${waitingForReply} and not ${breachingSoon(now)})`.mapWith(
              Number
            ),
            atRisk: sql<number>`count(*) filter (where ${breachingSoon(now)})`.mapWith(Number),
          })
          .from(conversation)
          .where(and(conversationScope, inArray(conversation.status, ACTIVE_STATUSES)))
          .groupBy(conversation.projectId)
      : [],
    hasInbox
      ? db
          .select({
            projectId: conversation.projectId,
            received: sql<number>`count(*) filter (where ${inWeek(conversation.createdAt)})`.mapWith(Number),
            receivedPrevious: sql<number>`count(*) filter (where ${inPrevious(conversation.createdAt)})`.mapWith(
              Number
            ),
            firstReply: medianReply(inWeek(conversation.createdAt)),
            firstReplyPrevious: medianReply(inPrevious(conversation.createdAt)),
          })
          .from(conversation)
          .where(and(conversationScope, gte(conversation.createdAt, previousStart)))
          .groupBy(conversation.projectId)
      : [],
    hasInbox
      ? db
          .select({
            current: medianReply(inWeek(conversation.createdAt)),
            previous: medianReply(inPrevious(conversation.createdAt)),
          })
          .from(conversation)
          .where(and(conversationScope, gte(conversation.createdAt, previousStart)))
      : [{ current: null, previous: null }],
    hasInbox
      ? db
          .select({
            conversationId: conversation.id,
            inboxId: conversation.inboxId,
            projectId: conversation.projectId,
            subject: conversation.subject,
            contactName: contact.name,
            contactEmail: contact.email,
            // `least` ignores the timers that are not set
            dueAt:
              sql<Date>`least(${conversation.firstResponseDueAt}, ${conversation.nextResponseDueAt}, ${conversation.resolutionDueAt})`.mapWith(
                conversation.firstResponseDueAt
              ),
          })
          .from(conversation)
          .innerJoin(contact, eq(conversation.contactId, contact.id))
          .where(and(conversationScope, breachingSoon(now)))
          .orderBy(
            asc(
              sql`least(${conversation.firstResponseDueAt}, ${conversation.nextResponseDueAt}, ${conversation.resolutionDueAt})`
            )
          )
          .limit(SLA_ITEM_LIMIT)
      : [],
    hasInbox
      ? db
          .selectDistinctOn([conversation.projectId], {
            conversationId: conversation.id,
            inboxId: conversation.inboxId,
            projectId: conversation.projectId,
            subject: conversation.subject,
            since: waitingSince().mapWith(conversation.createdAt) as SQL<Date>,
          })
          .from(conversation)
          .where(
            and(
              conversationScope,
              inArray(conversation.status, ACTIVE_STATUSES),
              waitingForReply,
              sql`not ${breachingSoon(now)}`
            )
          )
          .orderBy(conversation.projectId, asc(waitingSince()))
      : [],
    feedbackProjectIds.length > 0
      ? db
          .select({
            projectId: feedback.projectId,
            current: sql<number>`count(*) filter (where ${inWeek(feedback.createdAt)})`.mapWith(Number),
            previous: sql<number>`count(*) filter (where ${inPrevious(feedback.createdAt)})`.mapWith(Number),
          })
          .from(feedback)
          .where(
            and(
              inArray(feedback.projectId, feedbackProjectIds),
              eq(feedback.isHidden, false),
              gte(feedback.createdAt, previousStart)
            )
          )
          .groupBy(feedback.projectId)
      : [],
    feedbackProjectIds.length > 0
      ? db
          .select({
            projectId: feedback.projectId,
            current: sql<number>`count(*) filter (where ${inWeek(vote.createdAt)})`.mapWith(Number),
            previous: sql<number>`count(*) filter (where ${inPrevious(vote.createdAt)})`.mapWith(Number),
          })
          .from(vote)
          .innerJoin(feedback, eq(vote.feedbackId, feedback.id))
          .where(
            and(
              inArray(feedback.projectId, feedbackProjectIds),
              eq(feedback.isHidden, false),
              eq(vote.type, 'upvote'),
              gte(vote.createdAt, previousStart)
            )
          )
          .groupBy(feedback.projectId)
      : [],
    feedbackProjectIds.length > 0
      ? db
          .select({ projectId: feedbackStatus.projectId, value: feedbackStatus.value, name: feedbackStatus.name })
          .from(feedbackStatus)
          .where(and(inArray(feedbackStatus.projectId, feedbackProjectIds), eq(feedbackStatus.isDefault, true)))
          .orderBy(asc(feedbackStatus.sortOrder), asc(feedbackStatus.createdAt))
      : [],
    changelogProjectIds.length > 0
      ? db
          .select({
            id: changelogEntry.id,
            projectId: changelogEntry.projectId,
            title: changelogEntry.title,
            createdAt: changelogEntry.createdAt,
            total: sql<number>`count(*) over ()`.mapWith(Number),
          })
          .from(changelogEntry)
          .where(and(inArray(changelogEntry.projectId, changelogProjectIds), eq(changelogEntry.status, 'draft')))
          .orderBy(desc(changelogEntry.createdAt))
          .limit(DRAFT_ITEM_LIMIT)
      : [],
    changelogProjectIds.length > 0
      ? db
          .selectDistinctOn([changelogEntry.projectId], {
            projectId: changelogEntry.projectId,
            title: changelogEntry.title,
            publishedAt: changelogEntry.publishedAt,
          })
          .from(changelogEntry)
          .where(
            and(
              inArray(changelogEntry.projectId, changelogProjectIds),
              eq(changelogEntry.status, 'published'),
              isNotNull(changelogEntry.publishedAt)
            )
          )
          .orderBy(changelogEntry.projectId, desc(changelogEntry.publishedAt))
      : [],
  ])

  // Posts still on the project's default status (or `open` when it has none): a second, small query
  // because the default status differs per project.
  const defaultValues = [...new Set([...defaultStatuses.map((s) => s.value), 'open'])]
  const statusCounts =
    feedbackProjectIds.length > 0
      ? await db
          .select({
            projectId: feedback.projectId,
            status: feedback.status,
            count: sql<number>`count(*)`.mapWith(Number),
          })
          .from(feedback)
          .where(
            and(
              inArray(feedback.projectId, feedbackProjectIds),
              eq(feedback.isHidden, false),
              inArray(feedback.status, defaultValues)
            )
          )
          .groupBy(feedback.projectId, feedback.status)
      : []

  const overviewProjects: OverviewProject[] = projects.map((p) => {
    const modules = modulesOf.get(p.id)!
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      inboxOn: modules.supportEnabled,
      feedbackOn: modules.feedbackEnabled,
      changelogOn: modules.changelogEnabled,
      inboxAccess: inboxAccessProjects.has(p.id),
    }
  })

  const raw: OverviewRaw = {
    now,
    projects: overviewProjects,
    conversationCounts: conversationCounts.map((row) => ({
      projectId: row.projectId,
      waiting: num(row.waiting),
      waitingOther: num(row.waitingOther),
      atRisk: num(row.atRisk),
    })),
    conversationWeek: conversationWeek.map((row) => ({
      projectId: row.projectId,
      received: num(row.received),
      receivedPrevious: num(row.receivedPrevious),
      firstReply: minutes(row.firstReply),
      firstReplyPrevious: minutes(row.firstReplyPrevious),
    })),
    firstReplyTotal: {
      current: minutes(firstReplyTotal?.current),
      previous: minutes(firstReplyTotal?.previous),
    },
    slaItems,
    oldestWaiting,
    postsWeek,
    votesWeek,
    defaultStatuses,
    statusCounts,
    drafts,
    draftTotal: num(drafts[0]?.total),
    releases,
  }
  return assembleOverview(raw)
}
