/**
 * Pure assembly of the Overview (`GET /api/dashboard/overview`) from the raw query rows.
 *
 * `overview.ts` runs a handful of grouped queries; this module turns their rows into the response:
 * it applies the per-project tool switches (a tool that is off contributes nothing), sums the
 * projects in view, and orders everything. No database access, so it is unit tested directly.
 */

export type OverviewProject = {
  id: string
  name: string
  slug: string
  /** Tool switches (`resolveProjectModules`) */
  inboxOn: boolean
  feedbackOn: boolean
  changelogOn: boolean
  /** The user can work in at least one inbox of the project */
  inboxAccess: boolean
}

export type ProjectRef = { id: string; name: string; slug: string }

export type ConversationCountRow = {
  projectId: string
  /** Open or pending, the customer wrote last (or nobody replied yet) */
  waiting: number
  /** Same, minus the conversations counted in `atRisk` */
  waitingOther: number
  /** Open or pending with a response or resolution due within the hour */
  atRisk: number
}

export type ConversationWeekRow = {
  projectId: string
  received: number
  receivedPrevious: number
  /** Median minutes from the first message to the first agent reply */
  firstReply: number | null
  firstReplyPrevious: number | null
}

export type SlaItemRow = {
  conversationId: string
  inboxId: string
  projectId: string
  subject: string | null
  contactName: string | null
  contactEmail: string | null
  dueAt: Date
}

export type OldestWaitingRow = {
  conversationId: string
  inboxId: string
  projectId: string
  subject: string | null
  since: Date
}

export type FeedbackWeekRow = { projectId: string; current: number; previous: number }

export type DraftRow = { id: string; projectId: string; title: string; createdAt: Date }

export type ReleaseRow = { projectId: string; title: string; publishedAt: Date | null }

export type OverviewRaw = {
  now: Date
  projects: OverviewProject[]
  conversationCounts: ConversationCountRow[]
  conversationWeek: ConversationWeekRow[]
  /** Median first reply over every conversation in view (not an average of the per-project medians) */
  firstReplyTotal: { current: number | null; previous: number | null }
  slaItems: SlaItemRow[]
  oldestWaiting: OldestWaitingRow[]
  postsWeek: FeedbackWeekRow[]
  votesWeek: FeedbackWeekRow[]
  /** Each project's default feedback status (the one new posts start on) */
  defaultStatuses: Array<{ projectId: string; value: string; name: string }>
  /** Feedback counts per project and status, for the default status values only */
  statusCounts: Array<{ projectId: string; status: string; count: number }>
  drafts: DraftRow[]
  draftTotal: number
  releases: ReleaseRow[]
}

export const WEEK_DAYS = 7
export const SLA_ITEM_LIMIT = 5
export const DRAFT_ITEM_LIMIT = 5

export type VolumeMetric = {
  /** At least one project in view has the tool on, so the number means something */
  available: boolean
  current: number
  previous: number
  /** Current 7 days per project (projects with the tool off are absent), for the split bar */
  byProject: Record<string, number>
}

export type ReplyMetric = {
  available: boolean
  /** Minutes; null when nothing was answered in the period */
  current: number | null
  previous: number | null
  byProject: Record<string, number | null>
  slowest: { project: ProjectRef; minutes: number } | null
}

export type OverviewResponse = {
  needsYou: {
    slaAtRisk: {
      total: number
      items: Array<{
        conversationId: string
        inboxId: string
        subject: string | null
        contactName: string | null
        dueAt: string
        project: ProjectRef
      }>
    }
    waiting: {
      total: number
      byProject: Array<{ project: ProjectRef; count: number }>
      oldest: {
        conversationId: string
        inboxId: string
        subject: string | null
        since: string
        project: ProjectRef
      } | null
    }
    untriaged: {
      total: number
      byProject: Array<{ project: ProjectRef; count: number; statusValue: string; statusName: string }>
    }
    drafts: {
      total: number
      items: Array<{ id: string; title: string; createdAt: string; project: ProjectRef }>
    }
  }
  week: {
    from: string
    to: string
    previousFrom: string
    received: VolumeMetric
    firstReply: ReplyMetric
    posts: VolumeMetric
    votes: VolumeMetric
  }
  projects: Array<{
    project: ProjectRef
    tools: { inbox: boolean; feedback: boolean; changelog: boolean }
    inboxAccess: boolean
    waiting: number
    slaAtRisk: number
    newFeedback: number
    votes: number
    lastRelease: { title: string; publishedAt: string } | null
  }>
}

const ref = (p: OverviewProject): ProjectRef => ({ id: p.id, name: p.name, slug: p.slug })

/** Inboxes count only where the tool is on and the user can work in one. */
const inboxCounts = (p: OverviewProject) => p.inboxOn && p.inboxAccess

export function assembleOverview(raw: OverviewRaw): OverviewResponse {
  const projects = raw.projects
  const byId = new Map(projects.map((p) => [p.id, p]))
  const inView = <T extends { projectId: string }>(rows: T[], allowed: typeof inboxCounts) =>
    rows.filter((row) => {
      const p = byId.get(row.projectId)
      return Boolean(p && allowed(p))
    })

  const counts = new Map(inView(raw.conversationCounts, inboxCounts).map((row) => [row.projectId, row]))
  const week = new Map(inView(raw.conversationWeek, inboxCounts).map((row) => [row.projectId, row]))
  const posts = new Map(inView(raw.postsWeek, (p) => p.feedbackOn).map((row) => [row.projectId, row]))
  const votes = new Map(inView(raw.votesWeek, (p) => p.feedbackOn).map((row) => [row.projectId, row]))
  const releases = new Map(inView(raw.releases, (p) => p.changelogOn).map((row) => [row.projectId, row]))

  // ---- Needs you
  const slaItems = inView(raw.slaItems, inboxCounts)
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
    .slice(0, SLA_ITEM_LIMIT)
  const waitingProjects = projects.filter((p) => (counts.get(p.id)?.waitingOther ?? 0) > 0)
  const oldestWaiting =
    inView(raw.oldestWaiting, inboxCounts).sort((a, b) => a.since.getTime() - b.since.getTime())[0] ?? null

  const defaultByProject = new Map<string, { value: string; name: string }>()
  for (const row of raw.defaultStatuses) {
    if (!defaultByProject.has(row.projectId)) defaultByProject.set(row.projectId, { value: row.value, name: row.name })
  }
  const untriaged = projects
    .filter((p) => p.feedbackOn)
    .map((p) => {
      // A project without a default status starts new posts on `open`.
      const status = defaultByProject.get(p.id) ?? { value: 'open', name: 'Open' }
      const count = raw.statusCounts
        .filter((row) => row.projectId === p.id && row.status === status.value)
        .reduce((sum, row) => sum + row.count, 0)
      return { project: ref(p), count, statusValue: status.value, statusName: status.name }
    })
    .filter((row) => row.count > 0)

  const draftsInView = inView(raw.drafts, (p) => p.changelogOn)
  const drafts = draftsInView.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, DRAFT_ITEM_LIMIT)
  // The query counts drafts of changelog-on projects only; never report more than that when rows were dropped.
  const draftTotal = draftsInView.length < raw.drafts.length ? draftsInView.length : raw.draftTotal

  // ---- Last 7 days
  const volume = (rows: Iterable<FeedbackWeekRow>, available: boolean): VolumeMetric => {
    let current = 0
    let previous = 0
    const byProject: Record<string, number> = {}
    for (const row of rows) {
      current += row.current
      previous += row.previous
      byProject[row.projectId] = row.current
    }
    return { available, current, previous, byProject }
  }
  const received = volume(
    [...week.values()].map((row) => ({
      projectId: row.projectId,
      current: row.received,
      previous: row.receivedPrevious,
    })),
    projects.some(inboxCounts)
  )
  const replyByProject: Record<string, number | null> = {}
  let slowest: ReplyMetric['slowest'] = null
  for (const p of projects.filter(inboxCounts)) {
    const minutes = week.get(p.id)?.firstReply ?? null
    replyByProject[p.id] = minutes
    if (minutes !== null && (!slowest || minutes > slowest.minutes)) slowest = { project: ref(p), minutes }
  }

  const weekFrom = new Date(raw.now.getTime() - WEEK_DAYS * 86_400_000)
  const previousFrom = new Date(raw.now.getTime() - 2 * WEEK_DAYS * 86_400_000)

  return {
    needsYou: {
      slaAtRisk: {
        total: [...counts.values()].reduce((sum, row) => sum + row.atRisk, 0),
        items: slaItems.map((row) => ({
          conversationId: row.conversationId,
          inboxId: row.inboxId,
          subject: row.subject,
          contactName: row.contactName || row.contactEmail,
          dueAt: row.dueAt.toISOString(),
          project: ref(byId.get(row.projectId)!),
        })),
      },
      waiting: {
        total: [...counts.values()].reduce((sum, row) => sum + row.waitingOther, 0),
        byProject: waitingProjects.map((p) => ({ project: ref(p), count: counts.get(p.id)!.waitingOther })),
        oldest: oldestWaiting
          ? {
              conversationId: oldestWaiting.conversationId,
              inboxId: oldestWaiting.inboxId,
              subject: oldestWaiting.subject,
              since: oldestWaiting.since.toISOString(),
              project: ref(byId.get(oldestWaiting.projectId)!),
            }
          : null,
      },
      untriaged: {
        total: untriaged.reduce((sum, row) => sum + row.count, 0),
        byProject: untriaged,
      },
      drafts: {
        // The total counts drafts in projects with the changelog on; the items are capped.
        total: draftTotal,
        items: drafts.map((row) => ({
          id: row.id,
          title: row.title,
          createdAt: row.createdAt.toISOString(),
          project: ref(byId.get(row.projectId)!),
        })),
      },
    },
    week: {
      from: weekFrom.toISOString(),
      to: raw.now.toISOString(),
      previousFrom: previousFrom.toISOString(),
      received,
      firstReply: {
        available: received.available,
        current: received.available ? raw.firstReplyTotal.current : null,
        previous: received.available ? raw.firstReplyTotal.previous : null,
        byProject: replyByProject,
        slowest,
      },
      posts: volume(
        posts.values(),
        projects.some((p) => p.feedbackOn)
      ),
      votes: volume(
        votes.values(),
        projects.some((p) => p.feedbackOn)
      ),
    },
    projects: projects.map((p) => {
      const release = releases.get(p.id)
      return {
        project: ref(p),
        tools: { inbox: p.inboxOn, feedback: p.feedbackOn, changelog: p.changelogOn },
        inboxAccess: p.inboxAccess,
        waiting: counts.get(p.id)?.waiting ?? 0,
        slaAtRisk: counts.get(p.id)?.atRisk ?? 0,
        newFeedback: posts.get(p.id)?.current ?? 0,
        votes: votes.get(p.id)?.current ?? 0,
        lastRelease:
          release && release.publishedAt
            ? { title: release.title, publishedAt: release.publishedAt.toISOString() }
            : null,
      }
    }),
  }
}
