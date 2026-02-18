import { spawnSync } from 'node:child_process'
import { getWorktreeRuntimeContext } from './worktree-env.mjs'

const isWindows = process.platform === 'win32'
const commandArgs = process.argv.slice(2)

if (commandArgs.length === 0) {
  console.error('Usage: node scripts/worktree-run.mjs <command> [args...]')
  process.exit(1)
}

const [command, ...args] = commandArgs
const context = getWorktreeRuntimeContext(process.cwd())
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
