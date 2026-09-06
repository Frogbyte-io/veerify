import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryDirectories: string[] = []

function fakeExecutable(directory: string, name: string) {
  const script = join(directory, name)
  writeFileSync(script, `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(process.env.LIFECYCLE_LOG, '${name}\\n')\n`)
  chmodSync(script, 0o755)
  writeFileSync(`${script}.cmd`, `@node "${script}" %*\r\n`)
}

function runLifecycle(script: 'build' | 'vercel-build'): string[] {
  const fixture = mkdtempSync(join(tmpdir(), 'veerify-build-lifecycle-'))
  temporaryDirectories.push(fixture)
  const binaryDirectory = join(fixture, 'bin')
  const logPath = join(fixture, 'lifecycle.log')
  const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ private: true, scripts: packageJson.scripts }))
  // The fixture owns these files and is deleted after each test.
  mkdirSync(binaryDirectory)
  for (const executable of ['nuxt', 'drizzle-kit', 'tsx']) fakeExecutable(binaryDirectory, executable)

  execFileSync(process.platform === 'win32' ? 'yarn.cmd' : 'yarn', ['--silent', script], {
    cwd: fixture,
    env: { ...process.env, PATH: `${binaryDirectory}${delimiter}${process.env.PATH ?? ''}`, LIFECYCLE_LOG: logPath },
    stdio: 'pipe',
  })
  return readFileSync(logPath, 'utf8').trim().split(/\r?\n/).filter(Boolean)
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('build lifecycle', () => {
  it('keeps yarn build compile-only', () => {
    expect(runLifecycle('build')).toEqual(['nuxt'])
  })

  it('runs deployment migration before Vercel compilation and never seeds', () => {
    expect(runLifecycle('vercel-build')).toEqual(['drizzle-kit', 'nuxt'])
  })
})
