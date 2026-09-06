import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { eq } from 'drizzle-orm'
import Redis from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization, session, team, teamMember, user } from '../../server/database/schema/auth'
import {
  contact,
  conversation,
  conversationMessage,
  supportInbox,
  supportInboxMember,
  supportOutboundDelivery,
} from '../../server/database/schema/support'

const DATABASE_URL = process.env.DATABASE_URL
const REDIS_URL = process.env.REDIS_URL
const AUTH_SECRET = 'realtime-two-process-auth-secret-0123456789'
const UPLOAD_SECRET = 'realtime-two-process-upload-secret-0123456789'
const POSTMARK_USER = 'realtime-test-user'
const POSTMARK_PASSWORD = 'realtime-test-password'
const POSTMARK_ACCOUNT = 'realtime-test-server'

/**
 * This suite needs a real Postgres *and* a real Redis, but it is collected by the
 * Postgres guard (`run-postgres-integration-if-available.mjs`), which only probes
 * Postgres. Without a self-check, `yarn harness:verify` would hard-fail on a machine
 * that has one dependency and not the other — the exact all-or-nothing outcome the
 * two separate guard scripts exist to avoid. Probe here and skip with a stated reason.
 */
async function resolveSkipReason(): Promise<string | null> {
  if (!DATABASE_URL) return 'DATABASE_URL is not set'
  if (!REDIS_URL) return 'REDIS_URL is not set'

  const probe = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    connectTimeout: 2_000,
  })
  try {
    await probe.connect()
    await probe.ping()
    return null
  } catch {
    return `Redis is not reachable at ${REDIS_URL}`
  } finally {
    probe.disconnect()
  }
}

const skipReason = await resolveSkipReason()
if (skipReason) {
  console.log(`[realtime-two-process] Skipping: ${skipReason}.`)
}

interface AppProcess {
  baseUrl: string
  child: ChildProcess
  logs: () => string
}

interface SocketClient {
  socket: WebSocket
  frames: Array<Record<string, unknown>>
}

function waitForCondition(
  check: () => boolean | Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number; message?: string } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000
  const intervalMs = options.intervalMs ?? 100
  const deadline = Date.now() + timeoutMs

  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        if (await check()) {
          resolve()
          return
        }
        if (Date.now() >= deadline) {
          reject(new Error(options.message ?? `Condition not met within ${timeoutMs}ms`))
          return
        }
        setTimeout(poll, intervalMs)
      } catch (error) {
        reject(error)
      }
    }
    void poll()
  })
}

async function reservePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to reserve an application port')
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  return address.port
}

async function startApp(label: string, buildDirectory: string): Promise<AppProcess> {
  const port = await reservePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const command = process.platform === 'win32' ? 'yarn.cmd' : 'yarn'
  let output = ''
  const child = spawn(command, ['nuxt', 'dev', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: process.cwd(),
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      NODE_OPTIONS: '--max-old-space-size=2048',
      DATABASE_URL,
      REDIS_URL,
      REALTIME_DRIVER: 'redis',
      BETTER_AUTH_SECRET: AUTH_SECRET,
      BETTER_AUTH_URL: baseUrl,
      APP_DOMAIN: '127.0.0.1',
      UPLOAD_TOKEN_SECRET: UPLOAD_SECRET,
      SUPPORT_POSTMARK_WEBHOOK_USER: POSTMARK_USER,
      SUPPORT_POSTMARK_WEBHOOK_PASSWORD: POSTMARK_PASSWORD,
      SUPPORT_POSTMARK_ACCOUNT_KEY: POSTMARK_ACCOUNT,
      NUXT_BUILD_DIR: buildDirectory,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const collect = (chunk: Buffer) => {
    output = `${output}${chunk.toString()}`.slice(-30_000)
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)

  await waitForCondition(
    async () => {
      if (child.exitCode !== null) throw new Error(`${label} exited during startup (${child.exitCode})\n${output}`)
      try {
        return (await fetch(`${baseUrl}/api/test`)).ok
      } catch {
        return false
      }
    },
    { timeoutMs: 90_000, intervalMs: 250, message: `${label} did not become ready\n${output}` }
  )

  return { baseUrl, child, logs: () => output }
}

async function stopApp(app: AppProcess): Promise<void> {
  if (app.child.exitCode !== null) return

  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(app.child.pid), '/t', '/f'], { windowsHide: true })
    return
  }

  if (app.child.pid) process.kill(-app.child.pid, 'SIGTERM')
  await Promise.race([
    new Promise<void>((resolve) => app.child.once('close', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ])
  if (app.child.exitCode === null && app.child.pid) process.kill(-app.child.pid, 'SIGKILL')
}

async function connectSocket(app: AppProcess, token: string): Promise<SocketClient> {
  const socket = new WebSocket(`${app.baseUrl.replace(/^http/, 'ws')}/_ws?token=${encodeURIComponent(token)}`)
  const frames: Array<Record<string, unknown>> = []
  socket.addEventListener('message', (message) => {
    try {
      frames.push(JSON.parse(String(message.data)) as Record<string, unknown>)
    } catch {
      // The application protocol uses JSON except for explicit ping/pong frames.
    }
  })
  await waitForCondition(() => frames.some((frame) => frame.type === 'connected'), {
    message: `WebSocket did not authenticate against ${app.baseUrl}\n${app.logs()}`,
  })
  return { socket, frames }
}

function subscribe(client: SocketClient, channel: string): Promise<void> {
  client.socket.send(JSON.stringify({ action: 'subscribe', channel }))
  return waitForCondition(
    () => client.frames.some((frame) => frame.type === 'subscribed' && frame.channel === channel),
    { message: `WebSocket subscription was not acknowledged for ${channel}` }
  )
}

function receivedEvent(client: SocketClient, type: string, messageId: string): boolean {
  return client.frames.some((frame) => {
    if (frame.type !== 'event') return false
    const event = frame.event as Record<string, unknown> | undefined
    return event?.type === type && event.messageId === messageId
  })
}

async function postJson<T = unknown>(
  baseUrl: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl, ...headers },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`POST ${path} failed (${response.status}): ${text}`)
  return JSON.parse(text) as T
}

/**
 * Sign up through the running app so the returned cookie is a genuine, signed
 * Better Auth session cookie.
 *
 * The suite previously inserted a `session` row by hand and sent
 * `Authorization: Bearer <token>` on its HTTP calls. That only worked because a
 * global `bearer` plugin was registered, which made the realtime token a
 * credential for the entire API - the security regression this test's own fix
 * wave removed. Authenticating the way a browser does keeps the HTTP half
 * honest; the WebSocket half still uses the raw session token, which is now the
 * only thing that token is good for.
 */
async function signUpAndAuthenticate(
  baseUrl: string,
  credentials: { name: string; email: string; password: string }
): Promise<{ userId: string; cookie: string }> {
  const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify(credentials),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Sign-up failed (${response.status}): ${text}`)

  const setCookie = response.headers.getSetCookie?.() ?? []
  const cookie = setCookie
    .map((entry) => entry.split(';')[0])
    .filter((entry) => entry.startsWith('better-auth.'))
    .join('; ')
  if (!cookie) throw new Error(`Sign-up returned no session cookie: ${setCookie.join(' | ')}`)

  return { userId: (JSON.parse(text) as { user: { id: string } }).user.id, cookie }
}

describe.skipIf(skipReason !== null)('realtime across two application processes', () => {
  const suffix = randomUUID()
  const ids = {
    organization: `realtime-org-${suffix}`,
    team: `realtime-team-${suffix}`,
    inbox: `realtime-inbox-${suffix}`,
    inboxMember: `realtime-inbox-member-${suffix}`,
    contact: `realtime-contact-${suffix}`,
    conversation: `realtime-conversation-${suffix}`,
    deliveryMessage: `realtime-delivery-message-${suffix}`,
    delivery: `realtime-delivery-${suffix}`,
  }
  // Resolved during setup: the user id, the signed cookie for HTTP calls, and
  // the raw session token the WebSocket authenticates with.
  const auth = { userId: '', cookie: '', token: '' }
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'veerify-realtime-two-process-'))
  const apps: AppProcess[] = []
  const sockets: SocketClient[] = []
  let redis: Redis

  beforeAll(async () => {
    if (!DATABASE_URL || !REDIS_URL) throw new Error('DATABASE_URL and REDIS_URL are required')
    const now = new Date()

    // Apps first: the user is created through the running app's sign-up route
    // so the session cookie is genuinely signed, rather than hand-inserted.
    apps.push(
      await startApp('instance A', join(temporaryRoot, 'instance-a')),
      await startApp('instance B', join(temporaryRoot, 'instance-b'))
    )

    const credentials = {
      name: 'Realtime Agent',
      email: `realtime-${suffix}@example.com`,
      password: `Realtime-${suffix.slice(0, 8)}!`,
    }
    const signedUp = await signUpAndAuthenticate(apps[0].baseUrl, credentials)
    auth.userId = signedUp.userId
    auth.cookie = signedUp.cookie

    const [issuedSession] = await db
      .select({ token: session.token })
      .from(session)
      .where(eq(session.userId, auth.userId))
      .limit(1)
    if (!issuedSession) throw new Error('Sign-up created no session row')
    auth.token = issuedSession.token

    await db.insert(organization).values({ id: ids.organization, name: 'Realtime test', slug: `realtime-${suffix}` })
    await db.insert(team).values({
      id: ids.team,
      name: 'Realtime team',
      slug: `realtime-team-${suffix}`,
      organizationId: ids.organization,
    })
    await db.insert(teamMember).values({ id: randomUUID(), teamId: ids.team, userId: auth.userId, role: 'member' })
    await db
      .update(session)
      .set({ activeOrganizationId: ids.organization, activeTeamId: ids.team, updatedAt: now })
      .where(eq(session.userId, auth.userId))
    await db.insert(supportInbox).values({
      id: ids.inbox,
      teamId: ids.team,
      name: 'Realtime inbox',
      slug: `realtime-inbox-${suffix}`,
    })
    await db.insert(supportInboxMember).values({
      id: ids.inboxMember,
      inboxId: ids.inbox,
      userId: auth.userId,
      role: 'agent',
    })
    await db.insert(contact).values({
      id: ids.contact,
      teamId: ids.team,
      name: 'Realtime customer',
      email: `customer-${suffix}@example.com`,
    })
    await db.insert(conversation).values({
      id: ids.conversation,
      inboxId: ids.inbox,
      teamId: ids.team,
      contactId: ids.contact,
      displayId: 1,
      subject: 'Realtime test',
    })
    await db.insert(conversationMessage).values({
      id: ids.deliveryMessage,
      conversationId: ids.conversation,
      kind: 'outgoing',
      body: 'Delivery status fixture',
      senderKind: 'agent',
      senderUserId: auth.userId,
      deliveryStatus: 'sent',
    })
    await db.insert(supportOutboundDelivery).values({
      id: ids.delivery,
      messageId: ids.deliveryMessage,
      kind: 'email',
      provider: 'postmark',
      providerAccountKey: POSTMARK_ACCOUNT,
      providerMessageId: `provider-${suffix}`,
      payload: { to: `customer-${suffix}@example.com`, subject: 'Realtime test' },
      idempotencyKey: ids.delivery,
      status: 'sent',
      attemptCount: 1,
    })

    redis = new Redis(REDIS_URL)
  }, 180_000)

  afterAll(async () => {
    for (const socket of sockets) socket.socket.close()
    for (const app of apps.reverse()) await stopApp(app)
    if (redis) await redis.quit()
    if (auth.userId) await db.delete(user).where(eq(user.id, auth.userId))
    await db.delete(organization).where(eq(organization.id, ids.organization))
    rmSync(temporaryRoot, { recursive: true, force: true })
  }, 30_000)

  it('delivers message events across instances and restores subscriptions after Redis reconnect', async () => {
    const [instanceA, instanceB] = apps
    const clientA = await connectSocket(instanceA, auth.token)
    const clientB = await connectSocket(instanceB, auth.token)
    sockets.push(clientA, clientB)
    const channel = `conversation:${ids.conversation}`
    await Promise.all([subscribe(clientA, channel), subscribe(clientB, channel)])

    // A browser's credentials: the signed session cookie, not the raw token.
    const authHeaders = { cookie: auth.cookie }
    const created = await postJson<{ data: { message: { id: string } } }>(
      instanceA.baseUrl,
      `/api/support/conversations/${ids.conversation}/messages`,
      { kind: 'note', body: 'Cross-process realtime note' },
      authHeaders
    )
    const createdMessageId = created.data.message.id as string
    await waitForCondition(
      () =>
        receivedEvent(clientA, 'message.created', createdMessageId) &&
        receivedEvent(clientB, 'message.created', createdMessageId),
      { message: `message.created did not reach both instances\nA:\n${instanceA.logs()}\nB:\n${instanceB.logs()}` }
    )

    const deliveryPayload = {
      RecordType: 'Delivery',
      MessageID: `provider-${suffix}`,
      Recipient: `customer-${suffix}@example.com`,
      DeliveredAt: new Date().toISOString(),
      ServerID: POSTMARK_ACCOUNT,
      Metadata: { 'veerify-delivery-id': ids.delivery },
    }
    await postJson(instanceA.baseUrl, '/api/support/delivery/postmark', deliveryPayload, {
      authorization: `Basic ${Buffer.from(`${POSTMARK_USER}:${POSTMARK_PASSWORD}`).toString('base64')}`,
    })
    await waitForCondition(
      () =>
        receivedEvent(clientA, 'message.delivery-status', ids.deliveryMessage) &&
        receivedEvent(clientB, 'message.delivery-status', ids.deliveryMessage),
      {
        message: `message.delivery-status did not reach both instances\nA:\n${instanceA.logs()}\nB:\n${instanceB.logs()}`,
      }
    )

    await redis.call('CLIENT', 'KILL', 'TYPE', 'pubsub').catch(() => undefined)
    await waitForCondition(
      async () => {
        const clients = String(await redis.call('CLIENT', 'LIST'))
        return clients.split('\n').filter((line) => line.includes('cmd=subscribe')).length >= 2
      },
      { timeoutMs: 15_000, intervalMs: 200, message: 'Application Redis subscribers did not reconnect' }
    )

    const restored = await postJson<{ data: { message: { id: string } } }>(
      instanceA.baseUrl,
      `/api/support/conversations/${ids.conversation}/messages`,
      { kind: 'note', body: 'Realtime note after subscriber reconnect' },
      authHeaders
    )
    const restoredMessageId = restored.data.message.id as string
    await waitForCondition(() => receivedEvent(clientB, 'message.created', restoredMessageId), {
      message: `Restored subscription did not deliver to instance B\n${instanceB.logs()}`,
    })

    expect(receivedEvent(clientB, 'message.created', createdMessageId)).toBe(true)
    expect(receivedEvent(clientB, 'message.delivery-status', ids.deliveryMessage)).toBe(true)
    expect(receivedEvent(clientB, 'message.created', restoredMessageId)).toBe(true)
  }, 120_000)
})
