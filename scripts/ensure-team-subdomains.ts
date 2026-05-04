import { Client } from 'pg'
import 'dotenv/config'

type LinkedProject = {
  projectId: string
  orgId?: string
}

function normalizeHostname(value: string) {
  return value.trim().toLowerCase().replace(/\.$/, '')
}

function createClient() {
  return process.env.DATABASE_URL
    ? new Client({ connectionString: process.env.DATABASE_URL })
    : new Client({
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT) || 5432,
        user: process.env.PGUSER || 'veerify',
        password: process.env.PGPASSWORD || 'veerifypassword',
        database: process.env.PGDATABASE || 'veerifydb',
      })
}

function getLinkedProject(): LinkedProject {
  const projectId = process.env.VERCEL_PROJECT_ID
  const orgId = process.env.VERCEL_TEAM_ID || process.env.VERCEL_ORG_ID

  if (!projectId) {
    throw new Error('Set VERCEL_PROJECT_ID before running this script.')
  }

  return { projectId, orgId }
}

function getConfig() {
  const token = process.env.VERCEL_API_TOKEN || process.env.VERCEL_TOKEN
  const appDomain = normalizeHostname(process.env.APP_DOMAIN || 'localhost')
  const linkedProject = getLinkedProject()

  if (!token) {
    throw new Error('Set VERCEL_API_TOKEN or VERCEL_TOKEN before running this script.')
  }

  if (!appDomain || appDomain === 'localhost') {
    throw new Error('APP_DOMAIN must be a production domain, not localhost.')
  }

  return {
    token,
    appDomain,
    projectId: linkedProject.projectId,
    orgId: linkedProject.orgId,
  }
}

function buildVercelQuery(orgId?: string) {
  const params = new URLSearchParams()
  if (orgId) params.set('teamId', orgId)
  const query = params.toString()
  return query ? `?${query}` : ''
}

async function vercelRequest(path: string, init: RequestInit, token: string) {
  const response = await fetch(`https://api.vercel.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })

  const payload = await response.json().catch(() => null)
  if (response.ok) {
    return payload
  }

  const message =
    typeof payload?.error?.message === 'string'
      ? payload.error.message
      : typeof payload?.message === 'string'
        ? payload.message
        : 'Vercel API request failed'

  if (
    response.status === 409 ||
    /already (exists|assigned|in use|registered|added)/i.test(message) ||
    /domain.*already/i.test(message)
  ) {
    return payload
  }

  throw new Error(`${response.status} ${message}`)
}

async function ensureVercelDomain(hostname: string) {
  const config = getConfig()
  const path = `/v10/projects/${encodeURIComponent(config.projectId)}/domains${buildVercelQuery(config.orgId)}`

  await vercelRequest(
    path,
    {
      method: 'POST',
      body: JSON.stringify({ name: hostname }),
    },
    config.token
  )
}

async function main() {
  const config = getConfig()
  const client = createClient()
  await client.connect()

  try {
    const { rows } = await client.query<{ slug: string }>(
      `SELECT slug FROM "team" WHERE slug IS NOT NULL ORDER BY created_at ASC`
    )

    for (const row of rows) {
      const slug = normalizeHostname(row.slug)
      if (!slug) continue

      const hostname = `${slug}.${config.appDomain}`
      await ensureVercelDomain(hostname)
      console.log(`[team-subdomains] ensured ${hostname}`)
    }
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error('[team-subdomains] failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
