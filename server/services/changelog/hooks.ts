import type { changelogEntry } from '~/server/database/schema/changelog'
import { logger } from '~/server/utils/logger'

export type ChangelogEntryRow = typeof changelogEntry.$inferSelect
export type ChangelogPublishedHook = (entry: ChangelogEntryRow) => void | Promise<void>

const hooks: ChangelogPublishedHook[] = []

/**
 * Registers a callback run after a changelog entry transitions to published
 * (review requests, announcement drafts, ...). Hooks run sequentially; a hook
 * that throws is logged and skipped, and never blocks publishing.
 * Returns an unregister function.
 */
export function registerChangelogPublishedHook(fn: ChangelogPublishedHook): () => void {
  hooks.push(fn)
  return () => {
    const index = hooks.indexOf(fn)
    if (index >= 0) hooks.splice(index, 1)
  }
}

export async function runChangelogPublishedHooks(entry: ChangelogEntryRow): Promise<void> {
  for (const hook of [...hooks]) {
    try {
      await hook(entry)
    } catch (error) {
      logger.error('Changelog published hook failed', { entryId: entry.id, error })
    }
  }
}

/** Test helper. */
export function clearChangelogPublishedHooks() {
  hooks.length = 0
}
