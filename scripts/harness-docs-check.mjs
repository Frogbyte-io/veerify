import { existsSync, readFileSync } from 'node:fs'

const requiredFiles = [
  'AGENTS.md',
  'CLAUDE.md',
  '.agents/CLAUDE.md',
  'docs/agent/context-map.md',
  'docs/agent/workflows.md',
  'docs/agent/chrome-mcp.md',
]

const requiredAgentTokens = [
  'CLAUDE.md',
  '.agents/CLAUDE.md',
  'docs/agent/context-map.md',
  'docs/agent/workflows.md',
  'docs/agent/chrome-mcp.md',
  'yarn harness:context',
  'yarn harness:verify',
  'yarn test:e2e:if-available',
  'yarn codex:mcp:chrome:setup',
  'yarn dev:worktree',
  'Conventional Commits',
]

let hasErrors = false

for (const filePath of requiredFiles) {
  if (!existsSync(filePath)) {
    hasErrors = true
    console.error(`[harness:docs] Missing required file: ${filePath}`)
  }
}

if (existsSync('AGENTS.md')) {
  const content = readFileSync('AGENTS.md', 'utf8')
  const lineCount = content.split(/\r?\n/).length

  if (lineCount > 160) {
    hasErrors = true
    console.error(`[harness:docs] AGENTS.md is too long (${lineCount} lines). Keep it as a concise map.`)
  }

  for (const token of requiredAgentTokens) {
    if (!content.includes(token)) {
      hasErrors = true
      console.error(`[harness:docs] AGENTS.md is missing required reference: ${token}`)
    }
  }
}

if (hasErrors) {
  process.exit(1)
}

console.log('[harness:docs] Agent documentation map is valid.')
