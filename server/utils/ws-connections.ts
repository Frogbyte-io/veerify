import type { Peer } from 'crossws'
import { createLogger } from '~/server/utils/logger'
import { authorizeChannel } from '~/server/utils/realtime-channels'
import {
  subscribeRealtime,
  unsubscribeRealtime,
  type RealtimeEnvelope,
  type RealtimeHandler,
} from '~/server/services/realtime'

const logger = createLogger('ws')

/* -------------------------------------------------------------------------- */
/* Legacy per-user delivery                                                    */
/* -------------------------------------------------------------------------- */

/**
 * In-memory map of authenticated userId → connected peers.
 *
 * KNOWN LIMITATION: this is process-local, so a notification created on one
 * instance does not reach a peer connected to another. That is why
 * `NotificationBell.vue` keeps its 30-second polling fallback — do not remove it.
 *
 * This path is retained unchanged because `NotificationBell` pushes full
 * notification objects over the wire, which the channel system below
 * deliberately does not allow. Migrating it to thin envelopes plus a client
 * refetch is tracked as SUP-00-9.
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
 * Send a JSON message to all connected peers for a given userId on THIS instance.
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

/* -------------------------------------------------------------------------- */
/* Channel subscriptions                                                       */
/* -------------------------------------------------------------------------- */

/** Upper bound on channels a single peer may join, to bound abuse. */
const MAX_CHANNELS_PER_PEER = 50

/** Peers on this instance listening to a channel. */
const channelPeers = new Map<string, Set<Peer>>()
/** Reverse index, so a disconnect can clean up without scanning every channel. */
const peerChannels = new Map<Peer, Set<string>>()
/** The broker handler registered for a channel, kept so it can be detached. */
const channelHandlers = new Map<string, RealtimeHandler>()

function deliver(envelope: RealtimeEnvelope, channel: string) {
  const peers = channelPeers.get(channel)
  if (!peers || peers.size === 0) return

  // The envelope is nested rather than spread: it carries its own `type`, which
  // would otherwise overwrite the frame type and break client dispatch.
  const message = JSON.stringify({ type: 'event', channel, event: envelope })

  for (const peer of [...peers]) {
    try {
      peer.send(message)
    } catch (err) {
      logger.error('Failed to send channel event', {
        channel,
        error: err instanceof Error ? err.message : err,
      })
    }
  }
}

/**
 * Subscribe a peer to a channel after checking it is allowed to listen.
 *
 * The broker subscription is created once per channel per instance, however many
 * local peers are listening — so Redis connection count scales with instances,
 * not with connected agents.
 */
export async function subscribePeer(
  peer: Peer,
  channel: string,
  userId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // A peer that asks for unbounded channels would force one authorization query
  // per request and one broker subscription per channel. Cap it.
  const existing = peerChannels.get(peer)
  if (existing && !existing.has(channel) && existing.size >= MAX_CHANNELS_PER_PEER) {
    logger.warn('Rejected channel subscription: peer channel limit reached', { channel, userId })
    return { ok: false, reason: 'Too many channel subscriptions' }
  }

  const auth = await authorizeChannel(channel, userId)
  if (!auth.allowed) {
    logger.warn('Rejected channel subscription', { channel, userId, reason: auth.reason })
    return { ok: false, reason: auth.reason }
  }

  let peers = channelPeers.get(channel)
  if (!peers) {
    peers = new Set()
    channelPeers.set(channel, peers)

    const handler: RealtimeHandler = (envelope, incomingChannel) => deliver(envelope, incomingChannel)
    channelHandlers.set(channel, handler)
    await subscribeRealtime(channel, handler)
  }
  peers.add(peer)

  let channels = peerChannels.get(peer)
  if (!channels) {
    channels = new Set()
    peerChannels.set(peer, channels)
  }
  channels.add(channel)

  return { ok: true }
}

/** Detach a peer from one channel, releasing the broker subscription if it was the last. */
export async function unsubscribePeer(peer: Peer, channel: string): Promise<void> {
  const peers = channelPeers.get(channel)
  if (peers) {
    peers.delete(peer)

    if (peers.size === 0) {
      channelPeers.delete(channel)
      const handler = channelHandlers.get(channel)
      channelHandlers.delete(channel)
      if (handler) await unsubscribeRealtime(channel, handler)
    }
  }

  const channels = peerChannels.get(peer)
  if (channels) {
    channels.delete(channel)
    if (channels.size === 0) peerChannels.delete(peer)
  }
}

/** Detach a peer from every channel it joined. Call on close and on error. */
export async function removePeerFromAllChannels(peer: Peer): Promise<void> {
  const channels = peerChannels.get(peer)
  if (!channels) return

  for (const channel of [...channels]) {
    await unsubscribePeer(peer, channel)
  }
  peerChannels.delete(peer)
}

/** Channels this peer is currently subscribed to. Exposed for tests and diagnostics. */
export function getPeerChannels(peer: Peer): string[] {
  return [...(peerChannels.get(peer) ?? [])]
}
