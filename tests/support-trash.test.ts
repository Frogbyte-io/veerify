import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import {
  CONVERSATION_LIST_VIEWS,
  TRASH_RETENTION_DAYS,
  diffFolderPatch,
  folderCondition,
  folderForView,
} from '../server/utils/support-trash'
import { getSupportShortcutAction } from '../lib/support-keyboard-shortcuts'

const now = new Date('2026-10-29T10:00:00.000Z')
const dialect = new PgDialect()
const render = (view: Parameters<typeof folderCondition>[0]) => dialect.sqlToQuery(folderCondition(view)!).sql

describe('diffFolderPatch', () => {
  it('stamps spamAt and deletedAt, and clears them again', () => {
    expect(diffFolderPatch({}, { spam: true }, now)).toEqual({
      changes: [{ field: 'spam', to: true }],
      updates: { spamAt: now },
    })
    expect(diffFolderPatch({ deletedAt: now }, { deleted: false }, now)).toEqual({
      changes: [{ field: 'deleted', to: false }],
      updates: { deletedAt: null },
    })
  })

  it('treats re-sending the current state as no change', () => {
    expect(diffFolderPatch({ spamAt: now }, { spam: true }, now).changes).toEqual([])
    expect(diffFolderPatch({}, { deleted: false, spam: false }, now).changes).toEqual([])
  })

  it('leaves a field alone when it is absent from the patch', () => {
    expect(diffFolderPatch({ spamAt: now }, {}, now)).toEqual({ changes: [], updates: {} })
  })
})

describe('list folders', () => {
  it('maps views to folders', () => {
    expect(folderForView('spam')).toBe('spam')
    expect(folderForView('trash')).toBe('trash')
    for (const view of ['unassigned', 'assigned-to-me', 'resolved', 'breaching-soon', 'archived', 'all', undefined]) {
      expect(folderForView(view as never)).toBe('normal')
    }
    expect(CONVERSATION_LIST_VIEWS).toEqual(expect.arrayContaining(['archived', 'spam', 'trash']))
  })

  it('hides spam and trash from normal views, and trash from the spam view', () => {
    expect(render('unassigned')).toBe('("conversation"."spam_at" is null and "conversation"."deleted_at" is null)')
    expect(render(undefined)).toBe(render('all'))
    expect(render('spam')).toBe('("conversation"."spam_at" is not null and "conversation"."deleted_at" is null)')
    expect(render('trash')).toBe('"conversation"."deleted_at" is not null')
  })

  it('keeps conversations for 30 days', () => {
    expect(TRASH_RETENTION_DAYS).toBe(30)
  })
})

describe('keyboard shortcuts', () => {
  it('maps # to delete and ! to spam', () => {
    expect(getSupportShortcutAction('#')).toBe('delete')
    expect(getSupportShortcutAction('!')).toBe('spam')
  })
})
