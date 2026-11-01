/**
 * Helpers for the combined Feedback page in All projects (`GET /api/feedback/scope`).
 */
import { SYSTEM_STATUSES } from './project-statuses'

export interface ScopeStatus {
  value: string
  name: string
  color: string | null
  sortOrder: number
  isDefault: boolean
}

interface StatusRow {
  projectId: string
  value: string
  name: string
  color: string | null
  sortOrder: number
  isDefault: boolean
}

/**
 * Statuses per project: its custom statuses (in display order) when it has any, else the system
 * statuses, mirroring `PATCH /api/feedback/[id]/status`, which validates against the same set.
 */
export function statusesByProject(rows: StatusRow[], projectIds: string[]): Record<string, ScopeStatus[]> {
  const result: Record<string, ScopeStatus[]> = {}
  for (const id of projectIds) {
    const own = rows
      .filter((row) => row.projectId === id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ value, name, color, sortOrder, isDefault }) => ({ value, name, color, sortOrder, isDefault }))
    result[id] =
      own.length > 0
        ? own
        : SYSTEM_STATUSES.map(({ value, name, color, sortOrder, isDefault }) => ({
            value,
            name,
            color,
            sortOrder,
            isDefault,
          }))
  }
  return result
}
