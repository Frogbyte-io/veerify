import { marketingSearchSyncTask } from '~/server/services/scheduler/tasks/marketing-search-sync'

export default defineTask({
  meta: {
    name: 'marketing:search-sync',
    description: 'Sync Google Search Console clicks, impressions and top queries for connected sites.',
  },
  async run() {
    const result = await marketingSearchSyncTask.handler()
    return { result }
  },
})
