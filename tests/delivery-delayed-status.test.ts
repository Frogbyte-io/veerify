import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const metrics = vi.hoisted(() => ({ recordSupportMetric: vi.fn() }))
vi.mock('~/server/utils/support-observability', () => metrics)
vi.mock('~/server/database/drizzle', () => ({ db: {} }))

const { applyDeliveryEventStatus } = await import('../server/utils/delivery-events')
const { markDeliveryMessageDelayed } = await import('../server/utils/delivery-status')

/** Records what one guarded update sets and filters on; `matches` is what the database would return. */
function executor(matches: boolean) {
  const calls: Array<{ set: Record<string, unknown>; where: string; params: unknown[] }> = []
  const dialect = new PgDialect()
  const exec = {
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: SQL) => ({
          returning: async () => {
            const query = dialect.sqlToQuery(where)
            calls.push({ set, where: query.sql, params: query.params })
            return matches ? [{ id: 'msg-1' }] : []
          },
        }),
      }),
    }),
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
  }
  return { exec: exec as never, calls, insert: exec.insert }
}

describe('temporary failures (temporary_fail / soft bounce)', () => {
  it('marks a sent reply delayed, keeping the provider text', async () => {
    const { exec, calls, insert } = executor(true)
    const changed = await applyDeliveryEventStatus(exec, {
      messageId: 'msg-1',
      conversationId: 'conv-1',
      recordType: 'bounced',
      bounceType: 'soft',
      description: '452 4.2.2 Mailbox full, try later',
    })

    expect(changed).toBe(true)
    expect(calls[0].set).toEqual({ deliveryStatus: 'delayed', deliveryError: '452 4.2.2 Mailbox full, try later' })
    // Only `sent` (or an earlier `delayed`) moves: never delivered, bounced, failed or pending.
    expect(calls[0].where).toContain('"delivery_status" in')
    expect(calls[0].params).toEqual(['msg-1', 'sent', 'delayed'])
    // Not final: no "Delivery failed" activity line.
    expect(insert).not.toHaveBeenCalled()
    expect(metrics.recordSupportMetric).toHaveBeenCalledWith('support.delivery.delayed', { messageId: 'msg-1' })
  })

  it('reports no change when the message already reached a final state', async () => {
    const { exec } = executor(false)
    metrics.recordSupportMetric.mockClear()
    expect(await markDeliveryMessageDelayed(exec, 'msg-1', 'deferred')).toBe(false)
    expect(metrics.recordSupportMetric).not.toHaveBeenCalled()
  })

  it('still records a hard bounce as bounced with its activity line', async () => {
    const { exec, calls, insert } = executor(true)
    await applyDeliveryEventStatus(exec, {
      messageId: 'msg-1',
      conversationId: 'conv-1',
      recordType: 'bounced',
      bounceType: 'hard',
      description: '550 5.1.1 user unknown',
    })
    expect(calls[0].set).toEqual({ deliveryStatus: 'bounced', deliveryError: '550 5.1.1 user unknown' })
    expect(insert).toHaveBeenCalledTimes(1)
  })
})
