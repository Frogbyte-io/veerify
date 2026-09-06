import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'

const mode = process.argv[2]
if (mode !== '--cold' && mode !== '--warm') {
  console.error('Usage: node scripts/profile-build.mjs --cold|--warm')
  process.exit(2)
}

const temporaryRoot = realpathSync(tmpdir())
const ownedRoot = mkdtempSync(join(temporaryRoot, 'veerify-build-profile-'))
const resolvedOwnedRoot = realpathSync(ownedRoot)
if (!resolvedOwnedRoot.startsWith(`${temporaryRoot}${sep}`)) {
  throw new Error(`Refusing to profile outside the OS temporary directory: ${resolvedOwnedRoot}`)
}

function processTreeRssKilobytes(rootPid) {
  if (process.platform === 'win32') {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize | ConvertTo-Csv -NoTypeInformation",
      ],
      { encoding: 'utf8', windowsHide: true }
    )
    if (result.status !== 0) return 0
    const rows = result.stdout
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.replaceAll('"', '').split(','))
      .filter((parts) => parts.length === 3)
      .map(([pid, parentPid, bytes]) => ({ pid: Number(pid), parentPid: Number(parentPid), rss: Number(bytes) / 1024 }))
    return treeRss(rows, rootPid)
  }

  const result = spawnSync('ps', ['-eo', 'pid=,ppid=,rss='], { encoding: 'utf8' })
  if (result.status !== 0) return 0
  const rows = result.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((parts) => parts.length === 3)
    .map(([pid, parentPid, rss]) => ({ pid, parentPid, rss }))
  return treeRss(rows, rootPid)
}

function treeRss(rows, rootPid) {
  const included = new Set([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) {
      if (included.has(row.parentPid) && !included.has(row.pid)) {
        included.add(row.pid)
        changed = true
      }
    }
  }
  return rows.filter((row) => included.has(row.pid)).reduce((total, row) => total + row.rss, 0)
}

function phaseFor(line) {
  if (/building client|vite client/i.test(line)) return 'vite-client'
  if (/building server|vite server/i.test(line)) return 'vite-server'
  if (/building nuxt nitro server|nuxt nitro server built/i.test(line)) return 'nitro'
  if (/you can preview|done in|prerender/i.test(line)) return 'finalize'
  return null
}

async function profileBuild(label, directory) {
  const buildDirectory = join(directory, 'nuxt')
  const outputDirectory = join(directory, 'output')
  mkdirSync(buildDirectory, { recursive: true })
  mkdirSync(outputDirectory, { recursive: true })

  const startedAt = Date.now()
  let peakRssKilobytes = 0
  let lastPhase = 'spawn'
  const phaseTransitions = [{ phase: lastPhase, at: startedAt }]
  const command = process.platform === 'win32' ? 'yarn.cmd' : 'yarn'
  const child = spawn(command, ['nuxt', 'build'], {
    cwd: process.cwd(),
    env: { ...process.env, NUXT_BUILD_DIR: buildDirectory, NITRO_OUTPUT_DIR: outputDirectory },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  const observe = (chunk, stream) => {
    stream.write(chunk)
    for (const line of String(chunk).split(/\r?\n/)) {
      const phase = phaseFor(line)
      if (phase && phase !== lastPhase) {
        lastPhase = phase
        phaseTransitions.push({ phase, at: Date.now() })
      }
    }
  }
  child.stdout.on('data', (chunk) => observe(chunk, process.stdout))
  child.stderr.on('data', (chunk) => observe(chunk, process.stderr))

  const sampler = setInterval(() => {
    peakRssKilobytes = Math.max(peakRssKilobytes, processTreeRssKilobytes(child.pid))
  }, 250)
  const exitCode = await new Promise((resolveExit) => child.once('close', (code) => resolveExit(code ?? 1)))
  clearInterval(sampler)
  peakRssKilobytes = Math.max(peakRssKilobytes, processTreeRssKilobytes(child.pid))

  const elapsedMs = Date.now() - startedAt
  const phaseTimings = {}
  for (let index = 0; index < phaseTransitions.length; index += 1) {
    const current = phaseTransitions[index]
    const endedAt = phaseTransitions[index + 1]?.at ?? startedAt + elapsedMs
    phaseTimings[current.phase] = (phaseTimings[current.phase] ?? 0) + endedAt - current.at
  }
  console.log(
    `[build-profile] ${label} exit=${exitCode} elapsedMs=${elapsedMs} peakRssMiB=${(
      peakRssKilobytes / 1024
    ).toFixed(1)} lastPhase=${lastPhase} phases=${JSON.stringify(phaseTimings)}`
  )
  return exitCode
}

let exitCode = 0
try {
  if (mode === '--cold') {
    exitCode = await profileBuild('cold', join(resolvedOwnedRoot, 'cold'))
  } else {
    const warmRoot = join(resolvedOwnedRoot, 'warm')
    const first = await profileBuild('warm-1', warmRoot)
    const second = await profileBuild('warm-2', warmRoot)
    exitCode = first || second
  }
} finally {
  const cleanupTarget = resolve(resolvedOwnedRoot)
  if (cleanupTarget.startsWith(`${temporaryRoot}${sep}`) && basename(cleanupTarget).startsWith('veerify-build-profile-')) {
    rmSync(cleanupTarget, { recursive: true, force: true })
  } else {
    console.error(`[build-profile] Refusing to remove unowned path: ${cleanupTarget}`)
    exitCode ||= 1
  }
}

process.exitCode = exitCode
