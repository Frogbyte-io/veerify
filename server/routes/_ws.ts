import { and, eq, gt } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { session as sessionTable } from '~/server/database/schema/auth'
import { removePeerFromAllChannels, subscribePeer, unsubscribePeer } from '~/server/utils/ws-connections'
import { userChannel } from '~/server/services/realtime'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('ws')

/**
 * Resolve a session directly from its opaque token.
 *
 * Deliberately not `auth.api.getSession()` with a bearer header. Making Better
 * Auth accept `Authorization: Bearer <session-token>` requires the `bearer`
 * plugin, which is global: it would turn this token into a credential for every
 * API route. That is not a theoretical widening - the client hands this exact
 * value to `buildUrl()` in `plugins/realtime.client.ts`, which puts it in a
 * WebSocket URL query string, and proxies, CDNs, and load balancers log query
 * strings by default. Anyone who can read an access log could then replay it
 * against the whole API.
 *
 * Resolving the token here keeps its blast radius to the realtime transport,
 * which is the only thing that ever needed it.
 */
async function resolveSessionByToken(token: string): Promise<{ userId: string } | null> {
  const [row] = await db
    .select({ userId: sessionTable.userId })
    .from(sessionTable)
    .where(and(eq(sessionTable.token, token), gt(sessionTable.expiresAt, new Date())))
    .limit(1)

  return row ?? null
}

export default defineWebSocketHandler({
  async open(peer) {
    // Authenticate via token passed as query parameter
    // The client sends: ws://host/_ws?token=<session-token>
    const url = peer.request?.url || peer.websocket.url
    let token: string | null = null

    if (url) {
      try {
        const parsed = new URL(url, 'http://localhost')
        token = parsed.searchParams.get('token')
      } catch {
        // URL parsing failed
      }
    }

    if (!token) {
      peer.send(JSON.stringify({ type: 'error', message: 'Missing auth token' }))
      peer.close(4001, 'Missing auth token')
      return
    }

    try {
      const session = await resolveSessionByToken(token)

      if (!session) {
        peer.send(JSON.stringify({ type: 'error', message: 'Invalid session' }))
        peer.close(4001, 'Invalid session')
        return
      }

      // Store userId on the peer context for later use
      peer.context.userId = session.userId

      logger.info('WebSocket connected', { userId: session.userId })

      // Every peer listens to its own user channel automatically. Doing it here
      // rather than making the client ask means the client never has to know or
      // send its own user id, and the subscription cannot be spoofed — the id
      // comes from the validated session, not from the wire.
      await subscribePeer(peer, userChannel(session.userId), session.userId)

      peer.send(JSON.stringify({ type: 'connected', userId: session.userId }))
    } catch (err) {
      logger.error('WS auth failed', { error: err instanceof Error ? err.message : err })
      peer.send(JSON.stringify({ type: 'error', message: 'Auth failed' }))
      peer.close(4001, 'Auth failed')
    }
  },

  async message(peer, message) {
    // Handle ping/pong for keep-alive
    const text = message.text()
    if (text === 'ping') {
      peer.send('pong')
      return
    }

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(text)
    } catch {
      // Non-JSON frames are ignored rather than closing the socket.
      return
    }

    if (!payload || typeof payload !== 'object') return

    const userId = typeof peer.context.userId === 'string' ? peer.context.userId : null
    if (!userId) return

    const channel = typeof payload.channel === 'string' ? payload.channel : null
    if (!channel) return

    if (payload.action === 'subscribe') {
      const result = await subscribePeer(peer, channel, userId)
      peer.send(
        JSON.stringify(
          result.ok ? { type: 'subscribed', channel } : { type: 'subscribe_error', channel, reason: result.reason }
        )
      )
      return
    }

    if (payload.action === 'unsubscribe') {
      await unsubscribePeer(peer, channel)
      peer.send(JSON.stringify({ type: 'unsubscribed', channel }))
    }
  },

  async close(peer) {
    const userId = typeof peer.context.userId === 'string' ? peer.context.userId : null
    logger.info('WebSocket disconnected', { userId })
    await removePeerFromAllChannels(peer)
  },

  async error(peer, error) {
    const userId = typeof peer.context.userId === 'string' ? peer.context.userId : null
    logger.error('WS error', { userId, error: error?.message })
    await removePeerFromAllChannels(peer)
  },
})
