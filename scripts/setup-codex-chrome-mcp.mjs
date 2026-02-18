import { spawnSync } from 'node:child_process'

const serverName = process.env.CODEX_CHROME_MCP_NAME || 'chrome-devtools'
const serverCommand = process.env.CODEX_CHROME_MCP_COMMAND || 'npx'
const serverArgs =
  process.env.CODEX_CHROME_MCP_ARGS?.split(' ').filter(Boolean) || [
    '-y',
    'chrome-devtools-mcp@latest',
    '--headless',
    '--isolated',
    '--no-sandbox',
  ]

function runCodex(args, options = {}) {
  const result = spawnSync('codex', args, {
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
    shell: false,
  })

  if (options.allowFailure) return result
  if (result.error) throw result.error
  if ((result.status ?? 1) !== 0) {
    const stderr = (result.stderr || '').trim()
    const stdout = (result.stdout || '').trim()
    throw new Error(`codex ${args.join(' ')} failed.\n${stderr || stdout}`)
  }

  return result
}

const existing = runCodex(['mcp', 'get', serverName], { allowFailure: true })
if ((existing.status ?? 1) === 0) {
  process.stdout.write(existing.stdout || '')
  console.log(`[codex:mcp] '${serverName}' is already configured.`)
  process.exit(0)
}

console.log(`[codex:mcp] Adding MCP server '${serverName}'...`)
runCodex(['mcp', 'add', serverName, '--', serverCommand, ...serverArgs], { stdio: 'inherit' })

const added = runCodex(['mcp', 'get', serverName], { allowFailure: true })
if ((added.status ?? 1) !== 0) {
  const stderr = (added.stderr || '').trim()
  throw new Error(`[codex:mcp] Added '${serverName}' but could not verify configuration.\n${stderr}`)
}

process.stdout.write(added.stdout || '')
console.log(`[codex:mcp] '${serverName}' is ready.`)
