/**
 * Backfill customer sending-domain claims before enabling the `team` sender
 * policy (design docs/plans/2026-10-22-custom-sending-domains/design.md §13
 * step 2, §14).
 *
 * Teams that already send from their own domain (inbox From addresses set up by
 * hand before self-serve domains existed) would lose sending the moment `team`
 * policy turns on. This script finds every From domain in use and, for domains
 * used by exactly one team that the provider already has `active`, creates an
 * adopted `pending` claim, so the team only has to publish the ownership TXT.
 *
 * Usage:
 *   yarn db:backfill-sending-domains                 # dry run, readable report
 *   yarn db:backfill-sending-domains --json          # dry run, machine output
 *   yarn db:backfill-sending-domains --apply         # write the claims
 *   yarn db:backfill-sending-domains --apply --i-know-this-is-production
 *
 * Options:
 *   --team <id>         limit to one team (repeatable)
 *   --delay-ms <n>      pause between provider calls (default 600, the provider allows 120/min)
 *
 * Idempotent: a domain that already has a claim is reported and left alone, so
 * a second run changes nothing. Domains used by several teams are never
 * assigned automatically.
 */
import { pathToFileURL } from 'node:url'
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import { db } from '../server/database/drizzle'
import { createDatabaseConnectionConfig } from '../server/database/connection-config'
import { team, teamMember } from '../server/database/schema/auth'
import { supportInbox, supportInboxAddress, supportSendingDomain } from '../server/database/schema/support'
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
  | 'conflict_multiple_teams'
  | 'conflict_claimed_elsewhere'
  | 'not_on_provider'
  | 'not_active_on_provider'
  | 'blocked'
  | 'provider_error'
  | 'skipped'

export interface BackfillTeamRef {
  id: string
  name: string
}

export interface BackfillEntry {
  domain: string
  teams: BackfillTeamRef[]
  action: BackfillAction
  reason: string
  /** TXT record the team must publish (claims created now, or still unverified). */
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
  teamsNeedingDns: number
}

export interface BackfillReport {
  mode: 'dry-run' | 'apply'
  provider: string
  entries: BackfillEntry[]
  summary: BackfillSummary
}

export interface BackfillOptions {
  apply: boolean
  teamIds?: string[]
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
  if (env.VERCEL_ENV === 'production') return 'VERCEL_ENV=production'
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
  teamId: string
  address: string
}

async function collectUsage(teamIds?: string[]): Promise<UsageRow[]> {
  const scope = teamIds && teamIds.length > 0 ? inArray(supportInbox.teamId, teamIds) : undefined
  const primary = await db
    .select({ teamId: supportInbox.teamId, address: supportInbox.emailAddress })
    .from(supportInbox)
    .where(and(isNotNull(supportInbox.emailAddress), scope))
  const custom = await db
    .select({ teamId: supportInbox.teamId, address: supportInboxAddress.address })
    .from(supportInboxAddress)
    .innerJoin(supportInbox, eq(supportInbox.id, supportInboxAddress.inboxId))
    .where(and(eq(supportInboxAddress.kind, 'custom'), scope))
  return [...primary, ...custom].flatMap((row) => (row.address ? [{ teamId: row.teamId, address: row.address }] : []))
}

function platformDomain(): string | null {
  const value = (process.env.SUPPORT_PLATFORM_MAIL_DOMAIN ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/\.+$/, '')
  return value || null
}

async function pickClaimUser(teamId: string): Promise<string | null> {
  const [admin] = await db
    .select({ userId: teamMember.userId })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.role, 'admin')))
    .orderBy(asc(teamMember.createdAt))
    .limit(1)
  if (admin) return admin.userId
  const [member] = await db
    .select({ userId: teamMember.userId })
    .from(teamMember)
    .where(eq(teamMember.teamId, teamId))
    .orderBy(asc(teamMember.createdAt))
    .limit(1)
  return member?.userId ?? null
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

  // --- Collect: team -> domains -----------------------------------------------------------
  const usage = await collectUsage(options.teamIds)
  const teamDomains = new Map<string, Set<string>>()
  const skippedDomains = new Map<string, { teams: Set<string>; reason: string }>()

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
      const entry = skippedDomains.get(domain) ?? { teams: new Set<string>(), reason: skipReason }
      entry.teams.add(row.teamId)
      skippedDomains.set(domain, entry)
      continue
    }
    const set = teamDomains.get(row.teamId) ?? new Set<string>()
    set.add(domain)
    teamDomains.set(row.teamId, set)
  }

  const involvedTeamIds = new Set<string>([
    ...teamDomains.keys(),
    ...[...skippedDomains.values()].flatMap((v) => [...v.teams]),
  ])
  const teamRows = involvedTeamIds.size
    ? await db
        .select({ id: team.id, name: team.name })
        .from(team)
        .where(inArray(team.id, [...involvedTeamIds]))
    : []
  const teamRef = (id: string): BackfillTeamRef => ({ id, name: teamRows.find((t) => t.id === id)?.name ?? id })

  // Existing claims (any status) for hierarchy and idempotency checks.
  const existing = await db.select().from(supportSendingDomain)

  // --- Plan -------------------------------------------------------------------------------
  // Within a team a subdomain whose parent is also used by that team collapses into the parent.
  const covered = new Map<string, { teamId: string; parent: string }[]>() // domain -> collapsed (team, parent)
  const candidates = new Map<string, Set<string>>() // domain -> teams using it directly
  for (const [teamId, domains] of teamDomains) {
    for (const domain of domains) {
      const parent = [...domains]
        .filter((other) => other !== domain && isSameOrSubdomain(domain, other))
        .sort((a, b) => a.length - b.length)[0]
      if (parent) {
        covered.set(domain, [...(covered.get(domain) ?? []), { teamId, parent }])
      } else {
        candidates.set(domain, (candidates.get(domain) ?? new Set()).add(teamId))
      }
    }
  }

  const entries: BackfillEntry[] = []
  const dnsTeams = new Set<string>()

  for (const [domain, info] of [...skippedDomains].sort(([a], [b]) => a.localeCompare(b))) {
    entries.push({
      domain,
      teams: [...info.teams].map(teamRef),
      action: 'skipped',
      reason: info.reason,
    })
  }

  for (const [domain, items] of [...covered].sort(([a], [b]) => a.localeCompare(b))) {
    for (const item of items) {
      entries.push({
        domain,
        teams: [teamRef(item.teamId)],
        action: 'covered_by_parent',
        reason: `the same team uses ${item.parent}; only the parent is claimed`,
      })
    }
  }

  let needsDelay = false
  for (const [domain, teamSet] of [...candidates].sort(([a], [b]) => a.localeCompare(b))) {
    const teams = [...teamSet]
    const refs = teams.map(teamRef)

    if (teams.length > 1) {
      entries.push({
        domain,
        teams: refs,
        action: 'conflict_multiple_teams',
        reason: 'used by several teams; an operator must decide which team owns it. Nothing was assigned',
      })
      continue
    }
    const teamId = teams[0]

    // A parent or subdomain used by a different team makes the claim ambiguous too.
    const relatedTeam = [...candidates].find(
      ([other, otherTeams]) =>
        other !== domain &&
        (isSameOrSubdomain(domain, other) || isSameOrSubdomain(other, domain)) &&
        [...otherTeams].some((t) => t !== teamId)
    )
    if (relatedTeam) {
      entries.push({
        domain,
        teams: refs,
        action: 'conflict_multiple_teams',
        reason: `${relatedTeam[0]} is used by another team; a parent and its subdomain cannot belong to different teams. Operator must resolve`,
      })
      continue
    }

    const own = existing.find((c) => c.domain === domain && c.teamId === teamId)
    if (own) {
      const unverified = UNVERIFIED.includes(own.status)
      entries.push({
        domain,
        teams: refs,
        action: 'already_claimed',
        reason: `already claimed by this team (status ${own.status})`,
        ...(unverified ? { txtRecord: txtOf(own.dnsRecords, domain, own.ownershipToken) } : {}),
      })
      if (unverified) dnsTeams.add(teamId)
      continue
    }
    const ownParent = existing.find((c) => c.teamId === teamId && isSameOrSubdomain(domain, c.domain))
    if (ownParent) {
      entries.push({
        domain,
        teams: refs,
        action: 'already_claimed',
        reason: `covered by this team's claim on ${ownParent.domain} (status ${ownParent.status})`,
      })
      continue
    }
    const other = existing.find(
      (c) => c.teamId !== teamId && (isSameOrSubdomain(domain, c.domain) || isSameOrSubdomain(c.domain, domain))
    )
    if (other) {
      entries.push({
        domain,
        teams: refs,
        action: 'conflict_claimed_elsewhere',
        reason:
          other.domain === domain
            ? 'already claimed by another team. Nothing changed'
            : `${other.domain} is claimed by another team. Nothing changed`,
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
      entries.push({ domain, teams: refs, action: 'provider_error', reason: errorText(error).message })
      continue
    }
    if (!result) {
      entries.push({
        domain,
        teams: refs,
        action: 'not_on_provider',
        reason: `not on provider (${provider.name}) - the team must add it`,
      })
      continue
    }
    if (result.state !== 'active') {
      entries.push({
        domain,
        teams: refs,
        action: 'not_active_on_provider',
        reason: result.contested
          ? `on provider but owned by another project (${result.message ?? 'contested'}) - nothing created`
          : `on provider but not active yet (${result.state}) - the team must finish the provider DNS first`,
      })
      continue
    }

    if (!options.apply) {
      entries.push({
        domain,
        teams: refs,
        action: 'would_create',
        reason: 'active on provider; would create an adopted pending claim (team then publishes the TXT record)',
      })
      dnsTeams.add(teamId)
      continue
    }

    try {
      const userId = await pickClaimUser(teamId)
      // created_by_user_id is nullable; a team with no members at all gets a claim without a creator.
      const claim = await createSendingDomainClaim({
        teamId,
        domain,
        userId: userId as string,
        provider: provider.name,
        providerAccountKey: provider.accountKey,
        now,
      })
      const txt = ownershipRecord(domain, claim.ownershipToken)
      await db
        .update(supportSendingDomain)
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
        .where(eq(supportSendingDomain.id, claim.id))
      entries.push({
        domain,
        teams: refs,
        action: 'created',
        reason: 'active on provider; created an adopted pending claim. The team must publish the TXT record',
        txtRecord: { name: txt.name, value: txt.value },
      })
      dnsTeams.add(teamId)
    } catch (error) {
      const { code, message } = errorText(error)
      const rule = ['DOMAIN_CLAIMED', 'DOMAIN_REJECTED', 'DOMAIN_LIMIT_REACHED', 'PENDING_LIMIT_REACHED'].includes(code)
      entries.push({
        domain,
        teams: refs,
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
    conflicts: count('conflict_multiple_teams', 'conflict_claimed_elsewhere'),
    notOnProvider: count('not_on_provider', 'not_active_on_provider'),
    blocked: count('blocked'),
    errors: count('provider_error'),
    skipped: count('skipped'),
    teamsNeedingDns: dnsTeams.size,
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
  conflict_multiple_teams: 'CONFLICT (several teams)',
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
    lines.push(`  teams:  ${entry.teams.map((t) => `${t.name} (${t.id})`).join(', ')}`)
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
  lines.push(`  teams needing DNS action: ${s.teamsNeedingDns}`)
  if (report.mode === 'dry-run') lines.push('', 'Dry run. Re-run with --apply to create the claims.')
  return lines.join('\n')
}

export function parseArgs(argv: string[]): {
  apply: boolean
  json: boolean
  production: boolean
  help: boolean
  teamIds: string[]
  delayMs?: number
} {
  const out = {
    apply: false,
    json: false,
    production: false,
    help: false,
    teamIds: [] as string[],
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
    else if (flag === '--team') out.teamIds.push(String(value()))
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
      'Usage: yarn db:backfill-sending-domains [--apply] [--json] [--team <id>] [--delay-ms <n>] [--i-know-this-is-production]'
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

  const report = await runBackfill({ apply: args.apply, teamIds: args.teamIds, delayMs: args.delayMs })
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
