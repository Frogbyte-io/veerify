import { createHash } from 'node:crypto'
import { Client, type ClientConfig } from 'pg'
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

function createClientConfig(): ClientConfig {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }
  }

  return {
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER || 'veerify',
    password: process.env.PGPASSWORD || 'veerifypassword',
    database: process.env.PGDATABASE || 'veerifydb',
    ssl: false,
  }
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
  const client = new Client(createClientConfig())
  await client.connect()

  try {
    const result = await client.query<LegacyProjectDomain>(`
      SELECT
        id AS "projectId",
        lower(trim(trailing '.' from custom_domain)) AS hostname,
        settings,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM project
      WHERE custom_domain IS NOT NULL AND custom_domain <> ''
    `)

    let inserted = 0
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
