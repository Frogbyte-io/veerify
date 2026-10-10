import { syncSearchConsole } from '~/server/services/marketing/search/sync'
import { defineScheduledTask } from '../registry'

export const MARKETING_SEARCH_SYNC_TASK_NAME = 'marketing:search-sync'

export const marketingSearchSyncTask = defineScheduledTask(MARKETING_SEARCH_SYNC_TASK_NAME, '20 * * * *', () =>
  syncSearchConsole()
)
