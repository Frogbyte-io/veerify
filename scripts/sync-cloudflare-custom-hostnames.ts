/**
 * Register or adopt every Veerify custom domain with Cloudflare for SaaS, for
 * operators switching DOMAIN_PROVIDER from `static-cname` to `cloudflare-saas`.
 *
 * Rows such as a hand-added hostname that already works in Cloudflare are
 * adopted: the script records provider `cloudflare-saas` and the Cloudflare
 * custom hostname id, and never touches the "domain connected/verified" emails
 * (an active domain is marked as already notified). Hostnames missing from
 * Cloudflare are registered. Cloudflare hostnames with no Veerify row are only
 * reported, never deleted.
 *
 * Usage:
 *   yarn domains:sync-cloudflare                 # dry run, readable report
 *   yarn domains:sync-cloudflare --json          # dry run, machine output
 *   yarn domains:sync-cloudflare --apply         # register / adopt
 *   yarn domains:sync-cloudflare --apply --i-know-this-is-production
 *
 * Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID (or the NUXT_ variants).
 * Idempotent: a second run reports every row as in_sync and writes nothing
 * unless Cloudflare's status changed.
 */
import { pathToFileURL } from 'node:url'
import { and, eq, ne } from 'drizzle-orm'
import { db } from '../server/database/drizzle'
import { project, projectDomain } from '../server/database/schema/feedback'
import { CloudflareSaasDomainProvider } from '../server/services/domains/providers/cloudflare-saas'
import type { DomainProviderResult } from '../server/services/domains/provider'
import { productionDatabaseReason } from './backfill-sending-domains'
import 'dotenv/config'

export type SyncAction =
  | 'adopted'
  | 'would_adopt'
  | 'registered'
  | 'would_register'
  | 'in_sync'
  | 'skipped_local'
  | 'error'

export interface SyncDomainRow {
  id: string
  projectId: string
  hostname: string
  provider: string
  providerDomainId: string | null
  status: string
  activatedAt: Date | null
}

export interface SyncEntry {
  hostname: string
  action: SyncAction
  cloudflareId?: string | null
  status?: string
  reason?: string
}

export interface SyncReport {
  mode: 'dry-run' | 'apply'
  entries: SyncEntry[]
  /** Cloudflare hostnames with no Veerify row. Report only: never deleted. */
  orphans: Array<{ id: string; hostname: string; status: string; sslStatus: string }>
  summary: Record<SyncAction, number> & { orphans: number }
}

export interface SyncStore {
  listDomains(): Promise<SyncDomainRow[]>
  applyResult(row: SyncDomainRow, result: DomainProviderResult): Promise<void>
}

export interface SyncProvider {
  lookupProjectDomain: CloudflareSaasDomainProvider['lookupProjectDomain']
  registerProjectDomain: CloudflareSaasDomainProvider['registerProjectDomain']
  listCustomHostnames: CloudflareSaasDomainProvider['listCustomHostnames']
}

const PROVIDER = 'cloudflare-saas'

function isLocalHostname(hostname: string) {
  return hostname === 'localhost' || hostname.endsWith('.localhost')
}

export function createDrizzleSyncStore(): SyncStore {
  return {
    async listDomains() {
      return db
        .select({
          id: projectDomain.id,
          projectId: projectDomain.projectId,
          hostname: projectDomain.hostname,
          provider: projectDomain.provider,
          providerDomainId: projectDomain.providerDomainId,
          status: projectDomain.status,
          activatedAt: projectDomain.activatedAt,
        })
        .from(projectDomain)
        .where(ne(projectDomain.status, 'detached'))
    },

    async applyResult(row, result) {
      const now = new Date()
      await db.transaction(async (tx) => {
        await tx
          .update(projectDomain)
          .set({
            provider: PROVIDER,
            providerDomainId: result.providerDomainId ?? row.providerDomainId,
            status: result.status,
            verificationPayload: {
              configuredBy: result.configuredBy,
              expected: result.expected,
              resolvedTo: result.resolvedTo,
            },
            dnsRecords: result.dnsRecords,
            lastCheckedAt: now,
            activatedAt: row.activatedAt ?? (result.verified ? now : null),
            errorMessage: result.status === 'error' ? result.message : null,
            updatedAt: now,
          })
          .where(and(eq(projectDomain.id, row.id)))

        // Mirror the provider state into project.settings WITHOUT touching the
        // email-sent flags; mark an active domain as already notified.
        const [owner] = await tx
          .select({ settings: project.settings })
          .from(project)
          .where(eq(project.id, row.projectId))
          .limit(1)
        if (!owner) return
        const settings = { ...((owner.settings as Record<string, unknown> | null) || {}) }
        settings.domainProvider = PROVIDER
        settings.domainStatus = result.status
        settings.domainDnsRecords = result.dnsRecords
        settings.domainExpected = result.expected
        settings.domainConfiguredBy = result.configuredBy
        settings.domainMessage = result.message
        settings.domainLastCheckedAt = now.toISOString()
        if (result.verified) {
          settings.domainVerifiedAt = settings.domainVerifiedAt || now.toISOString()
          settings.domainVerifiedEmailSentFor ??= row.hostname
          settings.domainConnectedEmailSentFor ??= row.hostname
        }
        await tx.update(project).set({ settings, updatedAt: now }).where(eq(project.id, row.projectId))
      })
    },
  }
}

export async function runSync(options: {
  apply: boolean
  provider: SyncProvider
  store: SyncStore
  delayMs?: number
  sleep?: (ms: number) => Promise<void>
}): Promise<SyncReport> {
  const { apply, provider, store } = options
  const delayMs = options.delayMs ?? 250
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  const rows = await store.listDomains()
  const entries: SyncEntry[] = []

  for (const row of rows) {
    if (isLocalHostname(row.hostname)) {
      entries.push({ hostname: row.hostname, action: 'skipped_local', reason: 'local development domain' })
      continue
    }
    try {
      const existing = await provider.lookupProjectDomain({
        hostname: row.hostname,
        providerDomainId: row.providerDomainId,
      })
      await sleep(delayMs)

      if (existing) {
        const alreadySynced =
          row.provider === PROVIDER &&
          row.providerDomainId === existing.providerDomainId &&
          row.status === existing.status
        if (alreadySynced) {
          entries.push({
            hostname: row.hostname,
            action: 'in_sync',
            cloudflareId: existing.providerDomainId,
            status: existing.status,
          })
          continue
        }
        const adopting = row.provider !== PROVIDER || row.providerDomainId !== existing.providerDomainId
        if (apply) await store.applyResult(row, existing)
        entries.push({
          hostname: row.hostname,
          action: !adopting ? 'in_sync' : apply ? 'adopted' : 'would_adopt',
          cloudflareId: existing.providerDomainId,
          status: existing.status,
          reason: existing.message || undefined,
        })
        continue
      }

      if (!apply) {
        entries.push({ hostname: row.hostname, action: 'would_register', reason: 'not found in Cloudflare' })
        continue
      }
      const registered = await provider.registerProjectDomain({ hostname: row.hostname })
      await store.applyResult(row, registered)
      await sleep(delayMs)
      entries.push({
        hostname: row.hostname,
        action: 'registered',
        cloudflareId: registered.providerDomainId,
        status: registered.status,
        reason: registered.message || undefined,
      })
    } catch (error) {
      const err = error as { statusMessage?: string; message?: string }
      entries.push({
        hostname: row.hostname,
        action: 'error',
        reason: err.statusMessage || err.message || String(error),
      })
    }
  }

  const known = new Set(rows.map((row) => row.hostname))
  const orphans = (await provider.listCustomHostnames()).filter((entry) => !known.has(entry.hostname))

  const summary = {
    adopted: 0,
    would_adopt: 0,
    registered: 0,
    would_register: 0,
    in_sync: 0,
    skipped_local: 0,
    error: 0,
    orphans: orphans.length,
  } as SyncReport['summary']
  for (const entry of entries) summary[entry.action]++

  return { mode: apply ? 'apply' : 'dry-run', entries, orphans, summary }
}

export function formatReport(report: SyncReport): string {
  const lines = [`[cloudflare-sync] mode: ${report.mode}`, '']
  for (const entry of report.entries) {
    const extra = [entry.status, entry.cloudflareId, entry.reason].filter(Boolean).join(' | ')
    lines.push(`  ${entry.action.padEnd(15)} ${entry.hostname}${extra ? `  (${extra})` : ''}`)
  }
  if (report.orphans.length > 0) {
    lines.push('', 'Cloudflare custom hostnames with no Veerify row (report only, never deleted):')
    for (const orphan of report.orphans) {
      lines.push(`  ${orphan.hostname}  (${orphan.status}/${orphan.sslStatus || 'n/a'}, ${orphan.id})`)
    }
  }
  lines.push('', `summary: ${JSON.stringify(report.summary)}`)
  if (report.mode === 'dry-run') lines.push('Dry run. Re-run with --apply to write changes.')
  return lines.join('\n')
}

export function parseArgs(argv: string[]) {
  const out = { apply: false, json: false, production: false, help: false }
  for (const arg of argv) {
    if (arg === '--apply') out.apply = true
    else if (arg === '--json') out.json = true
    else if (arg === '--i-know-this-is-production') out.production = true
    else if (arg === '--help' || arg === '-h') out.help = true
    else throw new Error(`Unknown option ${arg}`)
  }
  return out
}

/** The provider throws via Nitro's auto-imported createError, absent under tsx. */
function installCreateErrorShim() {
  const g = globalThis as { createError?: unknown }
  g.createError ??= (input: { statusCode?: number; statusMessage?: string }) =>
    Object.assign(new Error(input.statusMessage || 'Request failed'), input)
}

function buildProvider() {
  const env = process.env
  const apiToken = env.NUXT_CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_API_TOKEN || ''
  const zoneId = env.NUXT_CLOUDFLARE_ZONE_ID || env.CLOUDFLARE_ZONE_ID || ''
  if (!apiToken.trim() || !zoneId.trim()) {
    throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID are required')
  }
  return new CloudflareSaasDomainProvider({
    apiToken,
    zoneId,
    cnameTarget: env.NUXT_PUBLIC_CNAME_TARGET || env.CNAME_TARGET || 'cname.veerify.io',
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: yarn domains:sync-cloudflare [--apply] [--json] [--i-know-this-is-production]')
    return
  }

  if (args.apply && !args.production) {
    const reason = productionDatabaseReason()
    if (reason) {
      console.error(
        `[cloudflare-sync] Refusing --apply: ${reason}. Run without --apply to preview, ` +
          `or add --i-know-this-is-production if you are certain this is the database to change.`
      )
      process.exitCode = 1
      return
    }
  }

  installCreateErrorShim()
  const report = await runSync({ apply: args.apply, provider: buildProvider(), store: createDrizzleSyncStore() })
  console.log(args.json ? JSON.stringify(report, null, 2) : formatReport(report))
  if (report.summary.error > 0) process.exitCode = 1
}

async function closePool() {
  await (db as unknown as { $client?: { end?: () => Promise<void> } }).$client?.end?.()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error('[cloudflare-sync] failed:', error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
    .finally(closePool)
}
