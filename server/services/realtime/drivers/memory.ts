import { parseEnvelope, type RealtimeDriver, type RealtimeEnvelope, type RealtimeHandler } from '../types'

/**
 * In-process realtime driver for tests and single-instance `yarn dev`.
 *
 * Messages are serialized and re-parsed on publish even though they never leave
 * the process. That keeps behaviour identical to the redis driver — handlers
 * always receive a sanitized envelope with no shared object references, so a
 * test that passes here means the same thing over the wire.
 */
export function createMemoryDriver(): RealtimeDriver {
  const channels = new Map<string, Set<RealtimeHandler>>()

  return {
    name: 'memory',

    async publish(channel: string, envelope: RealtimeEnvelope) {
      const handlers = channels.get(channel)
      if (!handlers || handlers.size === 0) return

      const parsed = parseEnvelope(JSON.stringify(envelope))
      if (!parsed) return

      // Copy first: a handler may unsubscribe itself during dispatch.
      for (const handler of [...handlers]) {
        handler(parsed, channel)
      }
    },

    async subscribe(channel: string, handler: RealtimeHandler) {
      let handlers = channels.get(channel)
      if (!handlers) {
        handlers = new Set()
        channels.set(channel, handlers)
      }
      handlers.add(handler)
    },

    async unsubscribe(channel: string, handler: RealtimeHandler) {
      const handlers = channels.get(channel)
      if (!handlers) return
      handlers.delete(handler)
      if (handlers.size === 0) channels.delete(channel)
    },

    async close() {
      channels.clear()
    },
  }
}
