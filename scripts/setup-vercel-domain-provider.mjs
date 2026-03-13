import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function readLinkedProject() {
  const projectFile = path.join(process.cwd(), '.vercel', 'project.json')
  return JSON.parse(readFileSync(projectFile, 'utf8'))
}

function parseArgs(argv) {
  const options = {
    appDomain: 'veerify.io',
    dashboardDomain: 'app.veerify.io',
    environment: 'production',
    apply: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') {
      options.apply = true
      continue
    }
    if (arg === '--app-domain') {
      options.appDomain = argv[index + 1]
      index += 1
      continue
    }
    if (arg === '--dashboard-domain') {
      options.dashboardDomain = argv[index + 1]
      index += 1
      continue
    }
    if (arg === '--environment') {
      options.environment = argv[index + 1]
      index += 1
      continue
    }
  }

  return options
}

function runVercelCommand(args, token) {
  return execFileSync('vercel', args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      VERCEL_TOKEN: token,
    },
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function getTeamSlug(orgId, token) {
  const raw = runVercelCommand(['api', `/v2/teams/${orgId}`, '--raw'], token)
  const payload = JSON.parse(raw)
  if (!payload.slug) {
    throw new Error(`Could not resolve Vercel team slug for org ${orgId}`)
  }
  return payload.slug
}

function addDomain({ domain, token, apply }) {
  const linkedProject = readLinkedProject()
  const args = [
    'api',
    `/v10/projects/${linkedProject.projectId}/domains?teamId=${linkedProject.orgId}`,
    '-X',
    'POST',
    '-f',
    `name=${domain}`,
    '--raw',
  ]
  if (!apply) {
    console.log(`[dry-run] vercel ${args.join(' ')}`)
    return
  }

  try {
    const output = runVercelCommand(args, token)
    if (output) {
      console.log(output)
    }
  } catch (error) {
    const output = String(error.stderr || error.stdout || error.message || '')
    if (output.includes('already in use') || output.includes('already exists') || output.includes('already assigned')) {
      console.log(`[ok] domain already present: ${domain}`)
      return
    }
    throw error
  }
}

function upsertEnv({ key, value, scope, environment, token, apply, sensitive = false }) {
  const args = ['env', 'add', key, environment, '--value', value, '--yes', '--force', '--scope', scope]
  if (sensitive) {
    args.push('--sensitive')
  }

  if (!apply) {
    const displayValue = sensitive ? '<redacted>' : value
    console.log(`[dry-run] vercel env add ${key} ${environment} --value ${displayValue} --yes --force --scope ${scope}`)
    return
  }

  const output = runVercelCommand(args, token)
  if (output) {
    console.log(output)
  }
}

function main() {
  const token = process.env.VERCEL_TOKEN || process.env.VERCEL_API_TOKEN
  if (!token) {
    throw new Error('Set VERCEL_TOKEN or VERCEL_API_TOKEN before running this script.')
  }

  const options = parseArgs(process.argv.slice(2))
  const linkedProject = readLinkedProject()
  const teamSlug = getTeamSlug(linkedProject.orgId, token)

  console.log(`Project: ${linkedProject.projectName} (${linkedProject.projectId})`)
  console.log(`Team: ${teamSlug} (${linkedProject.orgId})`)
  console.log(`Target environment: ${options.environment}`)
  console.log(options.apply ? 'Mode: apply' : 'Mode: dry-run')

  addDomain({
    domain: options.dashboardDomain,
    token,
    apply: options.apply,
  })

  addDomain({
    domain: `*.${options.appDomain}`,
    token,
    apply: options.apply,
  })

  const envs = [
    { key: 'BETTER_AUTH_URL', value: `https://${options.dashboardDomain}` },
    { key: 'APP_DOMAIN', value: options.appDomain },
    { key: 'APP_DASHBOARD_DOMAIN', value: options.dashboardDomain },
    { key: 'DOMAIN_PROVIDER', value: 'vercel' },
    { key: 'VERCEL_API_TOKEN', value: token, sensitive: true },
    { key: 'VERCEL_PROJECT_ID', value: linkedProject.projectId },
    { key: 'VERCEL_TEAM_ID', value: linkedProject.orgId },
    { key: 'VERCEL_TEAM_SLUG', value: teamSlug },
  ]

  for (const entry of envs) {
    upsertEnv({
      ...entry,
      scope: teamSlug,
      environment: options.environment,
      token,
      apply: options.apply,
    })
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
