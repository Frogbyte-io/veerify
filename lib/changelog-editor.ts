/** Pure helpers for ChangelogEntryEditor, kept testable outside Vue. */

export interface LinkedFeedbackItem {
  id: string
  title: string
  status?: string
}

/**
 * Linked feedback after applying a server response: a response that carries no
 * `feedback` array must not wipe what the editor already shows (a later save
 * would otherwise send `feedbackIds: []` and unlink everything).
 */
export function resolveLinkedFeedback(
  current: LinkedFeedbackItem[],
  entry: { feedback?: LinkedFeedbackItem[] | null }
): LinkedFeedbackItem[] {
  return Array.isArray(entry.feedback) ? entry.feedback : current
}

export interface EditorPayload {
  title: string
  summary: string | null
  body: string
  labels: string[]
  productIds: string[]
  feedbackIds: string[]
}

/** Stable string used to compare the editor state with the last saved one. */
export function snapshotPayload(payload: EditorPayload): string {
  return JSON.stringify([
    payload.title,
    payload.summary,
    payload.body,
    [...payload.labels].sort(),
    [...(payload.productIds ?? [])].sort(),
    [...payload.feedbackIds].sort(),
  ])
}

export function hasUnsavedChanges(payload: EditorPayload, savedSnapshot: string | null): boolean {
  return savedSnapshot !== null && snapshotPayload(payload) !== savedSnapshot
}

/** The 403 from `requireChangelogAccess` when a module switch is off (vs. a non-member 403). */
export function isModuleOffMessage(message: string): boolean {
  return /^Changelog is not enabled for this project$/.test(message)
}
