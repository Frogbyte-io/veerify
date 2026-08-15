import { describe, expect, it } from 'vitest'

import { allocateConversationDisplayId } from '../server/utils/support-counter'

/**
 * `allocateConversationDisplayId` takes its transaction as a parameter, so
 * unlike `support-access.ts` there is no module to mock: a hand-rolled fake
 * `tx` exercises each branch directly. True concurrent-allocation behavior
 * (the `SELECT … FOR UPDATE` row lock actually serializing) needs a real
 * Postgres connection and is covered separately by the guarded integration
 * test in `tests/integration/support-counter.test.ts`.
 */

interface FakeTxOptions {
  selectResults: unknown[][]
  insertResults?: unknown[][]
}

function fakeTx({ selectResults, insertResults = [] }: FakeTxOptions) {
  const updates: unknown[] = []
  let selectCalls = 0
  let insertCalls = 0

  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: () => Promise.resolve(selectResults[selectCalls++] ?? []),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve(insertResults[insertCalls++] ?? []),
        }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        updates.push(values)
        return { where: () => Promise.resolve() }
      },
    }),
  }

  return { tx, updates }
}

describe('allocateConversationDisplayId', () => {
  it('allocates the current value and increments the existing row', async () => {
    const { tx, updates } = fakeTx({ selectResults: [[{ teamId: 't1', nextConversationDisplayId: 5 }]] })

    await expect(allocateConversationDisplayId(tx as any, 't1')).resolves.toBe(5)
    expect(updates).toEqual([{ nextConversationDisplayId: 6 }])
  })

  it('allocates 1 and creates the counter row when none exists yet', async () => {
    const { tx, updates } = fakeTx({
      selectResults: [[]],
      insertResults: [[{ teamId: 't1' }]],
    })

    await expect(allocateConversationDisplayId(tx as any, 't1')).resolves.toBe(1)
    // The insert already seeds nextConversationDisplayId to 2 - no separate
    // update is needed to "spend" the first allocation.
    expect(updates).toEqual([])
  })

  it('falls back to locking the row when it loses the bootstrap race', async () => {
    // Two transactions raced to create the row for the same team; this one's
    // INSERT ... ON CONFLICT DO NOTHING found the other had already won.
    const { tx, updates } = fakeTx({
      selectResults: [[], [{ teamId: 't1', nextConversationDisplayId: 7 }]],
      insertResults: [[]],
    })

    await expect(allocateConversationDisplayId(tx as any, 't1')).resolves.toBe(7)
    expect(updates).toEqual([{ nextConversationDisplayId: 8 }])
  })

  it('throws if the row is gone by the fallback re-select', async () => {
    const { tx } = fakeTx({
      selectResults: [[], []],
      insertResults: [[]],
    })

    await expect(allocateConversationDisplayId(tx as any, 't1')).rejects.toThrow('vanished')
  })
})
