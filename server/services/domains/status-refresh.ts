import { and, asc, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm'
import { sendCustomDomainVerifiedEmail } from '~/lib/email'
import { db } from '~/server/database/drizzle'
import { member, user } from '~/server/database/schema/auth'
import { project, projectDomain } from '~/server/database/schema/feedback'
import { createLogger } from '~/server/utils/logger'
import type { DomainDnsRecord, DomainProviderResult } from './provider'
import { resolveDomainProviderName } from './provider-name'
import { CloudflareSaasDomainProvider } from './providers/cloudflare-saas'
import { normalizeDomainSettings, shouldSendDomainVerifiedEmail } from './domain-service'

/**
 * Re-checks custom board domains against Cloudflare for SaaS so the stored
 * status follows Cloudflare without an owner clicking "Verify": a domain whose
 * CNAME was just added goes live, and an expired certificate or a hostname
 * Cloudflare blocked or lost shows up as an error.
 *
 * Read-only towards Cloudflare: it never registers, re-validates or deletes a
 * hostname. "Verify" in the dashboard still does those.
 */

const logger = createLogger('domain-status-refresh')

const PROVIDER = 'cloudflare-saas'
export const DOMAIN_REFRESH_BATCH_SIZE = 25
/** Domains that are not active yet are checked again after this long. */
export const PENDING_RECHECK_MS = 10 * 60 * 1000
/** Active domains are checked again after this long. */
export const ACTIVE_RECHECK_MS = 6 * 60 * 60 * 1000

export interface DueDomain {
  id: string
  projectId: string
  organizationId: string
  projectName: string
  hostname: string
  providerDomainId: string | null
  status: string
  dnsRecords: DomainDnsRecord[] | null
}

export interface RefreshProvider {
  isZoneHostname(hostname: string): Promise<boolean>
  lookupProjectDomain(input: {
    hostname: string
    providerDomainId?: string | null
  }): Promise<DomainProviderResult | null>
}

export interface RefreshStore {
  listDue(now: Date, limit: number): Promise<DueDomain[]>
  /** Only records that the row was checked. */
  touch(domain: DueDomain, now: Date): Promise<void>
  /** Persists the result. Returns true when the "domain verified" email should go out. */
  apply(domain: DueDomain, result: DomainProviderResult, now: Date): Promise<boolean>
  listOrganizationAdmins(organizationId: string): Promise<Array<{ email: string; name: string | null }>>
}

export interface RefreshSummary {
  checked: number
  changed: number
  activated: number
  skippedZone: number
  failed: number
  notified: number
  stoppedEarly: boolean
}

type VerifiedEmailSender = typeof sendCustomDomainVerifiedEmail

/** Result for a hostname that Cloudflare no longer has. The board cannot be served without it. */
export function missingHostnameResult(domain: DueDomain): DomainProviderResult {
  return {
    hostname: domain.hostname,
    provider: PROVIDER,
    verified: false,
    status: 'error',
    dnsRecords: domain.dnsRecords || [],
    configuredBy: 'CNAME',
    expected: null,
    resolvedTo: [],
    message: 'This domain is no longer registered with Cloudflare. Click Verify to register it again',
    providerDomainId: null,
  }
}

function errorStatusCode(error: unknown): number | undefined {
  const code = (error as { statusCode?: unknown })?.statusCode
  return typeof code === 'number' ? code : undefined
}

export async function runDomainStatusRefresh(options: {
  provider: RefreshProvider
  store: RefreshStore
  sendVerifiedEmail?: VerifiedEmailSender
  now?: Date
  limit?: number
}): Promise<RefreshSummary> {
  const { provider, store } = options
  const sendVerifiedEmail = options.sendVerifiedEmail ?? sendCustomDomainVerifiedEmail
  const now = options.now ?? new Date()
  const summary: RefreshSummary = {
    checked: 0,
    changed: 0,
    activated: 0,
    skippedZone: 0,
    failed: 0,
    notified: 0,
    stoppedEarly: false,
  }

  const due = await store.listDue(now, options.limit ?? DOMAIN_REFRESH_BATCH_SIZE)
  for (const domain of due) {
    let result: DomainProviderResult
    try {
      // Records in Veerify's own zone (e.g. feedback.veerify.io) are not custom hostnames.
      if (await provider.isZoneHostname(domain.hostname)) {
        await store.touch(domain, now)
        summary.skippedZone++
        continue
      }
      result =
        (await provider.lookupProjectDomain({
          hostname: domain.hostname,
          providerDomainId: domain.providerDomainId,
        })) || missingHostnameResult(domain)
    } catch (error) {
      // A failed lookup says nothing about the domain: keep its status, but move it
      // to the back of the queue so one bad row cannot block the others.
      summary.failed++
      const statusCode = errorStatusCode(error)
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('Domain status refresh failed', { hostname: domain.hostname, statusCode, error: message })
      await store.touch(domain, now)
      // Rate limiting and a rejected token affect every row; retry on the next run.
      if (statusCode === 429 || /API token/.test(message)) {
        summary.stoppedEarly = true
        break
      }
      continue
    }

    summary.checked++
    const notify = await store.apply(domain, result, now)
    if (result.status !== domain.status) {
      summary.changed++
      logger.info('Domain status changed', { hostname: domain.hostname, from: domain.status, to: result.status })
    }
    if (result.verified && domain.status !== 'active') summary.activated++

    if (notify) {
      const admins = await store.listOrganizationAdmins(domain.organizationId)
      for (const admin of admins) {
        try {
          await sendVerifiedEmail({
            to: admin.email,
            name: admin.name || 'there',
            projectName: domain.projectName,
            domain: domain.hostname,
          })
          summary.notified++
        } catch (error) {
          logger.error('Failed to send custom domain verified email', {
            hostname: domain.hostname,
            error: error instanceof Error ? error.message : error,
          })
        }
      }
    }
  }

  return summary
}

export function createDrizzleRefreshStore(): RefreshStore {
  return {
    async listDue(now, limit) {
      const pendingBefore = new Date(now.getTime() - PENDING_RECHECK_MS)
      const activeBefore = new Date(now.getTime() - ACTIVE_RECHECK_MS)
      const rows = await db
        .select({
          id: projectDomain.id,
          projectId: projectDomain.projectId,
          organizationId: project.organizationId,
          projectName: project.name,
          hostname: projectDomain.hostname,
          providerDomainId: projectDomain.providerDomainId,
          status: projectDomain.status,
          dnsRecords: projectDomain.dnsRecords,
        })
        .from(projectDomain)
        // Only the domain the project currently uses, not one it moved away from.
        .innerJoin(
          project,
          and(eq(project.id, projectDomain.projectId), eq(project.customDomain, projectDomain.hostname))
        )
        .where(
          and(
            ne(projectDomain.status, 'detached'),
            or(
              isNull(projectDomain.lastCheckedAt),
              and(eq(projectDomain.status, 'active'), lt(projectDomain.lastCheckedAt, activeBefore)),
              and(ne(projectDomain.status, 'active'), lt(projectDomain.lastCheckedAt, pendingBefore))
            )
          )
        )
        .orderBy(sql`${projectDomain.lastCheckedAt} asc nulls first`, asc(projectDomain.id))
        .limit(limit)
      // dns_records is stored as plain JSON; the provider wrote it as DomainDnsRecord[].
      return rows as DueDomain[]
    },

    async touch(domain, now) {
      await db.update(projectDomain).set({ lastCheckedAt: now }).where(eq(projectDomain.id, domain.id))
    },

    async apply(domain, result, now) {
      return db.transaction(async (tx) => {
        // Lock the project so a concurrent run or a "Verify" click cannot send the email twice.
        const [owner] = await tx
          .select({ settings: project.settings, customDomain: project.customDomain })
          .from(project)
          .where(eq(project.id, domain.projectId))
          .for('update')
          .limit(1)
        if (!owner || owner.customDomain !== domain.hostname) return false

        const [current] = await tx
          .select({ status: projectDomain.status, activatedAt: projectDomain.activatedAt })
          .from(projectDomain)
          .where(eq(projectDomain.id, domain.id))
          .for('update')
          .limit(1)
        if (!current || current.status === 'detached') return false

        await tx
          .update(projectDomain)
          .set({
            provider: PROVIDER,
            ...(result.providerDomainId ? { providerDomainId: result.providerDomainId } : {}),
            status: result.status,
            verificationPayload: {
              configuredBy: result.configuredBy,
              expected: result.expected,
              resolvedTo: result.resolvedTo,
            },
            dnsRecords: result.dnsRecords,
            lastCheckedAt: now,
            ...(result.verified && !current.activatedAt ? { activatedAt: now } : {}),
            errorMessage: result.status === 'error' ? result.message : null,
            updatedAt: now,
          })
          .where(eq(projectDomain.id, domain.id))

        const settings = normalizeDomainSettings(owner.settings)
        const notify = shouldSendDomainVerifiedEmail({
          verified: result.verified,
          domain: domain.hostname,
          settings,
          previousStatus: current.status,
        })
        // Mirror the provider state without touching the email flags, as the sync script does.
        settings.domainProvider = PROVIDER
        settings.domainStatus = result.status
        settings.domainDnsRecords = result.dnsRecords
        settings.domainExpected = result.expected
        settings.domainConfiguredBy = result.configuredBy
        settings.domainMessage = result.message
        settings.domainLastCheckedAt = now.toISOString()
        if (result.verified) settings.domainVerifiedAt = settings.domainVerifiedAt || now.toISOString()
        if (notify) {
          settings.domainVerifiedEmailSentFor = domain.hostname
          settings.domainVerifiedEmailSentAt = now.toISOString()
        }
        await tx.update(project).set({ settings, updatedAt: now }).where(eq(project.id, domain.projectId))
        return notify
      })
    },

    async listOrganizationAdmins(organizationId) {
      return db
        .select({ email: user.email, name: user.name })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(and(eq(member.organizationId, organizationId), inArray(member.role, ['owner', 'admin'])))
    },
  }
}

/** Scheduled entry point. Does nothing unless Cloudflare for SaaS is the domain provider. */
export async function refreshCustomDomainStatuses() {
  const config = useRuntimeConfig()
  if (resolveDomainProviderName(config.domainProvider) !== PROVIDER) {
    return { skipped: 'domain provider is not cloudflare-saas' }
  }
  return runDomainStatusRefresh({
    provider: new CloudflareSaasDomainProvider(),
    store: createDrizzleRefreshStore(),
  })
}
