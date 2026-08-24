import { outboundDeliveryTask } from '~/server/services/scheduler/tasks/outbound-delivery'

export default defineTask({
  meta: {
    name: 'support:outbound-delivery',
    description: 'Run a bounded recurring pass over pending support outbound deliveries.',
  },
  async run() {
    const result = await outboundDeliveryTask.handler()
    return { result }
  },
})
