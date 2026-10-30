/**
 * Workspace mail tier and usage. Limits come from `lib/mail-plans.ts`; the tier
 * from `mail_entitlement` (no row = standard). Callers that create domains or
 * addresses must count inside the same transaction that inserts, after taking
 * `lockMailUsage`, so two concurrent requests cannot both pass the check.
 */
import { and, count, eq, inArray, ne, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { projectMailAddress, projectMailDomain } from '~/server/database/schema/support'
import { mailEntitlement } from '~/server/database/schema/mail'
import { DEFAULT_MAIL_TIER, isMailTier, mailLimitsFor, type MailTier, type MailUsage } from '~/lib/mail-plans'
import { getForwardsThisMonth } from '~/server/utils/mail-forward-count'
import { createErrorResponse } from '~/server/utils/response'

type Executor = Pick<typeof db, 'select' | 'execute'>

/** Domain statuses that still wait for DNS verification. */
const PENDING_DOMAIN_STATUSES = ['provisioning', 'pending', 'failed']

export async function getMailTier(organizationId: string, executor: Executor = db): Promise<MailTier> {
  const [row] = await executor
    .select({ tier: mailEntitlement.tier })
    .from(mailEntitlement)
    .where(eq(mailEntitlement.organizationId, organizationId))
    .limit(1)
  return isMailTier(row?.tier) ? row.tier : DEFAULT_MAIL_TIER
}

export async function getOrganizationIdForProject(projectId: string, executor: Executor = db): Promise<string> {
  const [row] = await executor
    .select({ organizationId: project.organizationId })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  return row.organizationId
}

/** Serializes limit checks for one workspace until the surrounding transaction ends. */
export async function lockMailUsage(organizationId: string, executor: Executor) {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`mail_usage:${organizationId}`}, 0))`)
}

/**
 * `forwardsThisMonth` is asked from Frogmail (60 s cache) only for a plain `db` call. Inside a transaction (limit
 * checks under `lockMailUsage`) it only reads the cache: no network call while holding the lock.
 */
export async function getMailUsage(organizationId: string, executor: Executor = db): Promise<MailUsage> {
  const tier = await getMailTier(organizationId, executor)
  const projectIds = (
    await executor.select({ id: project.id }).from(project).where(eq(project.organizationId, organizationId))
  ).map((row) => row.id)

  let domains = 0
  let pendingDomains = 0
  let addresses = 0
  if (projectIds.length > 0) {
    const domainRows = await executor
      .select({ status: projectMailDomain.status })
      .from(projectMailDomain)
      .where(and(inArray(projectMailDomain.projectId, projectIds), ne(projectMailDomain.status, 'deleting')))
    domains = domainRows.length
    pendingDomains = domainRows.filter((row) => PENDING_DOMAIN_STATUSES.includes(row.status)).length

    const [addressCount] = await executor
      .select({ value: count() })
      .from(projectMailAddress)
      .where(and(inArray(projectMailAddress.projectId, projectIds), eq(projectMailAddress.kind, 'custom')))
    addresses = Number(addressCount?.value ?? 0)
  }

  const forwardsThisMonth = await getForwardsThisMonth(organizationId, { fresh: executor === db })

  return {
    tier,
    limits: mailLimitsFor(tier),
    used: { domains, pendingDomains, addresses, forwardsThisMonth },
  }
}

export function mailLimitError(code: string, message: string) {
  return createError({
    statusCode: 409,
    statusMessage: 'Conflict',
    data: { ...createErrorResponse(code, message), code },
  })
}

/** 409 MAIL_ADDRESS_LIMIT_REACHED when one more custom address would exceed the workspace limit. */
export async function assertCanAddMailAddress(organizationId: string, executor: Executor) {
  const usage = await getMailUsage(organizationId, executor)
  if (usage.used.addresses >= usage.limits.addresses) {
    throw mailLimitError(
      'MAIL_ADDRESS_LIMIT_REACHED',
      `This workspace can have at most ${usage.limits.addresses} email addresses.`
    )
  }
}

/** 409 MAIL_DOMAIN_LIMIT_REACHED / MAIL_PENDING_LIMIT_REACHED when one more domain would exceed the workspace limits. */
export async function assertCanAddMailDomain(organizationId: string, executor: Executor) {
  const usage = await getMailUsage(organizationId, executor)
  if (usage.used.domains >= usage.limits.domains) {
    throw mailLimitError(
      'MAIL_DOMAIN_LIMIT_REACHED',
      `This workspace can have at most ${usage.limits.domains} email domains.`
    )
  }
  if (usage.used.pendingDomains >= usage.limits.pendingDomains) {
    throw mailLimitError(
      'MAIL_PENDING_LIMIT_REACHED',
      `This workspace can have at most ${usage.limits.pendingDomains} domains waiting for verification. Verify or delete one first.`
    )
  }
}
