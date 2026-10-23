import type { H3Event } from 'h3'
import { requireProjectCategoryAccess, type ProjectSlugAccessOptions } from './project-categories'

// Default system statuses returned when a project has no custom statuses
export const SYSTEM_STATUSES = [
  {
    value: 'open',
    name: 'Open',
    color: '#3b82f6',
    description: 'Newly submitted feedback',
    sortOrder: 0,
    isDefault: true,
  },
  {
    value: 'planned',
    name: 'Planned',
    color: '#8b5cf6',
    description: 'Acknowledged and planned for a future release',
    sortOrder: 1,
    isDefault: false,
  },
  {
    value: 'in_progress',
    name: 'In Progress',
    color: '#f59e0b',
    description: 'Actively being worked on',
    sortOrder: 2,
    isDefault: false,
  },
  {
    value: 'completed',
    name: 'Completed',
    color: '#10b981',
    description: 'Released or resolved',
    sortOrder: 3,
    isDefault: false,
  },
  {
    value: 'closed',
    name: 'Closed',
    color: '#6b7280',
    description: 'Closed without action',
    sortOrder: 4,
    isDefault: false,
  },
]

export function toStatusValue(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/-+/g, '_')
    .replace(/^_|_$/g, '')
}

export async function requireProjectStatusAccess(event: H3Event, options: ProjectSlugAccessOptions = {}) {
  return requireProjectCategoryAccess(event, options)
}
