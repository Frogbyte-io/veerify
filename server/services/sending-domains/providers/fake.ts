import { isFakeSendingDomainProviderAllowed, type SendingDomainDnsRecord } from '~/lib/support-sending-domains'
import {
  SendingDomainProviderError,
  type InboundRouteInput,
  type InboundRouteResult,
  type ProviderDomainResult,
  type ProviderDomainUsageTotals,
  type ProviderForwardDestination,
  type ProviderReceivingState,
  type SendingDomainCapabilities,
  type SendingDomainProvider,
  type SendingDomainRegistration,
} from '../types'
import { normalizeDomainName } from '../util'
import { inboundRouteDefinition } from './mailgun'

/**
 * In-memory provider for dev and e2e runs (design §6.4). Never used in
 * production: see `isFakeSendingDomainMode()`. Behaviour depends on the name:
 *
 * - `*.verify-ok.test`: active after the first `verify()` call
 * - `*.owned-elsewhere.test`: `register()` fails with `owned_elsewhere`
 * - `*.flaky.test`: first `register()` fails with `provider_unavailable`
 * - anything else stays unverified
 *
 * Receiving turns `active` with the domain. Forward destinations to an address
 * starting with `confirmed` are verified at once; others stay pending.
 */

interface FakeDomainState {
  verifyCalls: number
  receiving: boolean
  forwardingPaused: boolean
}

export interface FakeSendingDomainStore {
  domains: Map<string, FakeDomainState>
  flakyFailed: Set<string>
  /** Route id -> the route as a Mailgun-compatible provider would store it. */
  routes: Map<string, FakeInboundRoute>
  /** Destination id -> destination, with its domain. */
  destinations: Map<string, ProviderForwardDestination & { domain: string }>
  /** `domain` -> forwards counted this month (tests set it). */
  forwarded: Map<string, number>
}

export interface FakeInboundRoute {
  address: string
  expression: string
  priority: number
  forwardUrl: string | null
  forwardTo: string[]
}

function createStore(): FakeSendingDomainStore {
  return {
    domains: new Map(),
    flakyFailed: new Set(),
    routes: new Map(),
    destinations: new Map(),
    forwarded: new Map(),
  }
}

const sharedStore = createStore()

/** Clears the process-wide in-memory state (tests). */
/** The fake provider's current routes (tests). */
export function fakeInboundRoutes(): FakeInboundRoute[] {
  return [...sharedStore.routes.values()]
}

export function resetFakeSendingDomainState(): void {
  sharedStore.domains.clear()
  sharedStore.flakyFailed.clear()
  sharedStore.routes.clear()
  sharedStore.destinations.clear()
  sharedStore.forwarded.clear()
}

/** Sets this month's forward count for a domain (tests). */
export function setFakeForwardCount(domain: string, count: number): void {
  sharedStore.forwarded.set(normalizeDomainName(domain), count)
}

/** The fake provider's forward destinations (tests). */
export function fakeForwardDestinations(): Array<ProviderForwardDestination & { domain: string }> {
  return [...sharedStore.destinations.values()]
}

/** True when `SUPPORT_SENDING_DOMAIN_PROVIDER=fake` is set and allowed (see `isFakeSendingDomainProviderAllowed`). */
export function isFakeSendingDomainMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return isFakeSendingDomainProviderAllowed(env)
}

/** Domains whose ownership TXT counts as published in fake mode. */
export function isFakeVerifiedDomain(domain: string): boolean {
  return normalizeDomainName(domain).endsWith('.verify-ok.test')
}

export class FakeSendingDomainProvider implements SendingDomainProvider {
  readonly name = 'fake'
  readonly accountKey = 'fake-account'
  readonly capabilities: SendingDomainCapabilities = {
    register: true,
    verifyNow: true,
    remove: true,
    inboundRoutes: true,
    authorizesSubdomains: true,
    forwarding: true,
  }

  private readonly store: FakeSendingDomainStore

  constructor(store: FakeSendingDomainStore = sharedStore) {
    this.store = store
  }

  isConfigured(): { configured: boolean; missing: string[] } {
    return { configured: true, missing: [] }
  }

  async register(domain: string): Promise<SendingDomainRegistration> {
    const name = normalizeDomainName(domain)

    if (name.endsWith('.owned-elsewhere.test')) {
      throw new SendingDomainProviderError('owned_elsewhere', `${name} belongs to another project`, false)
    }
    if (name.endsWith('.flaky.test') && !this.store.flakyFailed.has(name)) {
      this.store.flakyFailed.add(name)
      throw new SendingDomainProviderError('provider_unavailable', 'The fake provider is flaky', true)
    }

    if (this.store.domains.has(name)) return { ...this.result(name), ownership: 'adopted' }
    this.store.domains.set(name, { verifyCalls: 0, receiving: false, forwardingPaused: false })
    return { ...this.result(name), ownership: 'created' }
  }

  async get(domain: string): Promise<ProviderDomainResult | null> {
    const name = normalizeDomainName(domain)
    return this.store.domains.has(name) ? this.result(name) : null
  }

  async verify(domain: string): Promise<ProviderDomainResult> {
    const name = normalizeDomainName(domain)
    const state = this.store.domains.get(name)
    if (!state) throw new SendingDomainProviderError('not_found', `${name} is not registered`, false)
    state.verifyCalls += 1
    return this.result(name)
  }

  async remove(domain: string): Promise<{ cleanup: { removed: string[]; kept: string[]; failed: string[] } | null }> {
    const name = normalizeDomainName(domain)
    if (!this.store.domains.delete(name)) {
      throw new SendingDomainProviderError('not_found', `${name} is not registered`, false)
    }
    return { cleanup: { removed: [`fake._domainkey.${name}`], kept: [], failed: [] } }
  }

  async createInboundRoute(input: InboundRouteInput): Promise<InboundRouteResult> {
    const routeId = `fake-route-${this.store.routes.size + 1}-${Date.now().toString(36)}`
    return this.saveRoute(routeId, input)
  }

  async updateInboundRoute(routeId: string, input: InboundRouteInput): Promise<InboundRouteResult> {
    if (!this.store.routes.has(routeId)) throw new SendingDomainProviderError('not_found', 'No such route', false)
    return this.saveRoute(routeId, input)
  }

  async deleteInboundRoute(routeId: string): Promise<void> {
    this.store.routes.delete(routeId)
  }

  async enableReceiving(domain: string): Promise<ProviderReceivingState> {
    const state = this.requireDomain(domain)
    state.receiving = true
    return this.receiving(normalizeDomainName(domain))
  }

  async getReceiving(domain: string): Promise<ProviderReceivingState | null> {
    const name = normalizeDomainName(domain)
    return this.store.domains.has(name) ? this.receiving(name) : null
  }

  async setForwardingPaused(domain: string, paused: boolean): Promise<ProviderReceivingState> {
    const state = this.requireDomain(domain)
    if (!state.receiving) throw new SendingDomainProviderError('domain_not_receiving', 'Not receiving', false)
    state.forwardingPaused = paused
    return this.receiving(normalizeDomainName(domain))
  }

  async disableReceiving(domain: string): Promise<void> {
    const name = normalizeDomainName(domain)
    const state = this.store.domains.get(name)
    if (!state) return
    state.receiving = false
    for (const destination of this.store.destinations.values()) {
      if (destination.domain === name)
        Object.assign(destination, { status: 'revoked', statusReason: 'domain_disabled' })
    }
  }

  async listForwardDestinations(domain: string): Promise<ProviderForwardDestination[]> {
    const name = normalizeDomainName(domain)
    return [...this.store.destinations.values()]
      .filter((item) => item.domain === name)
      .map(({ domain: _d, ...item }) => item)
  }

  async createForwardDestination(domain: string, email: string): Promise<ProviderForwardDestination> {
    return this.destinationFor(normalizeDomainName(domain), email)
  }

  async resendForwardDestination(id: string): Promise<ProviderForwardDestination> {
    const destination = this.store.destinations.get(id)
    if (!destination) throw new SendingDomainProviderError('not_found', 'No such destination', false)
    if (destination.status === 'verified') throw new SendingDomainProviderError('conflict', 'Already verified', false)
    Object.assign(destination, { status: 'pending', statusReason: null, verificationSentAt: new Date() })
    const { domain: _d, ...item } = destination
    return item
  }

  async deleteForwardDestination(id: string): Promise<ProviderForwardDestination | null> {
    const destination = this.store.destinations.get(id)
    if (!destination) return null
    Object.assign(destination, { status: 'revoked', statusReason: 'api' })
    const { domain: _d, ...item } = destination
    return item
  }

  async getDomainUsage(input: { domains: string[]; from: string; to: string }): Promise<ProviderDomainUsageTotals> {
    const forwarded = input.domains.reduce(
      (sum, domain) => sum + (this.store.forwarded.get(normalizeDomainName(domain)) ?? 0),
      0
    )
    return { received: forwarded, forwarded, forwardSkipped: 0, blocked: 0 }
  }

  private saveRoute(routeId: string, input: InboundRouteInput): InboundRouteResult {
    // Same expression and priority as the Mailgun provider, so tests see what a
    // real provider would get (and invalid addresses fail the same way).
    const route = inboundRouteDefinition(input.address)
    const forwardTo = [...new Set((input.forwardTo ?? []).map((email) => email.trim().toLowerCase()))]
    const domain = normalizeDomainName(input.address.split('@')[1] ?? '')
    if (forwardTo.length > 0 && !this.store.domains.get(domain)?.receiving) {
      throw new SendingDomainProviderError('forward_requires_ses', 'The domain does not receive through SES', false)
    }
    this.store.routes.set(routeId, { address: input.address, ...route, forwardUrl: input.forwardUrl, forwardTo })
    return {
      routeId,
      forwardDestinations: forwardTo.map((email) => {
        const { statusReason: _r, verifiedAt: _v, ...item } = this.destinationFor(domain, email)
        return { ...item, statusReason: null, verifiedAt: null }
      }),
    }
  }

  private destinationFor(domain: string, email: string): ProviderForwardDestination {
    const value = email.trim().toLowerCase()
    const existing = [...this.store.destinations.values()].find(
      (item) => item.domain === domain && item.email === value
    )
    if (existing) {
      const { domain: _d, ...item } = existing
      return item
    }
    const confirmed = value.startsWith('confirmed')
    const destination = {
      id: `fwd_fake_${this.store.destinations.size + 1}`,
      domain,
      email: value,
      status: confirmed ? ('verified' as const) : ('pending' as const),
      statusReason: null,
      verificationSentAt: new Date(),
      verifiedAt: confirmed ? new Date() : null,
    }
    this.store.destinations.set(destination.id, destination)
    const { domain: _d, ...item } = destination
    return item
  }

  private requireDomain(domain: string): FakeDomainState {
    const name = normalizeDomainName(domain)
    const state = this.store.domains.get(name)
    if (!state) throw new SendingDomainProviderError('not_found', `${name} is not registered`, false)
    return state
  }

  private receiving(name: string): ProviderReceivingState {
    const state = this.store.domains.get(name)!
    const active = this.result(name).state === 'active'
    return {
      status: !state.receiving ? 'disabled' : active ? 'active' : 'pending_verification',
      forwardingPaused: state.forwardingPaused,
      records: [
        {
          purpose: 'receiving',
          type: 'MX',
          name,
          priority: '10',
          value: 'inbound-smtp.us-east-1.amazonaws.com',
          status: active ? 'valid' : 'unknown',
        },
      ],
      lastReceivedAt: null,
    }
  }

  private result(name: string): ProviderDomainResult {
    const state = this.store.domains.get(name)
    const active = name.endsWith('.verify-ok.test') && (state?.verifyCalls ?? 0) > 0
    const records: SendingDomainDnsRecord[] = [
      {
        purpose: 'sending',
        type: 'CNAME',
        name: `fake._domainkey.${name}`,
        value: 'fake.dkim.veerify.test',
        status: active ? 'valid' : 'unknown',
      },
      {
        purpose: 'sending',
        type: 'TXT',
        name,
        value: 'v=spf1 include:spf.veerify.test ~all',
        status: active ? 'valid' : 'unknown',
      },
    ]
    return {
      domain: name,
      state: active ? 'active' : 'unverified',
      receivesMail: state?.receiving ?? false,
      records,
      message: null,
    }
  }
}
