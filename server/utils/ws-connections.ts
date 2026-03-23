import type { Peer } from 'crossws'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('ws')

/**
 * In-memory map of authenticated userId → Set of connected WebSocket peers.
 * A user can have multiple tabs/devices connected simultaneously.
 */
const userConnections = new Map<string, Set<Peer>>()

/** Register a peer for a userId */
export function addConnection(userId: string, peer: Peer) {
  let peers = userConnections.get(userId)
  if (!peers) {
    peers = new Set()
    userConnections.set(userId, peers)
  }
  peers.add(peer)
  logger.info('WebSocket connected', { userId, totalPeers: peers.size })
}

/** Remove a peer for a userId */
export function removeConnection(userId: string, peer: Peer) {
  const peers = userConnections.get(userId)
  if (peers) {
    peers.delete(peer)
    if (peers.size === 0) {
      userConnections.delete(userId)
    }
    logger.info('WebSocket disconnected', { userId, remainingPeers: peers?.size ?? 0 })
  }
}

/**
 * Send a JSON message to all connected peers for a given userId.
 * Returns the number of peers the message was sent to.
 */
export function sendToUser(userId: string, data: Record<string, any>): number {
  const peers = userConnections.get(userId)
  if (!peers || peers.size === 0) return 0

  const message = JSON.stringify(data)
  let sent = 0
  for (const peer of peers) {
    try {
      peer.send(message)
      sent++
    } catch (err) {
      logger.error('Failed to send WS message', {
        userId,
        error: err instanceof Error ? err.message : err,
      })
    }
  }
  return sent
}
