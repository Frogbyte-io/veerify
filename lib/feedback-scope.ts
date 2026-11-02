/**
 * Pure helpers for the combined Feedback page in All projects.
 *
 * Statuses and products are per project, so the page keeps the per-project data from
 * `GET /api/feedback/scope` and derives the merged views from it here.
 */

export type ScopeStatus = {
  value: string
  name: string
  color: string | null
  sortOrder: number
  isDefault: boolean
}

export type FeedbackScopeProject = {
  id: string
  feedbackCount: number
  products: { id: string; name: string; slug: string }[]
  statuses: ScopeStatus[]
}

export type MergedStatus = {
  value: string
  /** Name and colour of the first project that has the status (scope order). */
  name: string
  color: string | null
  projectIds: string[]
}

/**
 * The union of the statuses of `projects` by `value`. Order: lowest sort order any project gives
 * the status, then first appearance, so the system statuses keep their familiar order.
 */
export function mergeScopeStatuses(projects: FeedbackScopeProject[]): MergedStatus[] {
  const merged = new Map<string, MergedStatus & { order: number; seen: number }>()
  for (const project of projects) {
    for (const status of project.statuses) {
      const existing = merged.get(status.value)
      if (existing) {
        existing.projectIds.push(project.id)
        existing.order = Math.min(existing.order, status.sortOrder)
      } else {
        merged.set(status.value, {
          value: status.value,
          name: status.name,
          color: status.color,
          projectIds: [project.id],
          order: status.sortOrder,
          seen: merged.size,
        })
      }
    }
  }
  return [...merged.values()]
    .sort((a, b) => a.order - b.order || a.seen - b.seen)
    .map(({ value, name, color, projectIds }) => ({ value, name, color, projectIds }))
}

/** The status `value` as the project names it, or null when the project has no such status. */
export function projectStatus(
  projects: FeedbackScopeProject[],
  projectId: string | null | undefined,
  value: string
): ScopeStatus | null {
  const project = projects.find((p) => p.id === projectId)
  return project?.statuses.find((s) => s.value === value) ?? null
}

/**
 * The project "New feedback" starts on in All projects: the last project used when it can still
 * take feedback, else the active (last single) project, else the first one.
 */
export function defaultCreateProjectId(
  candidateIds: string[],
  lastUsedId: string | null | undefined,
  activeId: string | null | undefined
): string {
  if (lastUsedId && candidateIds.includes(lastUsedId)) return lastUsedId
  if (activeId && candidateIds.includes(activeId)) return activeId
  return candidateIds[0] ?? ''
}

const LAST_PROJECT_PREFIX = 'veerify:feedback:last-project:'

export function readLastFeedbackProject(organizationId: string | undefined): string | null {
  if (!import.meta.client || !organizationId) return null
  try {
    return window.localStorage.getItem(`${LAST_PROJECT_PREFIX}${organizationId}`) || null
  } catch {
    return null
  }
}

export function rememberLastFeedbackProject(organizationId: string | undefined, projectId: string) {
  if (!import.meta.client || !organizationId) return
  try {
    window.localStorage.setItem(`${LAST_PROJECT_PREFIX}${organizationId}`, projectId)
  } catch {
    // Storage unavailable: the default project is only a convenience.
  }
}
