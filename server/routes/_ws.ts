import { auth } from '~/lib/auth'
import { addConnection, removeConnection } from '~/server/utils/ws-connections'
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

      addConnection(session.user.id, peer)
      peer.send(JSON.stringify({ type: 'connected', userId: session.user.id }))
    } catch (err) {
      logger.error('WS auth failed', { error: err instanceof Error ? err.message : err })
      peer.send(JSON.stringify({ type: 'error', message: 'Auth failed' }))
      peer.close(4001, 'Auth failed')
    }
  },

  message(peer, message) {
    // Handle ping/pong for keep-alive
    const text = message.text()
    if (text === 'ping') {
      peer.send('pong')
    }
  },

  close(peer) {
    const userId = typeof peer.context.userId === 'string' ? peer.context.userId : null
    if (userId) {
      removeConnection(userId, peer)
    }
  },

  error(peer, error) {
    const userId = typeof peer.context.userId === 'string' ? peer.context.userId : null
    logger.error('WS error', { userId, error: error?.message })
    if (userId) {
      removeConnection(userId, peer)
    }
  },
})
