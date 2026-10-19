import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIN_PORT = 4300
const PORT_SPAN = 700

function parseNumericEnv(name) {
  const rawValue = process.env[name]
  if (!rawValue) return null
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

export function deriveWorktreePort(worktreePath = process.cwd()) {
  const explicit = parseNumericEnv('WORKTREE_PORT') ?? parseNumericEnv('PLAYWRIGHT_PORT')
  if (explicit) return explicit

  const canonicalPath = resolve(worktreePath).toLowerCase()
  const hash = createHash('sha256').update(canonicalPath).digest('hex')
  const bucket = Number.parseInt(hash.slice(0, 8), 16) % PORT_SPAN
  return MIN_PORT + bucket
}

export function getWorktreeRuntimeContext(worktreePath = process.cwd()) {
  const port = deriveWorktreePort(worktreePath)
  // `localhost`, not `127.0.0.1`. Better Auth issues session cookies scoped to
  // `Domain=.<APP_DOMAIN>`, which is `.localhost` by default, and a client
  // correctly discards such a cookie when the host is a bare IP. Sign-in then
  // returns 200 while every following request is unauthenticated, so
  // auth-dependent E2E specs fail with a misleading "session did not persist".
  const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${port}`
  return {
    cwd: resolve(worktreePath),
    port,
    baseURL,
  }
}

const thisFile = fileURLToPath(import.meta.url)

if (process.argv[1] && resolve(process.argv[1]) === resolve(thisFile)) {
  const context = getWorktreeRuntimeContext(process.cwd())
  console.log(JSON.stringify(context, null, 2))
}
