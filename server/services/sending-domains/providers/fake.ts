import { isFakeSendingDomainProviderAllowed, type SendingDomainDnsRecord } from '~/lib/support-sending-domains'
import {
  SendingDomainProviderError,
  type ProviderDomainResult,
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
 */

interface FakeDomainState {
  verifyCalls: number
}

export interface FakeSendingDomainStore {
  domains: Map<string, FakeDomainState>
  flakyFailed: Set<string>
  /** Route id -> the route as a Mailgun-compatible provider would store it. */
  routes: Map<string, FakeInboundRoute>
}

export interface FakeInboundRoute {
  address: string
  expression: string
  priority: number
}

function createStore(): FakeSendingDomainStore {
  return { domains: new Map(), flakyFailed: new Set(), routes: new Map() }
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
    this.store.domains.set(name, { verifyCalls: 0 })
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

  async createInboundRoute(input: {
    address: string
    forwardUrl: string
    description: string
  }): Promise<{ routeId: string }> {
    const routeId = `fake-route-${this.store.routes.size + 1}-${Date.now().toString(36)}`
    // Same expression and priority as the Mailgun provider, so tests see what a
    // real provider would get (and invalid addresses fail the same way).
    const route = inboundRouteDefinition(input.address)
    this.store.routes.set(routeId, { address: input.address, ...route })
    return { routeId }
  }

  async deleteInboundRoute(routeId: string): Promise<void> {
    this.store.routes.delete(routeId)
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
      receivesMail: false,
      records,
      message: null,
    }
  }
}
