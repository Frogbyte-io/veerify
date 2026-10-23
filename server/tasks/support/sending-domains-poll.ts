import { sendingDomainsPollTask } from '~/server/services/scheduler/tasks/sending-domains-poll'

export default defineTask({
  meta: {
    name: 'support:sending-domains-poll',
    description: 'Register, verify, expire and re-check customer sending domains.',
  },
  async run() {
    const result = await sendingDomainsPollTask.handler()
    return { result }
  },
})
