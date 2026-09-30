import { spawnSync } from 'node:child_process'
import { getWorktreeRuntimeContext } from './worktree-env.mjs'

const isWindows = process.platform === 'win32'
const commandArgs = process.argv.slice(2)

if (commandArgs.length === 0) {
  console.error('Usage: node scripts/worktree-run.mjs <command> [args...]')
  process.exit(1)
}

const [command, ...rawArgs] = commandArgs
const context = getWorktreeRuntimeContext(process.cwd())

// Nuxt does not honour PORT/NUXT_PORT here - it starts on 3000 and increments
// when that is taken - so a worktree dev server silently binds a shared port
// instead of its own. Anything already listening on the derived port (a stale
// server from an earlier session) then answers instead, and tests appear to
// pass or fail against code that is not in this worktree. Callers that need the
// port on the command line pass `%PORT%`.
const args = rawArgs.map((arg) => arg.replaceAll('%PORT%', String(context.port)))
const env = {
  ...process.env,
  WORKTREE_PORT: String(context.port),
  PLAYWRIGHT_PORT: String(context.port),
  PLAYWRIGHT_BASE_URL: context.baseURL,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || context.baseURL,
  PORT: String(context.port),
  NUXT_PORT: String(context.port),
}

console.log(`[worktree-run] cwd=${context.cwd}`)
console.log(`[worktree-run] port=${context.port}`)
console.log(`[worktree-run] baseURL=${context.baseURL}`)

const result = spawnSync(command, args, {
  stdio: 'inherit',
  env,
  shell: isWindows,
})

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)
