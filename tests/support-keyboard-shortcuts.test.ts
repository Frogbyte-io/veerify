import { describe, expect, it } from 'vitest'
import {
  getNextSupportConversationId,
  getSupportShortcutAction,
  isSupportShortcutEditableTarget,
} from '../lib/support-keyboard-shortcuts'

describe('support keyboard shortcut helpers', () => {
  it('maps the supported keys and ignores unknown keys', () => {
    expect(getSupportShortcutAction('j')).toBe('next')
    expect(getSupportShortcutAction('K')).toBe('previous')
    expect(getSupportShortcutAction('/')).toBe('search')
    expect(getSupportShortcutAction('?')).toBe('help')
    expect(getSupportShortcutAction('x')).toBeNull()
  })

  it('moves through the visible conversation ids without leaving the list', () => {
    const ids = ['first', 'second', 'third']

    expect(getNextSupportConversationId(ids, null, 1)).toBe('first')
    expect(getNextSupportConversationId(ids, null, -1)).toBe('third')
    expect(getNextSupportConversationId(ids, 'first', -1)).toBe('first')
    expect(getNextSupportConversationId(ids, 'second', 1)).toBe('third')
    expect(getNextSupportConversationId(ids, 'third', 1)).toBe('third')
    expect(getNextSupportConversationId(ids, 'missing', 1)).toBe('first')
    expect(getNextSupportConversationId([], null, 1)).toBeNull()
  })

  it('recognizes editable fields and their descendants', () => {
    expect(isSupportShortcutEditableTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true)
    expect(isSupportShortcutEditableTarget({ tagName: 'textarea' } as unknown as EventTarget)).toBe(true)
    expect(isSupportShortcutEditableTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true)
    expect(isSupportShortcutEditableTarget({ isContentEditable: true } as unknown as EventTarget)).toBe(true)
    expect(isSupportShortcutEditableTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(true)
    expect(isSupportShortcutEditableTarget({ tagName: 'DIV', closest: () => ({}) } as unknown as EventTarget)).toBe(true)
    expect(isSupportShortcutEditableTarget(null)).toBe(false)
  })
})
