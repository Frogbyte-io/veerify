import { describe, expect, it } from 'vitest'
import { hasUnsavedChanges, isModuleOffMessage, resolveLinkedFeedback, snapshotPayload } from '~/lib/changelog-editor'

const linked = [{ id: 'f1', title: 'One' }]

describe('resolveLinkedFeedback', () => {
  it('keeps the current links when the response has no feedback', () => {
    expect(resolveLinkedFeedback(linked, {})).toBe(linked)
    expect(resolveLinkedFeedback(linked, { feedback: null })).toBe(linked)
  })

  it('uses the response feedback when present, including an empty list', () => {
    expect(resolveLinkedFeedback(linked, { feedback: [] })).toEqual([])
    expect(resolveLinkedFeedback([], { feedback: linked })).toEqual(linked)
  })
})

describe('unsaved changes', () => {
  const base = {
    title: 'T',
    summary: null,
    body: 'b',
    labels: ['new', 'fixed'],
    productIds: ['p1', 'p2'],
    feedbackIds: ['a', 'b'],
  }

  it('is clean before a snapshot exists and right after saving', () => {
    expect(hasUnsavedChanges(base, null)).toBe(false)
    expect(hasUnsavedChanges(base, snapshotPayload(base))).toBe(false)
  })

  it('ignores label and link ordering', () => {
    const snap = snapshotPayload(base)
    expect(
      hasUnsavedChanges({ ...base, labels: ['fixed', 'new'], productIds: ['p2', 'p1'], feedbackIds: ['b', 'a'] }, snap)
    ).toBe(false)
  })

  it('detects edits to any field', () => {
    const snap = snapshotPayload(base)
    expect(hasUnsavedChanges({ ...base, title: 'T2' }, snap)).toBe(true)
    expect(hasUnsavedChanges({ ...base, body: 'x' }, snap)).toBe(true)
    expect(hasUnsavedChanges({ ...base, feedbackIds: ['a'] }, snap)).toBe(true)
    expect(hasUnsavedChanges({ ...base, productIds: [] }, snap)).toBe(true)
  })
})

describe('isModuleOffMessage', () => {
  it('matches the project-level module switch message only', () => {
    expect(isModuleOffMessage('Changelog is not enabled for this project')).toBe(true)
    expect(isModuleOffMessage('Forbidden')).toBe(false)
  })
})
