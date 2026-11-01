/**
 * Overview helpers (pages/dashboard/index.vue): number formatting and the "Needs you" rows.
 * See docs/plans/2026-11-01-all-projects-view/design.md → Overview.
 */
import type { OverviewResponse, ProjectRef } from '~/server/services/overview/assemble'

export type { OverviewResponse, ProjectRef }

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** 45 → "45m", 190 → "3h 10m", 120 → "2h". */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '–'
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  if (hours >= 48) return `${Math.round(minutes / 1440)}d`
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

export type Delta = {
  /** Arrow shown before the text; none when nothing changed */
  arrow: '↑' | '↓' | ''
  text: string
  /** Only set for numbers with a right direction (reply time): faster is good */
  tone: 'good' | 'bad' | 'neutral'
}

/**
 * The comparison under a number, against the same projects' previous 7 days. Volumes pass
 * `goodWhenDown: undefined` and stay neutral; reply time passes `true`.
 */
export function formatDelta(
  current: number | null,
  previous: number | null,
  goodWhenDown: boolean | undefined = undefined
): Delta {
  if (current === null || current === undefined) return { arrow: '', text: '', tone: 'neutral' }
  if (previous === null || previous === undefined) {
    return { arrow: '', text: 'Nothing to compare in the previous 7 days', tone: 'neutral' }
  }
  if (current === previous) return { arrow: '', text: 'No change vs previous 7 days', tone: 'neutral' }
  if (previous === 0) return { arrow: '↑', text: 'from 0 in the previous 7 days', tone: 'neutral' }
  const percent = Math.round(((current - previous) / previous) * 100)
  if (percent === 0) return { arrow: '', text: 'No change vs previous 7 days', tone: 'neutral' }
  const down = percent < 0
  const tone = goodWhenDown === undefined ? 'neutral' : down === goodWhenDown ? 'good' : 'bad'
  return { arrow: down ? '↓' : '↑', text: `${Math.abs(percent)}% vs previous 7 days`, tone }
}

/** "runs out in 12 minutes" / "ran out 25 minutes ago". */
export function dueLabel(dueAt: string | Date, now: Date = new Date()): string {
  const diff = Math.round((new Date(dueAt).getTime() - now.getTime()) / 60_000)
  const span = (minutes: number) => {
    const abs = Math.abs(minutes)
    return abs < 60 ? plural(abs, 'minute', 'minutes') : plural(Math.round(abs / 60), 'hour', 'hours')
  }
  if (diff === 0) return 'is about to run out'
  return diff > 0 ? `runs out in ${span(diff)}` : `ran out ${span(diff)} ago`
}

export type TodoAction = {
  label: string
  to: string
  /** Switch to this project first (its tool pages work in the active project) */
  switchProjectId?: string
}

export type Todo = {
  key: string
  /** Colours the icon: red for an SLA, otherwise a calm accent */
  tone: 'urgent' | 'inbox' | 'feedback' | 'changelog'
  icon: string
  title: string
  /** The project of a single item (a conversation or a draft) */
  project?: ProjectRef
  /** Text before the quote, e.g. "Oldest:" */
  lead?: string
  quote?: string
  /** Text after the quote */
  detail?: string
  /** "3 in Dotmatrixlabs, 1 in Decker", only in All projects */
  breakdown?: Array<{ project: ProjectRef; count: number }>
  action: TodoAction
  primary?: boolean
}

export type TodoOptions = {
  allProjects: boolean
  now?: Date
  /** The project the dashboard currently works in */
  activeProjectId?: string
}

function formatShortDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** "Needs you" rows, most urgent first: SLA, waiting conversations, untriaged feedback, drafts. */
export function buildTodos(needsYou: OverviewResponse['needsYou'], options: TodoOptions): Todo[] {
  const now = options.now ?? new Date()
  const todos: Todo[] = []

  for (const item of needsYou.slaAtRisk.items) {
    todos.push({
      key: `sla-${item.conversationId}`,
      tone: 'urgent',
      icon: 'lucide:alarm-clock',
      title: `Reply to ${item.contactName || 'a customer'}: the SLA ${dueLabel(item.dueAt, now)}`,
      project: item.project,
      quote: item.subject || '(no subject)',
      action: {
        label: 'Reply',
        to: `/inbox?inboxId=${encodeURIComponent(item.inboxId)}&conversationId=${encodeURIComponent(item.conversationId)}`,
      },
      primary: true,
    })
  }
  const slaRest = needsYou.slaAtRisk.total - needsYou.slaAtRisk.items.length
  if (slaRest > 0) {
    todos.push({
      key: 'sla-more',
      tone: 'urgent',
      icon: 'lucide:alarm-clock',
      title: `${plural(slaRest, 'more conversation is', 'more conversations are')} about to breach the SLA`,
      action: { label: 'Open inbox', to: '/inbox?view=breaching-soon' },
    })
  }

  const waiting = needsYou.waiting
  if (waiting.total > 0) {
    todos.push({
      key: 'waiting',
      tone: 'inbox',
      icon: 'lucide:inbox',
      title: `${plural(waiting.total, 'conversation is', 'conversations are')} waiting for a reply`,
      quote: !options.allProjects && waiting.oldest ? waiting.oldest.subject || '(no subject)' : undefined,
      lead: !options.allProjects && waiting.oldest ? 'Oldest:' : undefined,
      breakdown: options.allProjects ? waiting.byProject : undefined,
      action: { label: 'Open inbox', to: '/inbox' },
    })
  }

  const untriaged = needsYou.untriaged
  if (untriaged.total > 0) {
    // One project with untriaged posts: open its board on the status they are stuck on.
    const single = untriaged.byProject.length === 1 ? untriaged.byProject[0]! : null
    const query = new URLSearchParams()
    if (single) {
      query.set('status', single.statusValue)
      if (options.allProjects) query.set('projects', single.project.id)
    }
    const queryString = query.toString()
    todos.push({
      key: 'untriaged',
      tone: 'feedback',
      icon: 'lucide:message-square-dot',
      title: `${plural(untriaged.total, 'feedback post has', 'feedback posts have')} no status yet`,
      detail: 'Give each a status, or merge it into an existing post.',
      breakdown: options.allProjects ? untriaged.byProject : undefined,
      action: { label: 'Triage', to: queryString ? `/feedback?${queryString}` : '/feedback' },
    })
  }

  for (const draft of needsYou.drafts.items) {
    todos.push({
      key: `draft-${draft.id}`,
      tone: 'changelog',
      icon: 'lucide:scroll-text',
      title: 'A changelog draft is ready to publish',
      project: draft.project,
      quote: draft.title,
      detail: `written ${formatShortDate(draft.createdAt)}`,
      action: {
        label: 'Review draft',
        to: `/dashboard/changelog/${encodeURIComponent(draft.id)}`,
        switchProjectId: draft.project.id !== options.activeProjectId ? draft.project.id : undefined,
      },
    })
  }
  const draftsRest = needsYou.drafts.total - needsYou.drafts.items.length
  if (draftsRest > 0) {
    todos.push({
      key: 'drafts-more',
      tone: 'changelog',
      icon: 'lucide:scroll-text',
      title: `${plural(draftsRest, 'more changelog draft is', 'more changelog drafts are')} waiting to be published`,
      action: { label: 'Open changelog', to: '/dashboard/changelog' },
    })
  }

  return todos
}

/** "Oct 25, 17:02 – now": the rolling 7 days the numbers cover. */
export function formatWeekRange(from: string): string {
  const start = new Date(from)
  const date = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const time = start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return `${date}, ${time} – now`
}
