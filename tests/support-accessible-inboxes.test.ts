import { describe, expect, it, vi } from 'vitest'
import { listAccessibleInboxes } from '~/server/utils/support-access'

const state = vi.hoisted(() => ({
  inboxes: [] as Array<{ id: string; projectId: string }>,
  memberships: [] as Array<{ inboxId: string; role: string }>,
  calls: 0,
}))

vi.mock('~/server/database/drizzle', () => ({ db: {} }))

function executor() {
  return {
    select: () => {
      const call = state.calls++
      const chain = {
        from: () => chain,
        where: async () => (call === 0 ? state.inboxes : state.memberships),
      }
      return chain
    },
  } as never
}

describe('listAccessibleInboxes', () => {
  it('gives project admins every inbox and members only their own', async () => {
    state.calls = 0
    state.inboxes = [
      { id: 'i1', projectId: 'pA' },
      { id: 'i2', projectId: 'pB' },
      { id: 'i3', projectId: 'pB' },
    ]
    state.memberships = [{ inboxId: 'i2', role: 'agent' }]
    const result = await listAccessibleInboxes(
      'u1',
      [
        { id: 'pA', role: 'admin' },
        { id: 'pB', role: 'member' },
      ],
      executor()
    )
    expect(result.map((i) => [i.id, i.effectiveRole, i.isProjectAdmin])).toEqual([
      ['i1', 'admin', true],
      ['i2', 'agent', false],
    ])
  })

  it('returns nothing without projects', async () => {
    expect(await listAccessibleInboxes('u1', [], executor())).toEqual([])
  })
})
