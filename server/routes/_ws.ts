import { auth } from '~/lib/auth'
import { removePeerFromAllChannels, subscribePeer, unsubscribePeer } from '~/server/utils/ws-connections'
import { userChannel } from '~/server/services/realtime'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('ws')

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
      // Validate session token using Better-Auth
      const session = await auth.api.getSession({
        headers: new Headers({ Authorization: `Bearer ${token}` }),
      })

      if (!session?.user) {
        peer.send(JSON.stringify({ type: 'error', message: 'Invalid session' }))
        peer.close(4001, 'Invalid session')
        return
      }

      // Store userId on the peer context for later use
      peer.context.userId = session.user.id

      logger.info('WebSocket connected', { userId: session.user.id })

      // Every peer listens to its own user channel automatically. Doing it here
      // rather than making the client ask means the client never has to know or
      // send its own user id, and the subscription cannot be spoofed — the id
      // comes from the validated session, not from the wire.
      await subscribePeer(peer, userChannel(session.user.id), session.user.id)

      peer.send(JSON.stringify({ type: 'connected', userId: session.user.id }))
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
