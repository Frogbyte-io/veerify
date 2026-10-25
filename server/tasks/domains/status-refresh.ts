import { domainsStatusRefreshTask } from '~/server/services/scheduler/tasks/domains-status-refresh'

export default defineTask({
  meta: {
    name: 'domains:status-refresh',
    description: 'Re-check custom board domains against Cloudflare for SaaS.',
  },
  async run() {
    const result = await domainsStatusRefreshTask.handler()
    return { result }
  },
})
