/**
 * Framework-agnostic realtime WebSocket client.
 *
 * Wraps the wire protocol implemented by `server/routes/_ws.ts` /
 * `server/utils/ws-connections.ts`:
 *
 *   - Connect:            ws(s)://<host>/_ws?token=<session-token>
 *   - Client -> server:   raw `ping`; `{action:'subscribe'|'unsubscribe', channel}`
 *   - Server -> client:   `{type:'subscribed'|'unsubscribed'|'subscribe_error', channel, reason?}`
 *                         `{type:'event', channel, event: RealtimeEnvelope}`
 *                         `{type:'notification', data}` — legacy, belongs to
 *                         NotificationBell (SUP-00-9). This client ignores it.
 *
 * Deliberately has no dependency on `window`/`document`/global `WebSocket` beyond
 * an injectable default, so it can be unit tested in a plain Node environment
 * with a mocked socket and fake timers. Browser wiring (visibility, token
 * source, URL construction) lives in `plugins/realtime.client.ts`.
 *
 * Design constraints this implements, see
 * `docs/plans/2026-08-11-support-platform/design.md` ("Realtime") and
 * `docs/plans/2026-08-11-support-platform/deltas.md` (D-02):
 *
 *   - Reconnect with exponential backoff is the NORMAL path (Vercel closes
 *     WebSockets at the function max duration), not an error condition.
 *   - All previously-subscribed channels are resubscribed automatically on
 *     every reconnect — callers never re-register.
 *   - `onReconnect` hooks let consumers refetch state they may have missed
 *     while disconnected. Envelopes carry identifiers only, never contents.
 *   - The socket is idle-disconnected after a period of tab inactivity and
 *     reconnected (bypassing backoff) on the next `notifyVisible()`.
 *   - `subscribe_error` is surfaced to the caller and is not retried
 *     automatically within a connection — `inbox:`/`conversation:` channels
 *     currently always deny (Stage 02 introduces those tables).
 *   - Multiple `subscribe()` calls for the same channel share one wire
 *     subscription (reference counted); unsubscribing one does not affect
 *     the others.
 */

/** The only fields an envelope carries — identifiers, never record contents. */
export interface RealtimeEnvelope {
  v: number
  type: string
  teamId: string
  inboxId?: string
  conversationId?: string
  messageId?: string
}

export interface RealtimeSubscriptionHandlers {
  /** Called for every event delivered on this channel. */
  onEvent?: (envelope: RealtimeEnvelope, channel: string) => void
  /**
   * Called when the server refuses a subscribe request (e.g. not a team
   * member, or a channel scope that isn't available yet). Not retried
   * automatically — surface it to the caller rather than looping forever.
   */
  onSubscribeError?: (reason: string, channel: string) => void
}

/** Minimal surface this module needs from a WebSocket — real or mocked. */
export interface RealtimeSocketLike {
  readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((event: unknown) => void) | null
  onclose: ((event: { code: number; reason?: string }) => void) | null
  onerror: ((event: unknown) => void) | null
  onmessage: ((event: { data: string }) => void) | null
}

const SOCKET_OPEN = 1

/** Close code the server sends on auth failure. Do not retry after this. */
export const AUTH_FAILURE_CLOSE_CODE = 4001

export interface RealtimeBackoffOptions {
  baseMs: number
  maxMs: number
  factor: number
  /** +/- fraction of the computed delay to randomize, avoiding thundering herds. */
  jitterRatio: number
}

const DEFAULT_BACKOFF: RealtimeBackoffOptions = {
  baseMs: 1000,
  maxMs: 30000,
  factor: 2,
  jitterRatio: 0.2,
}

export interface RealtimeClientOptions {
  /** Resolve the current session token, or null if there isn't one (yet). */
  getToken: () => Promise<string | null> | string | null
  /** Build the full `ws(s)://…/_ws?token=…` URL from a resolved token. */
  buildUrl: (token: string) => string
  /** Socket factory. Defaults to the global `WebSocket`; tests inject a fake. */
  createSocket?: (url: string) => RealtimeSocketLike
  /** Keep-alive ping cadence. */
  pingIntervalMs?: number
  /** How long the tab may be hidden before the socket is proactively closed. */
  idleTimeoutMs?: number
  backoff?: Partial<RealtimeBackoffOptions>
  /** Injectable RNG for deterministic backoff jitter in tests. */
  random?: () => number
}

interface ChannelState {
  listeners: Map<number, RealtimeSubscriptionHandlers>
  acked: boolean
}

type WireFrame =
  | { type: 'connected'; userId?: string }
  | { type: 'error'; message?: string }
  | { type: 'subscribed'; channel: string }
  | { type: 'unsubscribed'; channel: string }
  | { type: 'subscribe_error'; channel: string; reason: string }
  | { type: 'event'; channel: string; event: RealtimeEnvelope }
  | { type: 'notification'; data: unknown }

function isWireFrame(value: unknown): value is WireFrame {
  return !!value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string'
}

export class RealtimeClient {
  private readonly getToken: RealtimeClientOptions['getToken']
  private readonly buildUrl: RealtimeClientOptions['buildUrl']
  private readonly createSocket: (url: string) => RealtimeSocketLike
  private readonly pingIntervalMs: number
  private readonly idleTimeoutMs: number
  private readonly backoff: RealtimeBackoffOptions
  private readonly random: () => number

  private socket: RealtimeSocketLike | null = null
  private connecting = false
  private destroyed = false
  private authFailed = false
  private intentionalClose = false
  private idleDisconnected = false
  private hasConnectedBefore = false

  private readonly channels = new Map<string, ChannelState>()
  private nextListenerId = 1

  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  private readonly reconnectHooks = new Set<() => void>()
  private readonly authFailureHooks = new Set<() => void>()

  constructor(options: RealtimeClientOptions) {
    this.getToken = options.getToken
    this.buildUrl = options.buildUrl
    this.createSocket =
      options.createSocket ??
      ((url: string) => {
        if (typeof WebSocket === 'undefined') {
          throw new Error('No WebSocket implementation available; pass createSocket explicitly')
        }
        return new WebSocket(url) as unknown as RealtimeSocketLike
      })
    this.pingIntervalMs = options.pingIntervalMs ?? 30000
    this.idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60 * 1000
    this.backoff = { ...DEFAULT_BACKOFF, ...options.backoff }
    this.random = options.random ?? Math.random
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  /** Current high-level connection state. Mostly useful for diagnostics/tests. */
  get state(): 'idle' | 'connecting' | 'open' | 'auth-failed' {
    if (this.authFailed) return 'auth-failed'
    if (this.socket?.readyState === SOCKET_OPEN) return 'open'
    if (this.connecting || this.socket) return 'connecting'
    return 'idle'
  }

  /** Open the socket if it isn't already open/connecting. Safe to call repeatedly. */
  connect(): void {
    void this.open()
  }

  /**
   * Subscribe to a channel. Multiple callers subscribing to the same channel
   * share one underlying wire subscription (reference counted) — the second
   * caller does not send another `subscribe` frame, and unsubscribing one
   * does not affect the other. Implicitly connects if not already connected.
   *
   * Returns an unsubscribe function.
   */
  subscribe(channel: string, handlers: RealtimeSubscriptionHandlers = {}): () => void {
    let state = this.channels.get(channel)
    const isNewChannel = !state
    if (!state) {
      state = { listeners: new Map(), acked: false }
      this.channels.set(channel, state)
    }

    const id = this.nextListenerId++
    state.listeners.set(id, handlers)

    if (isNewChannel) {
      this.sendSubscribe(channel)
    }
    this.connect()

    let unsubscribed = false
    return () => {
      if (unsubscribed) return
      unsubscribed = true
      const current = this.channels.get(channel)
      if (!current) return
      current.listeners.delete(id)
      if (current.listeners.size === 0) {
        this.channels.delete(channel)
        this.sendUnsubscribe(channel)
      }
    }
  }

  /**
   * Register a hook that fires after a *reconnect* (not the initial connect)
   * once the socket is open and resubscribe frames have been sent. Consumers
   * use this to refetch state through normal authorized endpoints, since
   * events published during the gap were missed — envelopes carry
   * identifiers only, never enough to reconstruct what was missed.
   */
  onReconnect(callback: () => void): () => void {
    this.reconnectHooks.add(callback)
    return () => this.reconnectHooks.delete(callback)
  }

  /** Register a hook that fires once, when the server closes with 4001. */
  onAuthFailure(callback: () => void): () => void {
    this.authFailureHooks.add(callback)
    return () => this.authFailureHooks.delete(callback)
  }

  /** Tell the client the tab is hidden. Starts the idle-disconnect timer. */
  notifyHidden(): void {
    if (this.idleTimer || this.idleDisconnected) return
    this.idleTimer = setTimeout(() => this.idleDisconnect(), this.idleTimeoutMs)
  }

  /** Tell the client the tab is visible/focused. Cancels idle timer, reconnects if needed. */
  notifyVisible(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (this.idleDisconnected) {
      this.idleDisconnected = false
      this.reconnectAttempts = 0
      this.connect()
    }
  }

  /** Tear the connection down without scheduling a reconnect. Call on app teardown. */
  disconnect(): void {
    this.intentionalClose = true
    this.clearReconnectTimer()
    this.stopPing()
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    this.socket?.close(1000, 'client disconnect')
    this.socket = null
    this.connecting = false
  }

  /** Full teardown — no further reconnects, even via notifyVisible(). */
  destroy(): void {
    this.destroyed = true
    this.disconnect()
    this.channels.clear()
    this.reconnectHooks.clear()
    this.authFailureHooks.clear()
  }

  /* ------------------------------------------------------------------ */
  /* Connection lifecycle                                                */
  /* ------------------------------------------------------------------ */

  private async open(): Promise<void> {
    if (this.destroyed || this.authFailed || this.connecting || this.socket) return

    this.idleDisconnected = false
    this.connecting = true

    let token: string | null
    try {
      token = await this.getToken()
    } catch {
      token = null
    }

    if (this.destroyed || this.authFailed) {
      this.connecting = false
      return
    }

    if (!token) {
      this.connecting = false
      this.scheduleReconnect()
      return
    }

    const socket = this.createSocket(this.buildUrl(token))
    this.socket = socket
    socket.onopen = () => this.handleOpen()
    socket.onclose = (event) => this.handleClose(event)
    socket.onerror = () => {
      // onclose fires next; reconnect handling lives there.
    }
    socket.onmessage = (event) => this.handleMessage(event)
  }

  private handleOpen(): void {
    this.connecting = false
    this.reconnectAttempts = 0
    this.startPing()

    for (const [channel, state] of this.channels) {
      state.acked = false
      this.sendSubscribe(channel)
    }

    const isReconnect = this.hasConnectedBefore
    this.hasConnectedBefore = true
    if (isReconnect) {
      for (const hook of this.reconnectHooks) hook()
    }
  }

  private handleMessage(event: { data: string }): void {
    if (event.data === 'pong') return

    let parsed: unknown
    try {
      parsed = JSON.parse(event.data)
    } catch {
      return
    }
    if (!isWireFrame(parsed)) return

    switch (parsed.type) {
      case 'subscribed': {
        const state = this.channels.get(parsed.channel)
        if (state) state.acked = true
        return
      }
      case 'subscribe_error': {
        const state = this.channels.get(parsed.channel)
        if (!state) return
        for (const handlers of state.listeners.values()) {
          handlers.onSubscribeError?.(parsed.reason, parsed.channel)
        }
        return
      }
      case 'event': {
        const state = this.channels.get(parsed.channel)
        if (!state) return
        for (const handlers of state.listeners.values()) {
          handlers.onEvent?.(parsed.event, parsed.channel)
        }
        return
      }
      // 'connected' / 'error' — handled implicitly via close(4001).
      // 'notification' — legacy NotificationBell frame (SUP-00-9). Ignored.
      default:
        return
    }
  }

  private handleClose(event: { code: number; reason?: string }): void {
    this.socket = null
    this.connecting = false
    this.stopPing()

    if (event.code === AUTH_FAILURE_CLOSE_CODE) {
      this.authFailed = true
      this.clearReconnectTimer()
      for (const hook of this.authFailureHooks) hook()
      return
    }

    if (this.intentionalClose) {
      this.intentionalClose = false
      return
    }

    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.authFailed || this.idleDisconnected || this.reconnectTimer) return

    const attempt = this.reconnectAttempts++
    const raw = Math.min(this.backoff.baseMs * Math.pow(this.backoff.factor, attempt), this.backoff.maxMs)
    const jitter = raw * this.backoff.jitterRatio * (this.random() * 2 - 1)
    const delay = Math.max(0, Math.round(raw + jitter))

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.open()
    }, delay)
  }

  private idleDisconnect(): void {
    this.idleTimer = null
    this.idleDisconnected = true
    this.clearReconnectTimer()
    if (!this.socket) return
    this.intentionalClose = true
    this.socket.close(1000, 'idle')
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  /* ------------------------------------------------------------------ */
  /* Wire helpers                                                        */
  /* ------------------------------------------------------------------ */

  private sendSubscribe(channel: string): void {
    if (this.socket?.readyState === SOCKET_OPEN) {
      this.socket.send(JSON.stringify({ action: 'subscribe', channel }))
    }
  }

  private sendUnsubscribe(channel: string): void {
    if (this.socket?.readyState === SOCKET_OPEN) {
      this.socket.send(JSON.stringify({ action: 'unsubscribe', channel }))
    }
  }

  private startPing(): void {
    this.stopPing()
    this.pingTimer = setInterval(() => {
      if (this.socket?.readyState === SOCKET_OPEN) this.socket.send('ping')
    }, this.pingIntervalMs)
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }
}
