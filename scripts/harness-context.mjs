import { execSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'

const keyFiles = [
  'AGENTS.md',
  'CLAUDE.md',
  '.agents/CLAUDE.md',
  'docs/agent/context-map.md',
  'docs/agent/workflows.md',
  'docs/agent/chrome-mcp.md',
  'README.md',
  'package.json',
  '.github/workflows/ci.yml',
]

const requiredScripts = [
  'harness:context',
  'harness:docs',
  'harness:verify',
  'worktree:env',
  'dev:worktree',
  'codex:mcp:chrome:setup',
  'typecheck',
  'test',
  'lint',
  'test:e2e:if-available',
]

function printSection(title) {
  console.log(`\n== ${title} ==`)
}

function execSafe(command) {
  try {
    return execSync(command, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return null
  }
}

function printFileStatus(filePath) {
  if (!existsSync(filePath)) {
    console.log(`[missing] ${filePath}`)
    return
  }

  const modified = statSync(filePath).mtime.toISOString()
  console.log(`[ok] ${filePath} (updated ${modified})`)
}

printSection('Harness Files')
for (const filePath of keyFiles) {
  printFileStatus(filePath)
}

printSection('Git Snapshot')
const branch = execSafe('git rev-parse --abbrev-ref HEAD')
const commit = execSafe('git rev-parse --short HEAD')
const status = execSafe('git status --short')
console.log(`branch: ${branch ?? 'unknown'}`)
console.log(`head: ${commit ?? 'unknown'}`)
console.log(`dirty: ${status ? 'yes' : 'no'}`)
if (status) {
  console.log(status)
}

printSection('Validation Commands')
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
for (const script of requiredScripts) {
  const command = packageJson.scripts?.[script]
  if (!command) {
    console.log(`[missing] ${script}`)
    continue
  }

  console.log(`[ok] yarn ${script} -> ${command}`)
}

console.log('\nNext step: run `yarn harness:verify` after making changes.')
