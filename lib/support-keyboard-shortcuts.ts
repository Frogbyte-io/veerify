export type SupportShortcutAction = 'next' | 'previous' | 'reply' | 'note' | 'claim' | 'resolve' | 'search' | 'help'

const SUPPORT_SHORTCUT_ACTIONS: Record<string, SupportShortcutAction> = {
  j: 'next',
  k: 'previous',
  r: 'reply',
  n: 'note',
  c: 'claim',
  e: 'resolve',
  '/': 'search',
  '?': 'help',
}

export function getSupportShortcutAction(key: string): SupportShortcutAction | null {
  return SUPPORT_SHORTCUT_ACTIONS[key.toLowerCase()] || null
}

export function getNextSupportConversationId(
  conversationIds: string[],
  selectedConversationId: string | null,
  direction: 1 | -1
): string | null {
  if (conversationIds.length === 0) return null

  const selectedIndex = selectedConversationId ? conversationIds.indexOf(selectedConversationId) : -1
  const startIndex = selectedIndex === -1 ? (direction > 0 ? 0 : conversationIds.length - 1) : selectedIndex + direction
  const nextIndex = Math.max(0, Math.min(conversationIds.length - 1, startIndex))
  return conversationIds[nextIndex] || null
}

export function isSupportShortcutEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false

  const element = target as {
    tagName?: string
    isContentEditable?: boolean
    closest?: unknown
  }
  const tagName = element.tagName?.toUpperCase()
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || tagName === 'BUTTON') return true
  if (element.isContentEditable) return true
  if (typeof element.closest !== 'function') return false
  return Boolean(
    Reflect.apply(element.closest, element, [
      'button, [role="button"], input, textarea, select, [contenteditable="true"]',
    ])
  )
}
