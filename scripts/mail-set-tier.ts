/**
 * Set a workspace's mail tier (design docs/plans/2026-10-28-email-addresses/design.md → Limits).
 *
 * `owner` is Frogbyte's own tier and has no UI; until billing writes
 * `mail_entitlement`, an operator sets it here.
 *
 * Usage:
 *   yarn mail:set-tier <workspace-slug> <standard|owner>
 *
 * Upserts the workspace's `mail_entitlement` row with `updatedBy =
 * script:<os user>` and prints the old tier, the new tier and the resulting
 * usage against the new limits. The repository has no general audit log for
 * operator actions, so `updatedBy` / `updatedAt` on the row are the trail.
 * Exits non-zero on an unknown workspace slug or tier. A workspace over the
 * new limits keeps what it has; it just cannot add more.
 */
import { randomUUID } from 'node:crypto'
import { userInfo } from 'node:os'
import { pathToFileURL } from 'node:url'
import { eq } from 'drizzle-orm'
import { db } from '../server/database/drizzle'
import { organization } from '../server/database/schema/auth'
import { mailEntitlement } from '../server/database/schema/mail'
import { MAIL_TIER_KEYS, isMailTier, type MailTier, type MailUsage } from '../lib/mail-plans'
import { getMailTier, getMailUsage } from '../server/utils/mail-limits'
import 'dotenv/config'

export class MailTierScriptError extends Error {}

export interface SetMailTierResult {
  organization: { id: string; slug: string; name: string }
  previousTier: MailTier
  /** Whether a `mail_entitlement` row existed before (no row means `standard`). */
  hadEntitlement: boolean
  tier: MailTier
  updatedBy: string
  usage: MailUsage
}

export function scriptActor(): string {
  let name = ''
  try {
    name = userInfo().username
  } catch {
    // No passwd entry (some containers): fall back to the environment.
  }
  name = (name || process.env.USER || process.env.LOGNAME || 'unknown').trim()
  return `script:${name || 'unknown'}`
}

export async function setMailTier(input: {
  slug: string
  tier: string
  actor?: string
  now?: Date
}): Promise<SetMailTierResult> {
  const tier = input.tier.trim().toLowerCase()
  if (!isMailTier(tier)) {
    throw new MailTierScriptError(`Unknown tier "${input.tier}". Use one of: ${MAIL_TIER_KEYS.join(', ')}.`)
  }
  const slug = input.slug.trim().toLowerCase()
  const actor = input.actor ?? scriptActor()
  const now = input.now ?? new Date()

  return db.transaction(async (tx) => {
    const [org] = await tx
      .select({ id: organization.id, slug: organization.slug, name: organization.name })
      .from(organization)
      .where(eq(organization.slug, slug))
      .limit(1)
    if (!org) throw new MailTierScriptError(`No workspace with slug "${input.slug}".`)

    const [existing] = await tx
      .select({ id: mailEntitlement.id })
      .from(mailEntitlement)
      .where(eq(mailEntitlement.organizationId, org.id))
      .limit(1)
    const previousTier = await getMailTier(org.id, tx)

    await tx
      .insert(mailEntitlement)
      .values({ id: randomUUID(), organizationId: org.id, tier, updatedBy: actor, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: mailEntitlement.organizationId,
        set: { tier, updatedBy: actor, updatedAt: now },
      })

    const usage = await getMailUsage(org.id, tx)
    return {
      organization: { id: org.id, slug: org.slug ?? slug, name: org.name },
      previousTier,
      hadEntitlement: Boolean(existing),
      tier,
      updatedBy: actor,
      usage,
    }
  })
}

export function formatResult(result: SetMailTierResult): string {
  const { usage } = result
  const line = (label: string, used: number | null, limit: number) =>
    `  ${label.padEnd(18)} ${used === null ? '-' : used} / ${limit}${used !== null && used > limit ? '  (over the limit: nothing new can be added)' : ''}`
  return [
    `Workspace ${result.organization.name} (${result.organization.slug}, ${result.organization.id})`,
    `Tier: ${result.previousTier}${result.hadEntitlement ? '' : ' (default, no entitlement row)'} -> ${result.tier}` +
      (result.previousTier === result.tier ? ' (unchanged)' : ''),
    `Updated by: ${result.updatedBy}`,
    'Usage / limits:',
    line('Domains', usage.used.domains, usage.limits.domains),
    line('Pending domains', usage.used.pendingDomains, usage.limits.pendingDomains),
    line('Addresses', usage.used.addresses, usage.limits.addresses),
    line('Forwards (month)', usage.used.forwardsThisMonth, usage.limits.forwardsPerMonth),
  ].join('\n')
}

const USAGE = `Usage: yarn mail:set-tier <workspace-slug> <${MAIL_TIER_KEYS.join('|')}>`

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return
  }
  if (args.length !== 2) {
    console.error(USAGE)
    process.exitCode = 1
    return
  }
  try {
    const result = await setMailTier({ slug: args[0], tier: args[1] })
    console.log(formatResult(result))
  } catch (error) {
    if (error instanceof MailTierScriptError) {
      console.error(`[mail:set-tier] ${error.message}`)
      process.exitCode = 1
      return
    }
    throw error
  }
}

async function closePool() {
  await (db as unknown as { $client?: { end?: () => Promise<void> } }).$client?.end?.()
}

// Run only when executed directly (tsx scripts/mail-set-tier.ts), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error('[mail:set-tier] failed:', error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
    .finally(closePool)
}
