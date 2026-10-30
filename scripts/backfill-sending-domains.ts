/**
 * Backfill customer sending-domain claims before enabling the `project` sender
 * policy (design docs/plans/2026-10-22-custom-sending-domains/design.md §13
 * step 2, §14).
 *
 * Projects that already send from their own domain (inbox From addresses set up by
 * hand before self-serve domains existed) would lose sending the moment `project`
 * policy turns on. This script finds every From domain in use and, for domains
 * used by exactly one project that the provider already has `active`, creates an
 * adopted `pending` claim, so the project only has to publish the ownership TXT.
 *
 * Usage:
 *   yarn db:backfill-sending-domains                 # dry run, readable report
 *   yarn db:backfill-sending-domains --json          # dry run, machine output
 *   yarn db:backfill-sending-domains --apply         # write the claims
 *   yarn db:backfill-sending-domains --apply --i-know-this-is-production
 *
 * Options:
 *   --project <id>         limit to one project (repeatable)
 *   --delay-ms <n>      pause between provider calls (default 600, the provider allows 120/min)
 *
 * Idempotent: a domain that already has a claim is reported and left alone, so
 * a second run changes nothing. Domains used by several projects are never
 * assigned automatically.
 */
import { pathToFileURL } from 'node:url'
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import { db } from '../server/database/drizzle'
import { createDatabaseConnectionConfig } from '../server/database/connection-config'
import { member } from '../server/database/schema/auth'
import { project, projectMember } from '../server/database/schema/feedback'
import { supportInbox, projectMailAddress, projectMailDomain } from '../server/database/schema/support'
import {
  PENDING_TTL_DAYS,
  getRegistrableDomain,
  isSameOrSubdomain,
  normalizeSendingDomain,
  validateSendingDomain,
  type SendingDomainDnsRecord,
} from '../lib/support-sending-domains'
import { createSendingDomainClaim, reservedSendingDomains } from '../server/utils/sending-domains'
import { getSendingDomainProvider } from '../server/services/sending-domains'
import { ownershipRecord } from '../server/services/sending-domains/ownership'
import { SendingDomainProviderError, type SendingDomainProvider } from '../server/services/sending-domains/types'
import { emailDomain } from '../server/services/support-channels/types'
import 'dotenv/config'

export type BackfillAction =
  | 'created'
  | 'would_create'
  | 'already_claimed'
  | 'covered_by_parent'
  | 'conflict_multiple_projects'
  | 'conflict_claimed_elsewhere'
  | 'not_on_provider'
  | 'not_active_on_provider'
  | 'blocked'
  | 'provider_error'
  | 'skipped'

export interface BackfillProjectRef {
  id: string
  name: string
}

export interface BackfillEntry {
  domain: string
  projects: BackfillProjectRef[]
  action: BackfillAction
  reason: string
  /** TXT record the project must publish (claims created now, or still unverified). */
  txtRecord?: { name: string; value: string }
}

export interface BackfillSummary {
  domainsFound: number
  claimsCreated: number
  claimsWouldCreate: number
  alreadyClaimed: number
  conflicts: number
  notOnProvider: number
  blocked: number
  errors: number
  skipped: number
  projectsNeedingDns: number
}

export interface BackfillReport {
  mode: 'dry-run' | 'apply'
  provider: string
  entries: BackfillEntry[]
  summary: BackfillSummary
}

export interface BackfillOptions {
  apply: boolean
  projectIds?: string[]
  delayMs?: number
  now?: Date
}

export interface BackfillDeps {
  provider?: SendingDomainProvider | null
  // eslint-disable-next-line no-unused-vars
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_DELAY_MS = 600
const UNVERIFIED = ['provisioning', 'pending', 'failed']

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Why this run looks like it targets production, or null. */
export function productionDatabaseReason(
  env: NodeJS.ProcessEnv = process.env,
  host: string | undefined = connectionHost(env)
): string | null {
  if (env.NODE_ENV === 'production') return 'NODE_ENV=production'
  const normalized = (host ?? '').trim().toLowerCase()
  if (!normalized || normalized.startsWith('/')) return null
  if (['localhost', '127.0.0.1', '::1', 'postgres', 'db'].includes(normalized)) return null
  return `the database host "${normalized}" is not local`
}

function connectionHost(env: NodeJS.ProcessEnv): string | undefined {
  const config = createDatabaseConnectionConfig(env)
  if (config.host) return config.host
  if (config.connectionString) {
    try {
      return new URL(config.connectionString).hostname
    } catch {
      return config.connectionString.startsWith('/') ? '/' : undefined
    }
  }
  return 'localhost'
}

interface UsageRow {
  projectId: string
  address: string
}

async function collectUsage(projectIds?: string[]): Promise<UsageRow[]> {
  const scope = projectIds && projectIds.length > 0 ? inArray(supportInbox.projectId, projectIds) : undefined
  const primary = await db
    .select({ projectId: supportInbox.projectId, address: supportInbox.emailAddress })
    .from(supportInbox)
    .where(and(isNotNull(supportInbox.emailAddress), scope))
  const custom = await db
    .select({ projectId: supportInbox.projectId, address: projectMailAddress.address })
    .from(projectMailAddress)
    .innerJoin(supportInbox, eq(supportInbox.id, projectMailAddress.inboxId))
    .where(and(eq(projectMailAddress.kind, 'custom'), scope))
  return [...primary, ...custom].flatMap((row) =>
    row.address ? [{ projectId: row.projectId, address: row.address }] : []
  )
}

function platformDomain(): string | null {
  const value = (process.env.SUPPORT_PLATFORM_MAIL_DOMAIN ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/\.+$/, '')
  return value || null
}

async function pickClaimUser(projectId: string): Promise<string | null> {
  const [owning] = await db
    .select({ organizationId: project.organizationId })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1)
  if (!owning) return null

  const [projectAdmin] = await db
    .select({ userId: projectMember.userId })
    .from(projectMember)
    .where(and(eq(projectMember.projectId, projectId), eq(projectMember.role, 'admin')))
    .orderBy(asc(projectMember.createdAt))
    .limit(1)
  if (projectAdmin) return projectAdmin.userId

  const [orgAdmin] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, owning.organizationId), inArray(member.role, ['owner', 'admin'])))
    .orderBy(asc(member.createdAt))
    .limit(1)
  return orgAdmin?.userId ?? null
}

// eslint-disable-next-line no-unused-vars
async function providerGet(provider: SendingDomainProvider, domain: string, sleep: (ms: number) => Promise<void>) {
  try {
    return await provider.get(domain)
  } catch (error) {
    // One polite retry when the provider says how long to wait.
    if (error instanceof SendingDomainProviderError && error.code === 'rate_limited' && error.retryAfterSeconds) {
      await sleep(Math.min(error.retryAfterSeconds, 60) * 1000)
      return provider.get(domain)
    }
    throw error
  }
}

function errorText(error: unknown): { code: string; message: string } {
  const e = error as { data?: { code?: string }; statusMessage?: string; message?: string; code?: string } | null
  return {
    code: e?.data?.code ?? e?.code ?? 'ERROR',
    message: e?.data?.code
      ? `${e.data.code}: ${e.statusMessage ?? e.message ?? 'rejected'}`
      : (e?.message ?? String(error)),
  }
}

export async function runBackfill(options: BackfillOptions, deps: BackfillDeps = {}): Promise<BackfillReport> {
  const provider = deps.provider === undefined ? getSendingDomainProvider() : deps.provider
  if (!provider) throw new Error('No sending-domain provider is configured (check SUPPORT_CHANNEL_PROVIDER).')
  const configured = provider.isConfigured()
  if (!configured.configured) {
    throw new Error(`The sending-domain provider is not configured: missing ${configured.missing.join(', ')}.`)
  }

  const sleep = deps.sleep ?? defaultSleep
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS
  const now = options.now ?? new Date()
  const allowTestTld = provider.name === 'fake'
  const reserved = reservedSendingDomains()
  const platform = platformDomain()

  // --- Collect: project -> domains -----------------------------------------------------------
  const usage = await collectUsage(options.projectIds)
  const projectDomains = new Map<string, Set<string>>()
  const skippedDomains = new Map<string, { projects: Set<string>; reason: string }>()

  for (const row of usage) {
    const domain = normalizeSendingDomain(emailDomain(row.address) ?? '')
    if (!domain) continue
    let skipReason: string | null = null
    if (platform && isSameOrSubdomain(domain, platform)) {
      skipReason = 'platform address, no claim needed'
    } else {
      skipReason = validateSendingDomain(domain, { reserved, allowTestTld })
      if (!skipReason && !getRegistrableDomain(domain, allowTestTld)) skipReason = 'not a registrable domain'
    }
    if (skipReason) {
      const entry = skippedDomains.get(domain) ?? { projects: new Set<string>(), reason: skipReason }
      entry.projects.add(row.projectId)
      skippedDomains.set(domain, entry)
      continue
    }
    const set = projectDomains.get(row.projectId) ?? new Set<string>()
    set.add(domain)
    projectDomains.set(row.projectId, set)
  }

  const involvedProjectIds = new Set<string>([
    ...projectDomains.keys(),
    ...[...skippedDomains.values()].flatMap((v) => [...v.projects]),
  ])
  const projectRows = involvedProjectIds.size
    ? await db
        .select({ id: project.id, name: project.name })
        .from(project)
        .where(inArray(project.id, [...involvedProjectIds]))
    : []
  const projectRef = (id: string): BackfillProjectRef => ({
    id,
    name: projectRows.find((t) => t.id === id)?.name ?? id,
  })

  // Existing claims (any status) for hierarchy and idempotency checks.
  const existing = await db.select().from(projectMailDomain)

  // --- Plan -------------------------------------------------------------------------------
  // Within a project a subdomain whose parent is also used by that project collapses into the parent.
  const covered = new Map<string, { projectId: string; parent: string }[]>() // domain -> collapsed (project, parent)
  const candidates = new Map<string, Set<string>>() // domain -> projects using it directly
  for (const [projectId, domains] of projectDomains) {
    for (const domain of domains) {
      const parent = [...domains]
        .filter((other) => other !== domain && isSameOrSubdomain(domain, other))
        .sort((a, b) => a.length - b.length)[0]
      if (parent) {
        covered.set(domain, [...(covered.get(domain) ?? []), { projectId, parent }])
      } else {
        candidates.set(domain, (candidates.get(domain) ?? new Set()).add(projectId))
      }
    }
  }

  const entries: BackfillEntry[] = []
  const dnsProjects = new Set<string>()

  for (const [domain, info] of [...skippedDomains].sort(([a], [b]) => a.localeCompare(b))) {
    entries.push({
      domain,
      projects: [...info.projects].map(projectRef),
      action: 'skipped',
      reason: info.reason,
    })
  }

  for (const [domain, items] of [...covered].sort(([a], [b]) => a.localeCompare(b))) {
    for (const item of items) {
      entries.push({
        domain,
        projects: [projectRef(item.projectId)],
        action: 'covered_by_parent',
        reason: `the same project uses ${item.parent}; only the parent is claimed`,
      })
    }
  }

  let needsDelay = false
  for (const [domain, projectSet] of [...candidates].sort(([a], [b]) => a.localeCompare(b))) {
    const projects = [...projectSet]
    const refs = projects.map(projectRef)

    if (projects.length > 1) {
      entries.push({
        domain,
        projects: refs,
        action: 'conflict_multiple_projects',
        reason: 'used by several projects; an operator must decide which project owns it. Nothing was assigned',
      })
      continue
    }
    const projectId = projects[0]

    // A parent or subdomain used by a different project makes the claim ambiguous too.
    const relatedProject = [...candidates].find(
      ([other, otherProjects]) =>
        other !== domain &&
        (isSameOrSubdomain(domain, other) || isSameOrSubdomain(other, domain)) &&
        [...otherProjects].some((t) => t !== projectId)
    )
    if (relatedProject) {
      entries.push({
        domain,
        projects: refs,
        action: 'conflict_multiple_projects',
        reason: `${relatedProject[0]} is used by another project; a parent and its subdomain cannot belong to different projects. Operator must resolve`,
      })
      continue
    }

    const own = existing.find((c) => c.domain === domain && c.projectId === projectId)
    if (own) {
      const unverified = UNVERIFIED.includes(own.status)
      entries.push({
        domain,
        projects: refs,
        action: 'already_claimed',
        reason: `already claimed by this project (status ${own.status})`,
        ...(unverified ? { txtRecord: txtOf(own.dnsRecords, domain, own.ownershipToken) } : {}),
      })
      if (unverified) dnsProjects.add(projectId)
      continue
    }
    const ownParent = existing.find((c) => c.projectId === projectId && isSameOrSubdomain(domain, c.domain))
    if (ownParent) {
      entries.push({
        domain,
        projects: refs,
        action: 'already_claimed',
        reason: `covered by this project's claim on ${ownParent.domain} (status ${ownParent.status})`,
      })
      continue
    }
    const other = existing.find(
      (c) => c.projectId !== projectId && (isSameOrSubdomain(domain, c.domain) || isSameOrSubdomain(c.domain, domain))
    )
    if (other) {
      entries.push({
        domain,
        projects: refs,
        action: 'conflict_claimed_elsewhere',
        reason:
          other.domain === domain
            ? 'already claimed by another project. Nothing changed'
            : `${other.domain} is claimed by another project. Nothing changed`,
      })
      continue
    }

    // Free to claim: ask the provider.
    if (needsDelay && delayMs > 0) await sleep(delayMs)
    needsDelay = true
    let result
    try {
      result = await providerGet(provider, domain, sleep)
    } catch (error) {
      entries.push({ domain, projects: refs, action: 'provider_error', reason: errorText(error).message })
      continue
    }
    if (!result) {
      entries.push({
        domain,
        projects: refs,
        action: 'not_on_provider',
        reason: `not on provider (${provider.name}) - the project must add it`,
      })
      continue
    }
    if (result.state !== 'active') {
      entries.push({
        domain,
        projects: refs,
        action: 'not_active_on_provider',
        reason: result.contested
          ? `on provider but owned by another project (${result.message ?? 'contested'}) - nothing created`
          : `on provider but not active yet (${result.state}) - the project must finish the provider DNS first`,
      })
      continue
    }

    if (!options.apply) {
      entries.push({
        domain,
        projects: refs,
        action: 'would_create',
        reason: 'active on provider; would create an adopted pending claim (project then publishes the TXT record)',
      })
      dnsProjects.add(projectId)
      continue
    }

    try {
      const userId = await pickClaimUser(projectId)
      // created_by_user_id is nullable; a project with no members at all gets a claim without a creator.
      const claim = await createSendingDomainClaim({
        projectId,
        domain,
        userId: userId as string,
        provider: provider.name,
        providerAccountKey: provider.accountKey,
        now,
      })
      const txt = ownershipRecord(domain, claim.ownershipToken)
      await db
        .update(projectMailDomain)
        .set({
          status: 'pending',
          providerOwnership: 'adopted',
          providerState: 'active',
          receivesViaProvider: result.receivesMail,
          dnsRecords: [txt, ...result.records] satisfies SendingDomainDnsRecord[],
          nextCheckAt: now,
          expiresAt: new Date(now.getTime() + PENDING_TTL_DAYS * 24 * 60 * 60 * 1000),
          updatedAt: now,
        })
        .where(eq(projectMailDomain.id, claim.id))
      entries.push({
        domain,
        projects: refs,
        action: 'created',
        reason: 'active on provider; created an adopted pending claim. The project must publish the TXT record',
        txtRecord: { name: txt.name, value: txt.value },
      })
      dnsProjects.add(projectId)
    } catch (error) {
      const { code, message } = errorText(error)
      const rule = [
        'DOMAIN_CLAIMED',
        'DOMAIN_REJECTED',
        'MAIL_DOMAIN_LIMIT_REACHED',
        'MAIL_PENDING_LIMIT_REACHED',
      ].includes(code)
      entries.push({
        domain,
        projects: refs,
        action: rule ? 'blocked' : 'provider_error',
        reason: rule ? `claim rules refused it - ${message}` : `claim failed - ${message}`,
      })
    }
  }

  const count = (...actions: BackfillAction[]) => entries.filter((e) => actions.includes(e.action)).length
  const summary: BackfillSummary = {
    domainsFound: new Set(entries.map((e) => e.domain)).size,
    claimsCreated: count('created'),
    claimsWouldCreate: count('would_create'),
    alreadyClaimed: count('already_claimed', 'covered_by_parent'),
    conflicts: count('conflict_multiple_projects', 'conflict_claimed_elsewhere'),
    notOnProvider: count('not_on_provider', 'not_active_on_provider'),
    blocked: count('blocked'),
    errors: count('provider_error'),
    skipped: count('skipped'),
    projectsNeedingDns: dnsProjects.size,
  }

  return { mode: options.apply ? 'apply' : 'dry-run', provider: provider.name, entries, summary }
}

function txtOf(records: SendingDomainDnsRecord[], domain: string, token: string) {
  const record = records.find((r) => r.purpose === 'ownership') ?? ownershipRecord(domain, token)
  return { name: record.name, value: record.value }
}

const ACTION_LABEL: Record<BackfillAction, string> = {
  created: 'CREATED',
  would_create: 'WOULD CREATE',
  already_claimed: 'ALREADY CLAIMED',
  covered_by_parent: 'COVERED BY PARENT',
  conflict_multiple_projects: 'CONFLICT (several projects)',
  conflict_claimed_elsewhere: 'CONFLICT (claimed elsewhere)',
  not_on_provider: 'NOT ON PROVIDER',
  not_active_on_provider: 'NOT ACTIVE ON PROVIDER',
  blocked: 'BLOCKED',
  provider_error: 'ERROR',
  skipped: 'SKIPPED',
}

export function formatReport(report: BackfillReport): string {
  const lines: string[] = []
  lines.push(
    `Sending-domain backfill (${report.mode === 'apply' ? 'APPLY' : 'DRY RUN, nothing written'}), provider: ${report.provider}`
  )
  lines.push('')
  if (report.entries.length === 0) lines.push('No From domains in use.')
  for (const entry of report.entries) {
    lines.push(entry.domain)
    lines.push(`  projects:  ${entry.projects.map((t) => `${t.name} (${t.id})`).join(', ')}`)
    lines.push(`  action: ${ACTION_LABEL[entry.action]}`)
    lines.push(`  reason: ${entry.reason}`)
    if (entry.txtRecord) lines.push(`  TXT:    ${entry.txtRecord.name}  "${entry.txtRecord.value}"`)
    lines.push('')
  }
  const s = report.summary
  lines.push('Summary')
  lines.push(`  domains found:           ${s.domainsFound}`)
  lines.push(
    `  claims created:          ${s.claimsCreated}${report.mode === 'dry-run' ? ` (would create: ${s.claimsWouldCreate})` : ''}`
  )
  lines.push(`  already claimed/covered: ${s.alreadyClaimed}`)
  lines.push(`  conflicts:               ${s.conflicts}`)
  lines.push(`  not on provider/active:  ${s.notOnProvider}`)
  lines.push(`  blocked by claim rules:  ${s.blocked}`)
  lines.push(`  errors:                  ${s.errors}`)
  lines.push(`  skipped:                 ${s.skipped}`)
  lines.push(`  projects needing DNS action: ${s.projectsNeedingDns}`)
  if (report.mode === 'dry-run') lines.push('', 'Dry run. Re-run with --apply to create the claims.')
  return lines.join('\n')
}

export function parseArgs(argv: string[]): {
  apply: boolean
  json: boolean
  production: boolean
  help: boolean
  projectIds: string[]
  delayMs?: number
} {
  const out = {
    apply: false,
    json: false,
    production: false,
    help: false,
    projectIds: [] as string[],
    delayMs: undefined as number | undefined,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const [flag, inline] = arg.split('=', 2)
    const value = () => inline ?? argv[++i]
    if (arg === '--apply') out.apply = true
    else if (arg === '--json') out.json = true
    else if (arg === '--i-know-this-is-production') out.production = true
    else if (arg === '--help' || arg === '-h') out.help = true
    else if (flag === '--project') out.projectIds.push(String(value()))
    else if (flag === '--delay-ms') {
      const n = Number(value())
      if (!Number.isFinite(n) || n < 0) throw new Error('--delay-ms needs a non-negative number')
      out.delayMs = n
    } else throw new Error(`Unknown option ${arg}`)
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(
      'Usage: yarn db:backfill-sending-domains [--apply] [--json] [--project <id>] [--delay-ms <n>] [--i-know-this-is-production]'
    )
    return
  }

  if (args.apply && !args.production) {
    const reason = productionDatabaseReason()
    if (reason) {
      console.error(
        `[backfill-sending-domains] Refusing --apply: ${reason}. Run without --apply to preview, ` +
          `or add --i-know-this-is-production if you are certain this is the database to change.`
      )
      process.exitCode = 1
      return
    }
  }

  const report = await runBackfill({ apply: args.apply, projectIds: args.projectIds, delayMs: args.delayMs })
  console.log(args.json ? JSON.stringify(report, null, 2) : formatReport(report))
  if (report.summary.errors > 0) process.exitCode = 1
}

async function closePool() {
  await (db as unknown as { $client?: { end?: () => Promise<void> } }).$client?.end?.()
}

// Run only when executed directly (tsx scripts/backfill-sending-domains.ts), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error('[backfill-sending-domains] failed:', error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
    .finally(closePool)
}
