/**
 * Monthly forward limit enforcement (design: E3 build → Usage and pause).
 *
 * Per workspace with receiving domains: sum Frogmail's `forwarded` for the calendar month (UTC), compare with the
 * tier's `forwardsPerMonth`. At or over the limit every domain is paused (`setForwardingPaused(true)`,
 * `forwarding_paused_at`). Below it (new month, or a tier change) only domains Veerify paused are resumed.
 * The admins of each project whose domains changed get one email per change (paused, resumed).
 * A failure for one domain or workspace is logged and does not stop the pass.
 */
import { and, eq, isNotNull, isNull, ne } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { projectMailDomain } from '~/server/database/schema/support'
import { mailLimitsFor } from '~/lib/mail-plans'
import { getSendingDomainProvider, type SendingDomainProvider } from '~/server/services/sending-domains'
import { fetchForwardCount, listReceivingDomains, setCachedForwardCount } from '~/server/utils/mail-forward-count'
import { getMailTier } from '~/server/utils/mail-limits'
import { createLogger } from '~/server/utils/logger'
import { notifyForwardingChange } from '~/server/utils/mail-setup-notifications'

const logger = createLogger('mail-forward-usage')

export interface MailForwardUsageResult {
  workspaces: number
  paused: number
  resumed: number
  errors: number
}

export interface EnforceForwardLimitDeps {
  /** Emails the admins of the projects whose domains just changed. */
  notify?: typeof notifyForwardingChange
}

export async function enforceForwardLimit(
  provider: SendingDomainProvider,
  organizationId: string,
  now: Date = new Date(),
  deps: EnforceForwardLimitDeps = {}
): Promise<{ paused: number; resumed: number; errors: number }> {
  const outcome = { paused: 0, resumed: 0, errors: 0 }
  const domains = await listReceivingDomains(organizationId)
  if (domains.length === 0) return outcome

  const forwarded = await fetchForwardCount(
    provider,
    domains.map((row) => row.domain),
    now
  )
  setCachedForwardCount(organizationId, forwarded, now.getTime())

  const limit = mailLimitsFor(await getMailTier(organizationId)).forwardsPerMonth
  const overLimit = forwarded >= limit
  // Projects whose domains this pass actually changed. The updates are guarded on the
  // previous state, so a concurrent pass cannot notify the same change twice.
  const pausedProjects: string[] = []
  const resumedProjects: string[] = []

  for (const domain of domains) {
    try {
      if (overLimit && !domain.forwardingPausedAt) {
        await provider.setForwardingPaused!(domain.domain, true)
        const changed = await db
          .update(projectMailDomain)
          .set({ forwardingPausedAt: now, updatedAt: now })
          .where(and(eq(projectMailDomain.id, domain.id), isNull(projectMailDomain.forwardingPausedAt)))
          .returning({ projectId: projectMailDomain.projectId })
        outcome.paused += 1
        pausedProjects.push(...changed.map((row) => row.projectId))
      } else if (!overLimit && domain.forwardingPausedAt) {
        await provider.setForwardingPaused!(domain.domain, false)
        const changed = await db
          .update(projectMailDomain)
          .set({ forwardingPausedAt: null, updatedAt: now })
          .where(and(eq(projectMailDomain.id, domain.id), isNotNull(projectMailDomain.forwardingPausedAt)))
          .returning({ projectId: projectMailDomain.projectId })
        outcome.resumed += 1
        resumedProjects.push(...changed.map((row) => row.projectId))
      }
    } catch (error) {
      outcome.errors += 1
      logger.error('Could not change forwarding pause for a domain', {
        organizationId,
        domain: domain.domain,
        error: error instanceof Error ? error.message : error,
      })
    }
  }

  const notify = deps.notify ?? notifyForwardingChange
  if (pausedProjects.length > 0) await notify('paused', pausedProjects, { forwardsPerMonth: limit })
  if (resumedProjects.length > 0) await notify('resumed', resumedProjects, { forwardsPerMonth: limit })
  return outcome
}

export async function runMailForwardUsage(now: Date = new Date()): Promise<MailForwardUsageResult> {
  const result: MailForwardUsageResult = { workspaces: 0, paused: 0, resumed: 0, errors: 0 }
  const provider = getSendingDomainProvider()
  if (!provider?.capabilities.forwarding || !provider.getDomainUsage || !provider.setForwardingPaused) return result

  const rows = await db
    .selectDistinct({ organizationId: project.organizationId })
    .from(projectMailDomain)
    .innerJoin(project, eq(project.id, projectMailDomain.projectId))
    .where(
      and(
        isNotNull(projectMailDomain.receivingStatus),
        ne(projectMailDomain.receivingStatus, 'disabled'),
        ne(projectMailDomain.status, 'deleting')
      )
    )

  for (const { organizationId } of rows) {
    result.workspaces += 1
    try {
      const outcome = await enforceForwardLimit(provider, organizationId, now)
      result.paused += outcome.paused
      result.resumed += outcome.resumed
      result.errors += outcome.errors
    } catch (error) {
      result.errors += 1
      logger.error('Forward usage pass failed for a workspace', {
        organizationId,
        error: error instanceof Error ? error.message : error,
      })
    }
  }
  return result
}
