import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, createWriteStream } from 'node:fs'
import { dirname } from 'node:path'
import { chromium } from 'playwright'
import { getWorktreeRuntimeContext } from './worktree-env.mjs'

function parseArgs(argv) {
  const options = {
    startApp: true,
    baseUrl: null,
    outputPath: process.env.SNAPSHOT_OUTPUT || 'test-results/manual/dashboard-snapshot.png',
    email: process.env.SNAPSHOT_EMAIL || 'test@preview.local',
    password: process.env.SNAPSHOT_PASSWORD || 'password123',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--running') {
      options.startApp = false
      continue
    }
    if (arg === '--base-url') {
      options.baseUrl = argv[i + 1] || null
      i += 1
      continue
    }
    if (arg === '--output') {
      options.outputPath = argv[i + 1] || options.outputPath
      i += 1
      continue
    }
    if (arg === '--email') {
      options.email = argv[i + 1] || options.email
      i += 1
      continue
    }
    if (arg === '--password') {
      options.password = argv[i + 1] || options.password
      i += 1
    }
  }

  return options
}

async function waitForUrl(url, timeoutMs = 120_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2_500)
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
      })
      if (response.status >= 200 && response.status < 500) {
        clearTimeout(timer)
        return true
      }
    } catch {
      // keep polling
    } finally {
      clearTimeout(timer)
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  return false
}

async function captureDashboard({ baseUrl, outputPath, email, password }) {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1720, height: 1000 } })

    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForSelector('[data-testid="login-email"]', { timeout: 30_000 })
    await page.waitForFunction(() => {
      const form = document.querySelector('form')
      return Boolean(form && form.__vueParentComponent)
    })

    await page.fill('[data-testid="login-email"]', email)
    await page.fill('[data-testid="login-password"]', password)

    const signInResponsePromise = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes('/api/auth/sign-in/email'),
      { timeout: 30_000 }
    )

    await page.click('[data-testid="login-submit"]')
    const signInResponse = await signInResponsePromise
    if (!signInResponse.ok()) {
      const body = await signInResponse.text().catch(() => '')
      throw new Error(`Sign-in failed (${signInResponse.status()}): ${body || 'no body'}`)
    }

    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(750)
    await page.screenshot({ path: outputPath, fullPage: true })

    return {
      finalUrl: page.url(),
      title: await page.title(),
    }
  } finally {
    await browser.close()
  }
}

const options = parseArgs(process.argv.slice(2))
const context = getWorktreeRuntimeContext(process.cwd())
const baseUrl = options.baseUrl || process.env.SNAPSHOT_BASE_URL || context.baseURL
const loginUrl = `${baseUrl}/login`

mkdirSync(dirname(options.outputPath), { recursive: true })
const logPath = 'test-results/manual/dev.snapshot.log'
mkdirSync(dirname(logPath), { recursive: true })

let devProcess = null
let startedHere = false

try {
  const alreadyRunning = await waitForUrl(loginUrl, 2_500)
  if (!alreadyRunning) {
    if (!options.startApp) {
      throw new Error(`App is not reachable at ${loginUrl}. Start it first or omit --running.`)
    }

    const isWindows = process.platform === 'win32'
    const yarnCommand = 'yarn'
    const logStream = createWriteStream(logPath, { flags: 'a' })
    devProcess = spawn(yarnCommand, ['dev:worktree'], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWindows,
    })
    devProcess.stdout.pipe(logStream)
    devProcess.stderr.pipe(logStream)
    startedHere = true

    const ready = await waitForUrl(loginUrl, 120_000)
    if (!ready) {
      throw new Error(`App did not become ready at ${loginUrl}. Check ${logPath}.`)
    }
  }

  const snapshotResult = await captureDashboard({
    baseUrl,
    outputPath: options.outputPath,
    email: options.email,
    password: options.password,
  })

  console.log(
    JSON.stringify(
      {
        baseUrl,
        outputPath: options.outputPath,
        ...snapshotResult,
      },
      null,
      2
    )
  )
} finally {
  if (devProcess && startedHere) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(devProcess.pid), '/T', '/F'], {
        stdio: 'ignore',
        shell: false,
      })
    } else if (!devProcess.killed) {
      devProcess.kill('SIGTERM')
      await new Promise((resolve) => setTimeout(resolve, 300))
      if (!devProcess.killed) {
        devProcess.kill('SIGKILL')
      }
    }
  }
}
