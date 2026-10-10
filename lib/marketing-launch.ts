export const LAUNCH_STATUSES = [
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'live', label: 'Live' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'skipped', label: 'Skipped' },
]

export const LAUNCH_CATEGORIES = [
  { value: 'launch', label: 'Launch sites' },
  { value: 'directory', label: 'Directories' },
  { value: 'review', label: 'Review sites' },
  { value: 'community', label: 'Communities' },
  { value: 'ai-directory', label: 'AI directories' },
  { value: 'custom', label: 'Custom' },
]

export function statusLabel(value: string) {
  return LAUNCH_STATUSES.find((status) => status.value === value)?.label || value
}

export function categoryLabel(value: string) {
  return LAUNCH_CATEGORIES.find((category) => category.value === value)?.label || value
}
