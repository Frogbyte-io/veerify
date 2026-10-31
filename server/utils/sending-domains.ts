/**
 * Customer sending domains: claim rules and project-scoped sender authorization
 * (design: docs/plans/2026-10-22-custom-sending-domains/design.md §4, §7.4, §9.3).
 *
 * Everything here is a database read or a rule check. Provider calls live in
 * `server/services/sending-domains/`, and the pure transition logic in
 * `lib/support-sending-domains.ts`.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
// Imported explicitly rather than relying on Nuxt's auto-import, so this module
// can be unit tested outside the Nitro runtime.
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import { supportInbox, projectMailAddress, projectMailDomain } from '~/server/database/schema/support'
import {
  OWNERSHIP_RECORD_LABEL,
  OWNERSHIP_RECORD_PREFIX,
  PENDING_TTL_DAYS,
  applyProviderResult,
  findHierarchyConflict,
  getRegistrableDomain,
  isSameOrSubdomain,
  normalizeSendingDomain,
  sendingDomainSuspendedReason,
  validateSendingDomain,
  type SendingDomainDnsRecord,
  type SendingDomainProviderOwnership,
  type SendingDomainView,
  type SenderPolicy,
  type SupportSendingDomainStatus,
  type ProjectSenderVerdict,
} from '~/lib/support-sending-domains'
import { emailDomain, matchVerifiedDomain } from '~/server/services/support-channels/types'
import { getSendingDomainProvider } from '~/server/services/sending-domains'
import { isUniqueViolation } from './support-errors'
import { createErrorResponse } from './response'
import { createLogger } from './logger'
import { assertCanAddMailDomain, getOrganizationIdForProject, lockMailUsage } from './mail-limits'

const log = createLogger('sending-domains')

// `applyProviderResult` is specified under the server helpers (design §7.4) but
// lives in lib/ so it can be unit tested without a database.
export { applyProviderResult }

export type SupportSendingDomainRow = typeof projectMailDomain.$inferSelect

/** The deployment's sending provider identity, as stored on a claim. */
export interface SendingProviderIdentity {
  name: string
  accountKey: string
  authorizesSubdomains: boolean
}

const UNVERIFIED_STATUSES: SupportSendingDomainStatus[] = ['provisioning', 'pending', 'failed']

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function envValue(name: string): string {
  return (process.env[name] ?? '').trim()
}

export function isSendingDomainsEnabled(): boolean {
  return envValue('SUPPORT_SENDING_DOMAINS_ENABLED').toLowerCase() === 'true'
}

/**
 * `project` whenever management is enabled (a shared provider project is unsafe
 * without project scope, even if `legacy` is set), otherwise whatever
 * `SUPPORT_SENDER_POLICY` asks for, defaulting to `legacy`.
 */
export function resolveSenderPolicy(): SenderPolicy {
  if (isSendingDomainsEnabled()) return 'project'
  // `team` is the pre-restructure spelling of `project`; keep existing deployments working.
  const value = envValue('SUPPORT_SENDER_POLICY').toLowerCase()
  return value === 'project' || value === 'team' ? 'project' : 'legacy'
}

const CLAIMS_EXIST_TTL_MS = 30_000
let claimsExistCache: { value: boolean; at: number } | null = null

/** Drop the cached "any claim exists" answer (tests only; claim creation refreshes it itself). */
export function resetSenderPolicyCache(): void {
  claimsExistCache = null
}

/** True when at least one `project_mail_domain` row exists. Cached per process for 30 seconds. */
export async function anySendingDomainClaimsExist(): Promise<boolean> {
  const now = Date.now()
  if (claimsExistCache && now - claimsExistCache.at < CLAIMS_EXIST_TTL_MS) return claimsExistCache.value
  const [row] = await db.select({ id: projectMailDomain.id }).from(projectMailDomain).limit(1)
  claimsExistCache = { value: Boolean(row), at: now }
  return claimsExistCache.value
}

/**
 * The policy enforcement points must use. Like `resolveSenderPolicy()`, but
 * also `project` whenever any claim exists, even with the flag off or `legacy`
 * set: rolling management back must not reopen cross-project sending in a shared
 * provider project. A database read (cached briefly), hence async; the
 * synchronous `resolveSenderPolicy()` stays for callers that only need the
 * configured policy.
 */
export async function resolveEffectiveSenderPolicy(): Promise<SenderPolicy> {
  if (resolveSenderPolicy() === 'project') return 'project'
  return (await anySendingDomainClaimsExist()) ? 'project' : 'legacy'
}

/** The domain part of `Name <a@b.example>`, `a@b.example`, or a bare host. */
function domainFromEnvAddress(value: string): string | null {
  const match = value.match(/<([^>]+)>/)
  const address = (match ? match[1] : value).trim()
  const at = address.lastIndexOf('@')
  const host = at >= 0 ? address.slice(at + 1) : address
  const normalized = normalizeSendingDomain(host.replace(/:\d+$/, ''))
  return normalized || null
}

/** Domains no project may claim (design §4.2 rule 2), excluding the static mailbox-provider list. */
export function reservedSendingDomains(): string[] {
  const reserved = new Set<string>()
  const add = (value: string | null) => {
    if (value) reserved.add(value)
  }

  add(domainFromEnvAddress(envValue('MAIL_FROM')))
  add(domainFromEnvAddress(envValue('SYSTEM_MAIL_FROM')))
  // The Mailgun account key is an identity label that is usually a domain; ignore it when it is not.
  const accountKey = envValue('SUPPORT_MAILGUN_ACCOUNT_KEY')
  if (accountKey.includes('.')) add(domainFromEnvAddress(accountKey))
  add(domainFromEnvAddress(envValue('APP_DOMAIN')))
  add(domainFromEnvAddress(envValue('SUPPORT_PLATFORM_MAIL_DOMAIN')))
  for (const entry of envValue('SUPPORT_SENDING_DOMAINS_RESERVED').split(',')) {
    add(domainFromEnvAddress(entry))
  }

  return [...reserved]
}

/**
 * Identity of the provider this deployment sends through now. Claims remember
 * the identity they were registered under, so a switch shows as a mismatch.
 */
export function currentSendingProviderIdentity(): SendingProviderIdentity {
  // Claims store the provider object's name and account key, so authorization
  // must compare against the same object, not a separately derived identity.
  const provider = getSendingDomainProvider()
  if (provider) {
    return {
      name: provider.name,
      accountKey: provider.accountKey,
      authorizesSubdomains: provider.capabilities.authorizesSubdomains,
    }
  }
  const name = (envValue('SUPPORT_CHANNEL_PROVIDER') || 'postmark').toLowerCase()
  return {
    name,
    accountKey: envValue(name === 'mailgun' ? 'SUPPORT_MAILGUN_ACCOUNT_KEY' : 'SUPPORT_POSTMARK_ACCOUNT_KEY'),
    authorizesSubdomains: name === 'mailgun',
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function sendingDomainError(statusCode: number, statusMessage: string, code: string, message: string) {
  return createError({
    statusCode,
    statusMessage,
    // `data.error.code` follows the repo's response envelope; `data.code` is the
    // flat form the sending-domain API contract (design §4.2/§4.3) names.
    data: { ...createErrorResponse(code, message), code },
  })
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

export interface CreateSendingDomainClaimInput {
  projectId: string
  domain: string
  userId: string
  provider: string
  providerAccountKey: string
  /** Test seam. */
  now?: Date
}

/**
 * Claim `domain` for `projectId` as a `provisioning` row (design §4.2).
 *
 * Takes an advisory lock on the registrable domain so every claim under
 * `acme.com` is serialized and the ancestor/descendant check cannot race. The
 * unique index on `domain` remains the final guarantee.
 */
export async function createSendingDomainClaim(input: CreateSendingDomainClaimInput): Promise<SupportSendingDomainRow> {
  const now = input.now ?? new Date()
  const domain = normalizeSendingDomain(input.domain)
  const allowTestTld = input.provider === 'fake'

  const invalid = validateSendingDomain(domain, { reserved: reservedSendingDomains(), allowTestTld })
  const registrableDomain = getRegistrableDomain(domain, allowTestTld)
  if (invalid || !registrableDomain) {
    throw sendingDomainError(
      422,
      'Unprocessable Entity',
      'DOMAIN_REJECTED',
      invalid ?? 'This is not a valid domain name.'
    )
  }

  try {
    const created = await db.transaction(async (tx) => {
      // Workspace mail-usage lock first (then per-domain), so the workspace
      // limits below cannot be raced by concurrent claims in any of the
      // workspace's projects, for different domains.
      const organizationId = await getOrganizationIdForProject(input.projectId, tx)
      await lockMailUsage(organizationId, tx)
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`support_sending_domain:${registrableDomain}`}, 0))`
      )

      const related = await tx
        .select({
          domain: projectMailDomain.domain,
          projectId: projectMailDomain.projectId,
        })
        .from(projectMailDomain)
        .where(eq(projectMailDomain.registrableDomain, registrableDomain))

      if (findHierarchyConflict(domain, input.projectId, related)) {
        throw sendingDomainError(
          409,
          'Conflict',
          'DOMAIN_CLAIMED',
          'This domain, or a parent or subdomain of it, is already registered by another Veerify workspace.'
        )
      }
      if (related.some((claim) => claim.projectId === input.projectId && claim.domain === domain)) {
        throw sendingDomainError(
          409,
          'Conflict',
          'DOMAIN_ALREADY_REGISTERED',
          'Your project has already registered this domain.'
        )
      }

      // 409 MAIL_DOMAIN_LIMIT_REACHED / MAIL_PENDING_LIMIT_REACHED, counted per
      // workspace (lib/mail-plans.ts), pending domains included.
      await assertCanAddMailDomain(organizationId, tx)

      const ownershipToken = randomBytes(24).toString('base64url')
      const ownershipRecord: SendingDomainDnsRecord = {
        purpose: 'ownership',
        type: 'TXT',
        name: `${OWNERSHIP_RECORD_LABEL}.${domain}`,
        value: `${OWNERSHIP_RECORD_PREFIX}${ownershipToken}`,
        status: 'unknown',
      }

      const [row] = await tx
        .insert(projectMailDomain)
        .values({
          id: randomUUID(),
          projectId: input.projectId,
          domain,
          registrableDomain,
          status: 'provisioning',
          provider: input.provider,
          providerAccountKey: input.providerAccountKey,
          ownershipToken,
          dnsRecords: [ownershipRecord],
          nextCheckAt: now,
          expiresAt: new Date(now.getTime() + PENDING_TTL_DAYS * 24 * 60 * 60 * 1000),
          createdByUserId: input.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning()

      return row
    })
    // This process now knows a claim exists; other processes learn within the cache TTL.
    claimsExistCache = { value: true, at: Date.now() }
    return created
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw sendingDomainError(
        409,
        'Conflict',
        'DOMAIN_CLAIMED',
        'This domain, or a parent or subdomain of it, is already registered by another Veerify workspace.'
      )
    }
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    log.error('Could not create a sending domain claim', {
      projectId: input.projectId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export async function listProjectSendingDomains(projectId: string): Promise<SupportSendingDomainRow[]> {
  return db
    .select()
    .from(projectMailDomain)
    .where(eq(projectMailDomain.projectId, projectId))
    .orderBy(asc(projectMailDomain.createdAt), asc(projectMailDomain.domain))
}

/** 404 (never 403) across projects, so claim ids stay opaque. */
export async function getProjectSendingDomain(projectId: string, id: string): Promise<SupportSendingDomainRow> {
  const [row] = await db
    .select()
    .from(projectMailDomain)
    .where(and(eq(projectMailDomain.id, id), eq(projectMailDomain.projectId, projectId)))
    .limit(1)

  if (!row) {
    throw sendingDomainError(404, 'Not Found', 'NOT_FOUND', 'Sending domain not found')
  }
  return row
}

const RECORD_ORDER: Record<SendingDomainDnsRecord['purpose'], number> = {
  ownership: 0,
  sending: 1,
  receiving: 2,
  recommended: 3,
}

export function toSendingDomainView(
  row: SupportSendingDomainRow,
  current: Pick<SendingProviderIdentity, 'name' | 'accountKey'> = currentSendingProviderIdentity()
): SendingDomainView {
  const iso = (value: Date | null) => (value ? value.toISOString() : null)
  return {
    id: row.id,
    domain: row.domain,
    registrableDomain: row.registrableDomain,
    status: row.status as SupportSendingDomainStatus,
    providerState: row.providerState === 'active' || row.providerState === 'unverified' ? row.providerState : null,
    ownershipVerified: row.ownershipVerifiedAt !== null,
    receivesViaProvider: row.receivesViaProvider,
    records: [...(row.dnsRecords ?? [])].sort((a, b) => RECORD_ORDER[a.purpose] - RECORD_ORDER[b.purpose]),
    lastCheckedAt: iso(row.lastCheckedAt),
    nextCheckAt: iso(row.nextCheckAt),
    expiresAt: iso(row.expiresAt),
    verifiedAt: iso(row.verifiedAt),
    lastErrorCode: row.lastErrorCode,
    lastError: row.lastError,
    suspendedReason: sendingDomainSuspendedReason(row.status, row.lastErrorCode),
    providerOwnership:
      row.providerOwnership === 'created' || row.providerOwnership === 'adopted'
        ? (row.providerOwnership as SendingDomainProviderOwnership)
        : null,
    providerMismatch: row.provider !== current.name || row.providerAccountKey !== current.accountKey,
    receivingStatus: RECEIVING_STATUSES.includes(row.receivingStatus as ReceivingStatusValue)
      ? (row.receivingStatus as ReceivingStatusValue)
      : null,
    lastReceivedAt: iso(row.lastReceivedAt ?? null),
    existingMxHosts: Array.isArray(row.existingMxHosts) ? row.existingMxHosts : null,
    existingMxCheckedAt: iso(row.existingMxCheckedAt ?? null),
  }
}

type ReceivingStatusValue = NonNullable<SendingDomainView['receivingStatus']>
const RECEIVING_STATUSES: ReceivingStatusValue[] = ['pending_verification', 'pending_mx', 'active', 'disabled']

// ---------------------------------------------------------------------------
// Sender authorization
// ---------------------------------------------------------------------------

export interface ResolveProjectSenderOptions {
  executor?: Pick<typeof db, 'select'>
  provider?: { name: string; accountKey: string; authorizesSubdomains: boolean }
}

function isPlatformAddressOfProject(executor: Pick<typeof db, 'select'>, projectId: string, address: string) {
  return executor
    .select({ id: projectMailAddress.id })
    .from(projectMailAddress)
    .innerJoin(supportInbox, eq(supportInbox.id, projectMailAddress.inboxId))
    .where(
      and(
        eq(supportInbox.projectId, projectId),
        eq(projectMailAddress.kind, 'platform'),
        eq(projectMailAddress.address, address)
      )
    )
    .limit(1)
}

/**
 * Whether `domain`, or a parent of it at a label boundary, sits on another
 * project's claim in any status (including `deleting`). Applies under every
 * policy: a shared provider project would make such a From usable by the
 * wrong project.
 */
export async function isDomainClaimedByOtherProject(
  projectId: string,
  domain: string,
  executor: Pick<typeof db, 'select'> = db
): Promise<boolean> {
  const names = domainAndAncestors(domain.trim().toLowerCase())
  if (names.length === 0) return false
  const [other] = await executor
    .select({ id: projectMailDomain.id })
    .from(projectMailDomain)
    .where(and(inArray(projectMailDomain.domain, names), ne(projectMailDomain.projectId, projectId)))
    .limit(1)
  return Boolean(other)
}

/**
 * Project-scoped verdict for using `address` as From (design §4.4, §7.3). A pure
 * database read: it never calls the provider.
 *
 * Authorized only for the project's own `verified` claims that were registered
 * under the provider currently configured, or the project's own platform
 * addresses. Subdomains follow `matchVerifiedDomain` when the provider
 * authorizes them.
 */
export async function resolveProjectSenderAuthorization(
  projectId: string,
  address: string,
  opts: ResolveProjectSenderOptions = {}
): Promise<ProjectSenderVerdict> {
  const executor = opts.executor ?? db
  const provider = opts.provider ?? currentSendingProviderIdentity()
  const normalizedAddress = address.trim().toLowerCase()
  const domain = emailDomain(normalizedAddress)
  if (!domain) {
    return { status: 'unknown', reason: `Could not read a domain from "${address}"` }
  }

  const [platform] = await isPlatformAddressOfProject(executor, projectId, normalizedAddress)
  if (platform) return { status: 'authorized', domain: null, platform: true }

  const claims = await executor
    .select({
      id: projectMailDomain.id,
      domain: projectMailDomain.domain,
      status: projectMailDomain.status,
      provider: projectMailDomain.provider,
      providerAccountKey: projectMailDomain.providerAccountKey,
    })
    .from(projectMailDomain)
    .where(eq(projectMailDomain.projectId, projectId))

  const sameProvider = (c: (typeof claims)[number]) =>
    c.provider === provider.name && c.providerAccountKey === provider.accountKey

  // Another project's claim on this domain or a parent always wins, whatever the
  // flags or this project's own rows say.
  if (await isDomainClaimedByOtherProject(projectId, domain, executor)) {
    const own = claims
      .filter((c) => c.status === 'verified' && sameProvider(c))
      .map((c) => c.domain)
      .sort()
    return { status: 'unauthorized', reason: 'not_owned', projectDomains: own }
  }

  const options = { includeSubdomains: provider.authorizesSubdomains }
  const matching = (rows: typeof claims) => {
    const best = matchVerifiedDomain(
      domain,
      rows.map((c) => c.domain),
      options
    )
    return best ? (rows.find((c) => c.domain === best) ?? null) : null
  }
  const live = claims.filter((c) => c.status !== 'deleting')

  const authorized = matching(live.filter((c) => c.status === 'verified' && sameProvider(c)))
  if (authorized) return { status: 'authorized', domain: { id: authorized.id, domain: authorized.domain } }

  const pending = matching(live.filter((c) => UNVERIFIED_STATUSES.includes(c.status as SupportSendingDomainStatus)))
  if (pending) {
    return {
      status: 'pending',
      domain: { id: pending.id, domain: pending.domain, status: pending.status as SupportSendingDomainStatus },
    }
  }

  const projectDomains = live
    .filter((c) => c.status === 'verified' && sameProvider(c))
    .map((c) => c.domain)
    .sort()

  if (matching(live.filter((c) => c.status === 'suspended'))) {
    return { status: 'unauthorized', reason: 'suspended', projectDomains }
  }
  if (matching(live.filter((c) => c.status === 'verified' && !sameProvider(c)))) {
    return { status: 'unauthorized', reason: 'provider_mismatch', projectDomains }
  }
  return { status: 'unauthorized', reason: 'not_owned', projectDomains }
}

/**
 * The inbox-save rule (design §4.5): under `project` policy the From address must
 * sit on one of the project's own claims (any status except `deleting`; a pending
 * domain is allowed so projects can set up ahead of verification) or be one of its
 * platform addresses. Under `legacy` policy only another project's claim is refused.
 */
export async function assertSenderAddressAllowedForInbox(projectId: string, address: string): Promise<void> {
  const normalizedAddress = address.trim().toLowerCase()
  const domain = emailDomain(normalizedAddress)
  if ((await resolveEffectiveSenderPolicy()) !== 'project') {
    // Legacy keeps free-text From addresses, except on another project's claim
    // (uncached read: a rare write, and a stale cache must not let it through).
    if (domain && (await isDomainClaimedByOtherProject(projectId, domain))) {
      throw sendingDomainError(
        422,
        'Unprocessable Entity',
        'SENDER_DOMAIN_NOT_OWNED',
        `${domain} is not a sending domain of this project.`
      )
    }
    return
  }
  const denied = () =>
    sendingDomainError(
      422,
      'Unprocessable Entity',
      'SENDER_DOMAIN_NOT_OWNED',
      domain
        ? `${domain} is not a sending domain of this project. Add and verify it in Project settings → Email first.`
        : 'Enter a valid From address.'
    )
  if (!domain) throw denied()

  const [platform] = await isPlatformAddressOfProject(db, projectId, normalizedAddress)
  if (platform) return

  const provider = currentSendingProviderIdentity()
  const claims = await db
    .select({ domain: projectMailDomain.domain })
    .from(projectMailDomain)
    .where(and(eq(projectMailDomain.projectId, projectId), ne(projectMailDomain.status, 'deleting')))

  const owned = matchVerifiedDomain(
    domain,
    claims.map((c) => c.domain),
    { includeSubdomains: provider.authorizesSubdomains }
  )
  if (!owned) throw denied()
}

/** `acme.com`, `a.acme.com` -> every suffix at a label boundary, longest first. */
function domainAndAncestors(domain: string): string[] {
  const labels = domain.split('.')
  return labels.map((_, index) => labels.slice(index).join('.')).filter((name) => name.includes('.'))
}

/**
 * Postmark routes inbound mail by the To/Cc header (its payload has no
 * envelope recipient), so a header address on someone else's domain would
 * capture that mail. Mailgun and Frogmail route by envelope recipient.
 */
export function providerRoutesInboundByHeader(): boolean {
  // Inbound routing depends on the channel driver, not the sending-domain
  // provider (which may be the fake one in development).
  return (envValue('SUPPORT_CHANNEL_PROVIDER') || 'postmark').toLowerCase() === 'postmark'
}

/**
 * The receiving-address rule (design §9.3): under `project` policy, an address may
 * not sit on or under another project's claim (any status), and may not use the
 * platform domain (those addresses are system-generated). On a provider that
 * routes by header (Postmark) the domain must also be on the project's own
 * verified claim (`422 ADDRESS_DOMAIN_UNVERIFIED`); elsewhere unclaimed
 * domains stay allowed. A no-op under `legacy` policy.
 */
export async function assertReceivingAddressAllowed(projectId: string, address: string): Promise<void> {
  if ((await resolveEffectiveSenderPolicy()) !== 'project') return

  const domain = emailDomain(address.trim().toLowerCase())
  if (!domain) return

  const platformDomain = domainFromEnvAddress(envValue('SUPPORT_PLATFORM_MAIL_DOMAIN'))
  if (platformDomain && isSameOrSubdomain(domain, platformDomain)) {
    throw sendingDomainError(
      422,
      'Unprocessable Entity',
      'ADDRESS_DOMAIN_RESERVED',
      'Addresses on the platform mail domain are generated by Veerify and cannot be added by hand.'
    )
  }

  const [other] = await db
    .select({ id: projectMailDomain.id })
    .from(projectMailDomain)
    .where(
      and(inArray(projectMailDomain.domain, domainAndAncestors(domain)), ne(projectMailDomain.projectId, projectId))
    )
    .limit(1)

  if (other) {
    throw sendingDomainError(
      409,
      'Conflict',
      'ADDRESS_DOMAIN_CLAIMED',
      'This domain is registered by another Veerify workspace, so it cannot receive mail for this inbox.'
    )
  }

  if (providerRoutesInboundByHeader()) {
    const provider = currentSendingProviderIdentity()
    const own = await db
      .select({ domain: projectMailDomain.domain })
      .from(projectMailDomain)
      .where(
        and(
          eq(projectMailDomain.projectId, projectId),
          eq(projectMailDomain.status, 'verified'),
          eq(projectMailDomain.provider, provider.name),
          eq(projectMailDomain.providerAccountKey, provider.accountKey)
        )
      )
    if (!own.some((claim) => isSameOrSubdomain(domain, claim.domain))) {
      throw sendingDomainError(
        422,
        'Unprocessable Entity',
        'ADDRESS_DOMAIN_UNVERIFIED',
        'With this mail provider, a receiving address must be on one of your verified domains. Verify the domain in Project settings → Email, or forward to the inbox platform address instead.'
      )
    }
  }
}
