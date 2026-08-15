import { spawnSync } from 'node:child_process'

const isWindows = process.platform === 'win32'
const yarnCommand = 'yarn'

const steps = [
  { label: 'Agent docs map', command: 'node', args: ['scripts/harness-docs-check.mjs'], shell: false },
  { label: 'Typecheck', command: yarnCommand, args: ['typecheck'], shell: isWindows },
  { label: 'Unit tests', command: yarnCommand, args: ['test'], shell: isWindows },
  { label: 'Lint', command: yarnCommand, args: ['lint'], shell: isWindows },
  { label: 'E2E (guarded)', command: yarnCommand, args: ['test:e2e:if-available'], shell: isWindows },
  {
    label: 'Redis integration (guarded)',
    command: yarnCommand,
    args: ['test:integration:if-available'],
    shell: isWindows,
  },
  {
    label: 'Postgres integration (guarded)',
    command: yarnCommand,
    args: ['test:integration:postgres:if-available'],
    shell: isWindows,
  },
]

const timings = []

for (const step of steps) {
  const startedAt = Date.now()
  console.log(`\n[harness:verify] Starting: ${step.label}`)

  const result = spawnSync(step.command, step.args, {
    stdio: 'inherit',
    env: process.env,
    shell: step.shell,
  })

  const durationMs = Date.now() - startedAt
  timings.push({ label: step.label, durationMs })

  if (result.error) {
    throw result.error
  }

  if ((result.status ?? 1) !== 0) {
    console.error(`[harness:verify] Failed: ${step.label}`)
    process.exit(result.status ?? 1)
  }
}

console.log('\n[harness:verify] All validation gates passed.')
for (const timing of timings) {
  console.log(`[harness:verify] ${timing.label}: ${(timing.durationMs / 1000).toFixed(1)}s`)
}
