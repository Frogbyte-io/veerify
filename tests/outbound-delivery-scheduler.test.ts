import { describe, expect, it, vi } from 'vitest'

import { runScheduledOutboundDelivery } from '../server/services/scheduler/tasks/outbound-delivery'

describe('runScheduledOutboundDelivery', () => {
  it('runs one bounded outbox worker pass', async () => {
    const runWorker = vi.fn().mockResolvedValue({ processed: 3 })

    await expect(runScheduledOutboundDelivery({ runWorker })).resolves.toEqual({ processed: 3 })
    expect(runWorker).toHaveBeenCalledTimes(1)
  })
})
