import { registerChangelogPublishedHook } from '~/server/services/changelog/hooks'
import { enqueueForChangelogEntry } from '~/server/services/marketing/reviews'

/**
 * Connects the changelog to Marketing: publishing an entry asks the people
 * whose linked feedback it ships for a review. `enqueueForChangelogEntry`
 * applies the product's review settings, suppressions and cooldown itself, so
 * this is a no-op unless the workspace opted in. Announcement drafts are not
 * generated here on purpose — they spend the workspace's LLM key, so they stay an
 * explicit action on the Announcements page.
 */
export default defineNitroPlugin(() => {
  registerChangelogPublishedHook(async (entry) => {
    await enqueueForChangelogEntry(entry.id)
  })
})
