/**
 * Pure helpers for the combined roadmap in All projects (see docs/plans/2026-11-01-all-projects-view/design.md).
 *
 * Every project has its own statuses (custom ones, or the system set). The combined board merges columns by
 * status `value`: the first project's name and colour win, and a status only one project has becomes a column
 * marked "<Project> only". Kept free of Vue and Nitro so it can be unit tested and shared by server and client.
 */

export interface RoadmapProjectRef {
  id: string
  name: string
  slug: string
}

export interface RoadmapStatus {
  value: string
  name: string
  color: string | null
  description?: string | null
  sortOrder: number
}

export interface RoadmapItemLike {
  status: string
  isPinned: boolean
  voteCount: number
}

export interface RoadmapProjectBoard<Item extends RoadmapItemLike> {
  project: RoadmapProjectRef
  statuses: RoadmapStatus[]
  items: Item[]
}

export interface MergedRoadmapColumn<Item extends RoadmapItemLike> {
  value: string
  name: string
  color: string | null
  description: string | null
  sortOrder: number
  /** Projects that have this status. */
  projectIds: string[]
  /** Set when exactly one of two or more projects has the status. */
  onlyProject: RoadmapProjectRef | null
  items: Array<Item & { project: RoadmapProjectRef }>
}

/** Pinned first, then by votes; the sort is stable so equal items keep their project order. */
export function sortRoadmapItems<Item extends RoadmapItemLike>(items: Item[]): Item[] {
  return [...items].sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.voteCount - a.voteCount)
}

/**
 * Column order: the first project's order, then each further project's new statuses are inserted before the
 * next status of that project that is already placed (appended when none follows). So "Beta" between
 * "In progress" and "Done" in one project lands there on the combined board too.
 */
export function mergeStatusOrder(statusLists: RoadmapStatus[][]): string[] {
  const order: string[] = []
  for (const list of statusLists) {
    const values = [...list].sort((a, b) => a.sortOrder - b.sortOrder).map((status) => status.value)
    values.forEach((value, index) => {
      if (order.includes(value)) return
      let at = -1
      for (let next = index + 1; next < values.length && at < 0; next++) at = order.indexOf(values[next]!)
      if (at < 0) order.push(value)
      else order.splice(at, 0, value)
    })
  }
  return order
}

export function mergeRoadmapColumns<Item extends RoadmapItemLike>(
  boards: Array<RoadmapProjectBoard<Item>>
): Array<MergedRoadmapColumn<Item>> {
  const order = mergeStatusOrder(boards.map((board) => board.statuses))
  const columns = new Map<string, MergedRoadmapColumn<Item>>()

  for (const board of boards) {
    for (const status of board.statuses) {
      const existing = columns.get(status.value)
      if (existing) {
        existing.projectIds.push(board.project.id)
        continue
      }
      columns.set(status.value, {
        value: status.value,
        name: status.name,
        color: status.color,
        description: status.description ?? null,
        sortOrder: order.indexOf(status.value),
        projectIds: [board.project.id],
        onlyProject: null,
        items: [],
      })
    }
  }

  for (const board of boards) {
    const own = new Set(board.statuses.map((status) => status.value))
    for (const item of board.items) {
      // Same as the single-project board: an item whose status its own project no longer defines is not
      // shown, even when another project's column happens to use that value.
      if (!own.has(item.status)) continue
      columns.get(item.status)?.items.push({ ...item, project: board.project })
    }
  }

  const byProject = new Map(boards.map((board) => [board.project.id, board.project]))
  return order.map((value) => {
    const column = columns.get(value)!
    column.items = sortRoadmapItems(column.items)
    if (boards.length >= 2 && column.projectIds.length === 1) {
      column.onlyProject = byProject.get(column.projectIds[0]!) ?? null
    }
    return column
  })
}

/** Whether an item of `projectId` can be dropped into the column (its project must have that status). */
export function canMoveToColumn(column: { projectIds: string[] }, projectId: string): boolean {
  return column.projectIds.includes(projectId)
}
