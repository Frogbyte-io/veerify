import { createHash } from 'node:crypto'
import { Client } from 'pg'
import { createDatabaseConnectionConfig } from '../server/database/connection-config'
import 'dotenv/config'

type LegacyProjectDomain = {
  projectId: string
  hostname: string
  settings: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

type DnsRecord = {
  type: string
  name: string
  value: string
}

function readString(settings: Record<string, unknown> | null, key: string) {
  const value = settings?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readDnsRecords(settings: Record<string, unknown> | null): DnsRecord[] {
  const value = settings?.domainDnsRecords
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    if (typeof record.type !== 'string' || typeof record.name !== 'string' || typeof record.value !== 'string') {
      return []
    }
    return [{ type: record.type, name: record.name, value: record.value }]
  })
}

function domainId(projectId: string, hostname: string) {
  return createHash('sha256').update(`domain:${projectId}:${hostname}`).digest('hex')
}

async function main() {
  const clientConfig = { ...createDatabaseConnectionConfig() }
  delete clientConfig.connectionString
  const client = new Client(clientConfig)
  await client.connect()

  try {
    const batchSize = Math.max(1, Math.min(Number(process.env.DOMAIN_BACKFILL_BATCH_SIZE) || 100, 1000))
    let afterProjectId = process.env.DOMAIN_BACKFILL_AFTER_ID || ''
    let inserted = 0
    while (true) {
      const result = await client.query<LegacyProjectDomain>(
        `
          SELECT
            id AS "projectId",
            lower(trim(trailing '.' from custom_domain)) AS hostname,
            settings,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM project
          WHERE custom_domain IS NOT NULL AND custom_domain <> ''
            AND id > $1
          ORDER BY id
          LIMIT $2
        `,
        [afterProjectId, batchSize]
      )
      if (result.rows.length === 0) break

      for (const legacy of result.rows) {
        const provider = readString(legacy.settings, 'domainProvider') || 'static-cname'
        const status = readString(legacy.settings, 'domainStatus') || 'dns_required'
        const verifiedAt = readString(legacy.settings, 'domainVerifiedAt')
        const dnsRecords = readDnsRecords(legacy.settings)
        const verificationPayload = {
          configuredBy: readString(legacy.settings, 'domainConfiguredBy'),
          expected: readString(legacy.settings, 'domainExpected'),
          resolvedTo: Array.isArray(legacy.settings?.domainResolvedTo) ? legacy.settings.domainResolvedTo : [],
        }

        const writeResult = await client.query(
          `
            INSERT INTO domain (
              id, project_id, hostname, kind, provider, status, is_primary,
              verification_payload, dns_records, last_checked_at, activated_at,
              error_message, created_at, updated_at
            )
            VALUES ($1, $2, $3, 'custom_subdomain', $4, $5, true, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (hostname) DO NOTHING
          `,
          [
            domainId(legacy.projectId, legacy.hostname),
            legacy.projectId,
            legacy.hostname,
            provider,
            status,
            JSON.stringify(verificationPayload),
            JSON.stringify(dnsRecords),
            legacy.updatedAt,
            status === 'active' ? verifiedAt || legacy.updatedAt : null,
            readString(legacy.settings, 'domainMessage'),
            legacy.createdAt,
            legacy.updatedAt,
          ]
        )
        inserted += writeResult.rowCount || 0
        afterProjectId = legacy.projectId
      }
      console.log(`[domains] processed through project ${afterProjectId}`)
      if (result.rows.length < batchSize) break
    }

    console.log(`[domains] backfilled ${inserted} project domain record(s)`)
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error('[domains] backfill failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
