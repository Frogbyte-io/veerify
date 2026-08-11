import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AUTH_FAILURE_CLOSE_CODE, RealtimeClient, type RealtimeSocketLike } from '../lib/realtime-client'

/**
 * A minimal fake WebSocket that gives tests explicit control over open/close/
 * message events, so backoff and idle timing can be driven with fake timers
 * instead of real network round-trips.
 */
class FakeSocket implements RealtimeSocketLike {
  static instances: FakeSocket[] = []

  url: string
  readyState = 0 // CONNECTING
  sent: string[] = []
  onopen: ((_event: unknown) => void) | null = null
  onclose: ((_event: { code: number; reason?: string }) => void) | null = null
  onerror: ((_event: unknown) => void) | null = null
  onmessage: ((_event: { data: string }) => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close(code = 1000, reason = '') {
    if (this.readyState === 3) return
    this.readyState = 3
    this.onclose?.({ code, reason })
  }

  // Test helpers, not part of the real WebSocket surface used by the client.
  open() {
    this.readyState = 1
    this.onopen?.({})
  }

  message(data: string) {
    this.onmessage?.({ data })
  }

  /** Simulate the server or network dropping the connection. */
  drop(code = 1006, reason = 'abnormal') {
    this.readyState = 3
    this.onclose?.({ code, reason })
  }
}

function subscribeFrames(socket: FakeSocket) {
  return socket.sent.filter((s) => s.includes('"action":"subscribe"'))
}

function unsubscribeFrames(socket: FakeSocket) {
  return socket.sent.filter((s) => s.includes('"action":"unsubscribe"'))
}

function makeClient(overrides: Partial<ConstructorParameters<typeof RealtimeClient>[0]> = {}) {
  FakeSocket.instances = []
  return new RealtimeClient({
    getToken: () => 'test-token',
    buildUrl: (token) => `wss://example.test/_ws?token=${token}`,
    createSocket: (url) => new FakeSocket(url),
    random: () => 0.5, // midpoint => zero jitter, deterministic backoff delays
    ...overrides,
  })
}

function latestSocket(): FakeSocket {
  return FakeSocket.instances[FakeSocket.instances.length - 1]
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('RealtimeClient — connection and dispatch', () => {
  it('connects using the resolved token and configured URL builder', async () => {
    const client = makeClient()
    client.connect()
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    expect(latestSocket().url).toBe('wss://example.test/_ws?token=test-token')
  })

  it('dispatches event frames with the envelope nested under `event`, not spread (D-02)', async () => {
    const client = makeClient()
    const onEvent = vi.fn()
    client.subscribe('team:t1', { onEvent })
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    const socket = latestSocket()
    socket.open()

    socket.message(
      JSON.stringify({
        type: 'event',
        channel: 'team:t1',
        event: { v: 1, type: 'conversation.updated', teamId: 't1' },
      })
    )

    expect(onEvent).toHaveBeenCalledWith({ v: 1, type: 'conversation.updated', teamId: 't1' }, 'team:t1')
  })

  it('ignores legacy `notification` frames entirely', async () => {
    const client = makeClient()
    const onEvent = vi.fn()
    client.subscribe('team:t1', { onEvent })
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    const socket = latestSocket()
    socket.open()

    expect(() => socket.message(JSON.stringify({ type: 'notification', data: { id: 'n1' } }))).not.toThrow()
    expect(onEvent).not.toHaveBeenCalled()
  })
})

describe('RealtimeClient — reference counting', () => {
  it('sends only one subscribe frame for two subscribers on the same channel, and unsubscribing one does not affect the other', async () => {
    const client = makeClient()
    const onEventA = vi.fn()
    const onEventB = vi.fn()

    const unsubA = client.subscribe('team:t1', { onEvent: onEventA })
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    const socket = latestSocket()
    socket.open()

    const unsubB = client.subscribe('team:t1', { onEvent: onEventB })

    expect(subscribeFrames(socket)).toHaveLength(1)

    // Both still receive events while both are subscribed.
    socket.message(JSON.stringify({ type: 'event', channel: 'team:t1', event: { v: 1, type: 'x', teamId: 't1' } }))
    expect(onEventA).toHaveBeenCalledTimes(1)
    expect(onEventB).toHaveBeenCalledTimes(1)

    // Unsubscribing one does not send an unsubscribe frame or break the other.
    unsubA()
    expect(unsubscribeFrames(socket)).toHaveLength(0)

    socket.message(JSON.stringify({ type: 'event', channel: 'team:t1', event: { v: 1, type: 'y', teamId: 't1' } }))
    expect(onEventA).toHaveBeenCalledTimes(1) // unchanged
    expect(onEventB).toHaveBeenCalledTimes(2)

    // Unsubscribing the last listener releases the wire subscription.
    unsubB()
    expect(unsubscribeFrames(socket)).toHaveLength(1)
  })
})

describe('RealtimeClient — resubscribe on reconnect', () => {
  it('resubscribes all previously held channels on a new socket without the caller re-registering', async () => {
    const client = makeClient()
    client.subscribe('team:t1')
    client.subscribe('team:t2')
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    const first = latestSocket()
    first.open()
    expect(subscribeFrames(first).sort()).toEqual(
      [
        JSON.stringify({ action: 'subscribe', channel: 'team:t1' }),
        JSON.stringify({ action: 'subscribe', channel: 'team:t2' }),
      ].sort()
    )

    // Connection drops (function-duration close, network blip, etc).
    first.drop()

    // Backoff schedules the reconnect; advance past the first delay.
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2))
    const second = latestSocket()
    expect(second).not.toBe(first)
    second.open()

    expect(subscribeFrames(second).sort()).toEqual(
      [
        JSON.stringify({ action: 'subscribe', channel: 'team:t1' }),
        JSON.stringify({ action: 'subscribe', channel: 'team:t2' }),
      ].sort()
    )
  })

  it('fires onReconnect hooks after a reconnect, but not on the initial connect', async () => {
    const client = makeClient()
    const onReconnect = vi.fn()
    client.onReconnect(onReconnect)

    client.subscribe('team:t1')
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    const first = latestSocket()
    first.open()
    expect(onReconnect).not.toHaveBeenCalled()

    first.drop()
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2))
    latestSocket().open()

    expect(onReconnect).toHaveBeenCalledTimes(1)
  })
})

describe('RealtimeClient — backoff schedule', () => {
  it('grows the reconnect delay exponentially and caps it, with zero jitter at random()=0.5', async () => {
    const client = makeClient({ backoff: { baseMs: 1000, maxMs: 8000, factor: 2, jitterRatio: 0.5 } })
    client.connect()
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1))

    // 1st drop -> ~1000ms
    latestSocket().drop()
    await vi.advanceTimersByTimeAsync(999)
    expect(FakeSocket.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2))

    // 2nd drop -> ~2000ms
    latestSocket().drop()
    await vi.advanceTimersByTimeAsync(1999)
    expect(FakeSocket.instances).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(3))

    // 3rd drop -> ~4000ms
    latestSocket().drop()
    await vi.advanceTimersByTimeAsync(3999)
    expect(FakeSocket.instances).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(4))

    // 4th drop -> would be 8000ms uncapped, but factor^3=8000 already equals maxMs; capped stays 8000ms
    latestSocket().drop()
    await vi.advanceTimersByTimeAsync(7999)
    expect(FakeSocket.instances).toHaveLength(4)
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(5))
  })

  it('does not treat a routine reconnect as an error condition — no auth-failure hook fires', async () => {
    const client = makeClient()
    const onAuthFailure = vi.fn()
    client.onAuthFailure(onAuthFailure)
    client.connect()
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1))

    latestSocket().drop(1006, 'function max duration')
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2))

    expect(onAuthFailure).not.toHaveBeenCalled()
  })
})

describe('RealtimeClient — subscribe_error', () => {
  it('surfaces subscribe_error to the caller and does not retry it automatically within the connection', async () => {
    const client = makeClient()
    const onSubscribeError = vi.fn()
    client.subscribe('inbox:i1', { onSubscribeError })
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    const socket = latestSocket()
    socket.open()
    expect(subscribeFrames(socket)).toHaveLength(1)

    socket.message(
      JSON.stringify({ type: 'subscribe_error', channel: 'inbox:i1', reason: 'Support channels are not available yet' })
    )

    expect(onSubscribeError).toHaveBeenCalledWith('Support channels are not available yet', 'inbox:i1')
    // No further subscribe frame was sent in response to the denial.
    expect(subscribeFrames(socket)).toHaveLength(1)
  })
})

describe('RealtimeClient — auth failure (4001)', () => {
  it('does not schedule a reconnect after a 4001 close', async () => {
    const client = makeClient()
    const onAuthFailure = vi.fn()
    client.onAuthFailure(onAuthFailure)
    client.connect()
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1))

    latestSocket().drop(AUTH_FAILURE_CLOSE_CODE, 'Auth failed')
    expect(onAuthFailure).toHaveBeenCalledTimes(1)
    expect(client.state).toBe('auth-failed')

    // Advance well past any plausible backoff window — still no new socket.
    await vi.advanceTimersByTimeAsync(60000)
    expect(FakeSocket.instances).toHaveLength(1)

    // Even an explicit connect() call after auth failure is a no-op.
    client.connect()
    await vi.advanceTimersByTimeAsync(60000)
    expect(FakeSocket.instances).toHaveLength(1)
  })
})

describe('RealtimeClient — idle disconnect', () => {
  it('closes the socket after the idle timeout and does not auto-reconnect while hidden', async () => {
    const client = makeClient({ idleTimeoutMs: 5 * 60 * 1000 })
    client.connect()
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    const socket = latestSocket()
    socket.open()

    client.notifyHidden()
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1)
    expect(socket.readyState).toBe(1) // still open just before the deadline

    await vi.advanceTimersByTimeAsync(1)
    expect(socket.readyState).toBe(3) // closed at the deadline

    // No reconnect attempt while still hidden.
    await vi.advanceTimersByTimeAsync(60000)
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('reconnects and fires onReconnect (refetch) immediately on notifyVisible, bypassing backoff', async () => {
    const client = makeClient({ idleTimeoutMs: 5 * 60 * 1000 })
    const onReconnect = vi.fn()
    client.onReconnect(onReconnect)
    client.connect()
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    latestSocket().open()

    client.notifyHidden()
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(FakeSocket.instances).toHaveLength(1) // idle-closed, no new socket yet

    client.notifyVisible()
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2))
    latestSocket().open()

    expect(onReconnect).toHaveBeenCalledTimes(1)
  })

  it('resets the idle timer if the tab becomes visible again before the deadline', async () => {
    const client = makeClient({ idleTimeoutMs: 5 * 60 * 1000 })
    client.connect()
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    const socket = latestSocket()
    socket.open()

    client.notifyHidden()
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000)
    client.notifyVisible() // back before the 5-minute deadline

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    expect(socket.readyState).toBe(1) // never idle-closed
    expect(FakeSocket.instances).toHaveLength(1) // and no spurious reconnect
  })
})
