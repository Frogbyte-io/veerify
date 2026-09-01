import { runOutboundDeliveryWorker } from '~/server/utils/outbound-delivery'
import { defineScheduledTask } from '../registry'

/** A bounded recurring pass claims only rows whose persisted retry time is due. */
export const OUTBOUND_DELIVERY_TASK_NAME = 'support:outbound-delivery'

export async function runScheduledOutboundDelivery(deps: {
  runWorker?: () => ReturnType<typeof runOutboundDeliveryWorker>
} = {}): Promise<{ processed: number }> {
  const runWorker = deps.runWorker ?? runOutboundDeliveryWorker
  return runWorker()
}

export const outboundDeliveryTask = defineScheduledTask(OUTBOUND_DELIVERY_TASK_NAME, '* * * * *', () =>
  runScheduledOutboundDelivery()
)
