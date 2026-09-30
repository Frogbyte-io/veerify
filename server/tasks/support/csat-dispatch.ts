import { csatDispatchTask } from '~/server/services/scheduler/tasks/csat-dispatch'

export default defineTask({
  meta: {
    name: 'support:csat-dispatch',
    description: 'Dispatch due customer satisfaction surveys through the durable outbound queue.',
  },
  async run() {
    const result = await csatDispatchTask.handler()
    return { result }
  },
})
