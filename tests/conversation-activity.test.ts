import { describe, expect, it } from 'vitest'

import {
  diffConversationPatch,
  recordConversationActivity,
  type ConversationChange,
} from '../server/utils/conversation-activity'

/**
 * Same approach as `support-counter.test.ts`: the function takes `tx` as a
 * parameter, so a hand-rolled fake stands in rather than mocking the
 * database module.
 */

function fakeTx(selectResults: unknown[][] = []) {
  const inserted: unknown[] = []
  let selectCalls = 0

  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectResults[selectCalls++] ?? []),
        }),
      }),
    }),
    insert: () => ({
      values: (values: unknown) => {
        inserted.push(values)
        return Promise.resolve()
      },
    }),
  }

  return { tx, inserted }
}

async function bodies(changes: ConversationChange[], selectResults: unknown[][] = []) {
  const { tx, inserted } = fakeTx(selectResults)
  await recordConversationActivity(tx as any, 'conv1', changes, 'actor1')
  return inserted as { body: string; kind: string; senderKind: string; senderUserId: string; isPrivate: boolean }[]
}

describe('recordConversationActivity', () => {
  it('does nothing for an empty change set', async () => {
    const rows = await bodies([])
    expect(rows).toEqual([])
  })

  it('describes a status change', async () => {
    const rows = await bodies([{ field: 'status', from: 'open', to: 'resolved' }])
    expect(rows[0].body).toBe('Status changed from open to resolved.')
  })

  it('describes priority being set', async () => {
    const rows = await bodies([{ field: 'priority', from: null, to: 'high' }])
    expect(rows[0].body).toBe('Priority set to high.')
  })

  it('describes priority being cleared', async () => {
    const rows = await bodies([{ field: 'priority', from: 'high', to: null }])
    expect(rows[0].body).toBe('Priority cleared.')
  })

  it('describes an assignment, looking up the display name', async () => {
    const rows = await bodies([{ field: 'assigneeUserId', from: null, to: 'u1' }], [[{ name: 'Jane' }]])
    expect(rows[0].body).toBe('Assigned to Jane.')
  })

  it('falls back to the id when the assignee lookup misses', async () => {
    const rows = await bodies([{ field: 'assigneeUserId', from: null, to: 'u1' }], [[]])
    expect(rows[0].body).toBe('Assigned to u1.')
  })

  it('describes unassignment', async () => {
    const rows = await bodies([{ field: 'assigneeUserId', from: 'u1', to: null }])
    expect(rows[0].body).toBe('Unassigned.')
  })

  it('describes a product being set, looking up the project name', async () => {
    const rows = await bodies([{ field: 'projectId', from: null, to: 'p1' }], [[{ name: 'Billing' }]])
    expect(rows[0].body).toBe('Product set to Billing.')
  })

  it('describes a product being cleared', async () => {
    const rows = await bodies([{ field: 'projectId', from: 'p1', to: null }])
    expect(rows[0].body).toBe('Product cleared.')
  })

  it('inserts one activity row per change, all private and attributed to the actor', async () => {
    const rows = await bodies(
      [
        { field: 'status', from: 'open', to: 'pending' },
        { field: 'priority', from: null, to: 'urgent' },
      ],
      []
    )

    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.kind).toBe('activity')
      expect(row.senderKind).toBe('system')
      expect(row.senderUserId).toBe('actor1')
      expect(row.isPrivate).toBe(true)
    }
  })
})

describe('diffConversationPatch', () => {
  const now = new Date('2026-08-15T12:00:00.000Z')
  const open = { status: 'open', priority: null, assigneeUserId: null, subject: 'Broken login', projectId: null }

  it('treats an empty patch as no change', () => {
    const { changes, updates } = diffConversationPatch(open, {}, now)
    expect(changes).toEqual([])
    expect(updates).toEqual({})
  })

  it('ignores a field whose value is unchanged', () => {
    const { changes, updates } = diffConversationPatch(open, { status: 'open' }, now)
    expect(changes).toEqual([])
    expect(updates).toEqual({})
  })

  it('records a changed field once, with both sides', () => {
    const { changes, updates } = diffConversationPatch(open, { status: 'resolved' }, now)
    expect(changes).toEqual([{ field: 'status', from: 'open', to: 'resolved' }])
    expect(updates.status).toBe('resolved')
  })

  it('distinguishes an absent field from an explicit null', () => {
    const assigned = { ...open, assigneeUserId: 'u1' }

    // Absent - untouched.
    expect(diffConversationPatch(assigned, {}, now).changes).toEqual([])

    // Explicitly null - an unassignment, which is a real change.
    expect(diffConversationPatch(assigned, { assigneeUserId: null }, now).changes).toEqual([
      { field: 'assigneeUserId', from: 'u1', to: null },
    ])
  })

  it('updates the subject without recording it as an activity change', () => {
    const { changes, updates } = diffConversationPatch(open, { subject: 'Cannot sign in' }, now)
    expect(changes).toEqual([])
    expect(updates.subject).toBe('Cannot sign in')
  })

  it('stamps resolvedAt on resolve and on close', () => {
    expect(diffConversationPatch(open, { status: 'resolved' }, now).updates.resolvedAt).toBe(now)
    expect(diffConversationPatch(open, { status: 'closed' }, now).updates.resolvedAt).toBe(now)
  })

  it('clears resolvedAt when a resolved conversation is reopened', () => {
    const resolved = { ...open, status: 'resolved' }
    expect(diffConversationPatch(resolved, { status: 'open' }, now).updates.resolvedAt).toBeNull()
  })

  it('leaves resolvedAt alone when status is not part of the patch', () => {
    const { updates } = diffConversationPatch(open, { priority: 'high' }, now)
    expect('resolvedAt' in updates).toBe(false)
  })

  it('records several changes from one patch', () => {
    const { changes } = diffConversationPatch(open, { status: 'pending', priority: 'high', projectId: 'p1' }, now)
    expect(changes.map((c) => c.field)).toEqual(['status', 'priority', 'projectId'])
  })
})
