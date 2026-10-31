// Inbox views shown in the sidebar, the tablet rail and the phone drawer.
export interface SupportViewItem {
  value: string
  label: string
  icon: string
  badgeKey?: string
  urgent?: boolean
}

export const SUPPORT_WORKING_VIEW_ITEMS: SupportViewItem[] = [
  { value: 'inbox', label: 'Inbox', icon: 'lucide:inbox', badgeKey: 'inbox' },
  { value: 'assigned-to-me', label: 'Assigned to me', icon: 'lucide:user-round', badgeKey: 'assignedToMe' },
  { value: 'unassigned', label: 'Unassigned', icon: 'lucide:user-round-x', badgeKey: 'unassigned' },
  {
    value: 'breaching-soon',
    label: 'Breaching soon',
    icon: 'lucide:alarm-clock',
    badgeKey: 'breachingSoon',
    urgent: true,
  },
  { value: 'snoozed', label: 'Snoozed', icon: 'lucide:clock' },
  { value: 'resolved', label: 'Resolved', icon: 'lucide:check-circle-2' },
]

export const SUPPORT_FOLDER_VIEW_ITEMS: SupportViewItem[] = [
  { value: 'all', label: 'All conversations', icon: 'lucide:layers-3' },
  { value: 'archived', label: 'Archived', icon: 'lucide:archive' },
  { value: 'spam', label: 'Spam', icon: 'lucide:shield-alert' },
  { value: 'trash', label: 'Trash', icon: 'lucide:trash-2' },
]
