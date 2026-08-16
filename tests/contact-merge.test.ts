import { describe, expect, it } from 'vitest'

import {
  backfillContactFields,
  canMerge,
  canUpdateContact,
  mergeAttributes,
  type MergeableContact,
} from '../server/utils/contact-merge'

function contact(overrides: Partial<MergeableContact> = {}): MergeableContact {
  return {
    id: 'c1',
    teamId: 't1',
    mergedIntoContactId: null,
    attributes: null,
    name: null,
    email: null,
    phone: null,
    companyId: null,
    ...overrides,
  }
}

describe('canMerge', () => {
  it('allows two distinct unmerged contacts in the same team', () => {
    expect(canMerge(contact({ id: 'a' }), contact({ id: 'b' }))).toEqual({ ok: true })
  })

  it('refuses merging a contact into itself', () => {
    expect(canMerge(contact({ id: 'a' }), contact({ id: 'a' }))).toEqual({
      ok: false,
      reason: 'A contact cannot be merged into itself',
    })
  })

  it('refuses merging across teams', () => {
    // The tenant-isolation guard: both ids come from the request, so having
    // access to one proves nothing about the other's team.
    expect(canMerge(contact({ id: 'a', teamId: 't1' }), contact({ id: 'b', teamId: 't2' }))).toEqual({
      ok: false,
      reason: 'Contacts belong to different teams',
    })
  })

  it('refuses a source that was already merged', () => {
    expect(canMerge(contact({ id: 'a' }), contact({ id: 'b', mergedIntoContactId: 'c' }))).toMatchObject({
      ok: false,
    })
  })

  it('refuses a target that was already merged', () => {
    // Merging into a tombstone would strand the rows on a contact nothing shows.
    expect(canMerge(contact({ id: 'a', mergedIntoContactId: 'z' }), contact({ id: 'b' }))).toMatchObject({
      ok: false,
    })
  })
})

describe('canUpdateContact', () => {
  it('rejects a tombstone after a concurrent merge', () => {
    expect(canUpdateContact(contact({ mergedIntoContactId: 'survivor' }))).toEqual({
      ok: false,
      reason: 'Contact has already been merged',
    })
  })

  it('allows an active contact to be updated', () => {
    expect(canUpdateContact(contact())).toEqual({ ok: true })
  })
})

describe('mergeAttributes', () => {
  it('keeps the survivor value on a key collision', () => {
    expect(mergeAttributes({ plan: 'pro' }, { plan: 'free' })).toEqual({ plan: 'pro' })
  })

  it('carries over keys only the loser had', () => {
    expect(mergeAttributes({ plan: 'pro' }, { seats: 12 })).toEqual({ plan: 'pro', seats: 12 })
  })

  it('handles either side being absent', () => {
    expect(mergeAttributes(null, { seats: 12 })).toEqual({ seats: 12 })
    expect(mergeAttributes({ plan: 'pro' }, null)).toEqual({ plan: 'pro' })
    expect(mergeAttributes(null, null)).toBeNull()
  })

  it('does not mutate its inputs', () => {
    const survivor = { plan: 'pro' }
    const loser = { seats: 12 }
    mergeAttributes(survivor, loser)
    expect(survivor).toEqual({ plan: 'pro' })
    expect(loser).toEqual({ seats: 12 })
  })
})

describe('backfillContactFields', () => {
  it('fills blanks from the loser', () => {
    const result = backfillContactFields(contact({ id: 'a' }), contact({ id: 'b', name: 'Ada', phone: '123' }))
    expect(result).toMatchObject({ name: 'Ada', phone: '123' })
  })

  it('never overwrites a value the survivor already has', () => {
    // The survivor is what the agent was looking at when they chose it; a merge
    // silently renaming it would be alarming.
    const result = backfillContactFields(
      contact({ id: 'a', name: 'Grace', companyId: 'co1' }),
      contact({ id: 'b', name: 'Ada', companyId: 'co2' })
    )
    expect(result).toMatchObject({ name: 'Grace', companyId: 'co1' })
  })

  it('does not touch email', () => {
    // email is uniquely indexed per team and mirrored by a contactIdentity row,
    // so changing it here would collide or desync.
    const result = backfillContactFields(contact({ id: 'a' }), contact({ id: 'b', email: 'ada@example.com' }))
    expect(result).not.toHaveProperty('email')
  })
})
