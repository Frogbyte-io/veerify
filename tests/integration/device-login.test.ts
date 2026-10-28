import { randomUUID } from 'node:crypto'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '../../server/database/drizzle'
import { user } from '../../server/database/schema/auth'
import { deviceAuthorization, userApiKey } from '../../server/database/schema/credentials'

/**
 * Device login against a real Postgres: the full approve-and-redeem path, deny, expiry (Review Focus 2), two polls
 * racing for one approval (Review Focus 1), slow_down and the active key cap.
 */

vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
  Object.assign(new Error(input.statusMessage), input)
)

const {
  DEVICE_KEY_TTL_DAYS,
  approveDeviceAuthorization,
  createDeviceAuthorization,
  denyDeviceAuthorization,
  findPendingByUserCode,
  normalizeUserCode,
  pollDeviceToken,
} = await import('../../server/services/device-login')
const { MAX_ACTIVE_KEYS, generateUserApiKey, hashUserApiKey } = await import('../../server/utils/user-api-keys')

const suffix = randomUUID().slice(0, 8)
const createdUserIds: string[] = []
const createdUserCodes: string[] = []

async function newUser(label: string) {
  const id = `dlg_${label}_${suffix}`
  await db.insert(user).values({ id, name: 'Device User', email: `dlg-${label}-${suffix}@example.com` })
  createdUserIds.push(id)
  return id
}

async function newRequest(clientName: string | null = 'Claude Code') {
  const created = await createDeviceAuthorization({ clientName })
  createdUserCodes.push(normalizeUserCode(created.userCode))
  return created
}

async function rowFor(userCode: string) {
  const [row] = await db
    .select()
    .from(deviceAuthorization)
    .where(eq(deviceAuthorization.userCode, normalizeUserCode(userCode)))
  return row!
}

async function keysOf(userId: string) {
  return db.select().from(userApiKey).where(eq(userApiKey.userId, userId))
}

async function seedActiveKeys(userId: string, n: number) {
  for (let i = 0; i < n; i++) {
    const { keyPrefix, keyHash } = generateUserApiKey()
    await db.insert(userApiKey).values({ id: randomUUID(), userId, name: `seed ${i}`, keyPrefix, keyHash })
  }
}

beforeAll(async () => {
  await db.execute('select 1')
})

afterAll(async () => {
  if (createdUserCodes.length) {
    await db.delete(deviceAuthorization).where(inArray(deviceAuthorization.userCode, createdUserCodes))
  }
  if (createdUserIds.length) await db.delete(user).where(inArray(user.id, createdUserIds))
})

describe('device login service', () => {
  it('creates a pending request and stores only the device code hash', async () => {
    const created = await newRequest()
    expect(created.deviceCode).toMatch(/^vfy_dev_[A-Za-z0-9_-]{43}$/)
    expect(created.userCode).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/)
    expect(created.expiresIn).toBe(600)
    expect(created.interval).toBe(5)

    const row = await rowFor(created.userCode)
    expect(row.status).toBe('pending')
    expect(row.deviceCodeHash).toBe(hashUserApiKey(created.deviceCode))
    expect(row.deviceCodeHash).not.toContain(created.deviceCode)
    expect(row.clientName).toBe('Claude Code')

    const found = await findPendingByUserCode(created.userCode.toLowerCase())
    expect(found).toMatchObject({ id: row.id, clientName: 'Claude Code' })
    expect(found?.expiresAt).toBeInstanceOf(Date)
  })

  it('approves and redeems exactly once', async () => {
    const userId = await newUser('happy')
    const created = await newRequest('  Claude Code on laptop  ')

    expect(await pollDeviceToken(created.deviceCode)).toMatchObject({ ok: false, error: 'authorization_pending' })

    await approveDeviceAuthorization(created.userCode, userId)
    expect(await findPendingByUserCode(created.userCode)).toBeNull()
    // Skip the polling interval so the next poll is not slowed down.
    await db
      .update(deviceAuthorization)
      .set({ lastPolledAt: null })
      .where(eq(deviceAuthorization.userCode, normalizeUserCode(created.userCode)))

    const result = await pollDeviceToken(created.deviceCode)
    if (!result.ok) throw new Error(`expected a key, got ${result.error}`)
    expect(result.accessToken.startsWith('vfy_usr_')).toBe(true)
    expect(result.expiresIn).toBe(DEVICE_KEY_TTL_DAYS * 86400)

    const keys = await keysOf(userId)
    expect(keys).toHaveLength(1)
    const key = keys[0]!
    expect(key.createdVia).toBe('device')
    expect(key.name).toBe('Claude Code on laptop')
    expect(key.keyHash).toBe(hashUserApiKey(result.accessToken))
    const expectedExpiry = Date.now() + DEVICE_KEY_TTL_DAYS * 86400_000
    expect(Math.abs(key.expiresAt!.getTime() - expectedExpiry)).toBeLessThan(60_000)

    const row = await rowFor(created.userCode)
    expect(row.status).toBe('redeemed')
    expect(row.issuedKeyId).toBe(key.id)
    expect(row.redeemedAt).toBeInstanceOf(Date)

    await db.update(deviceAuthorization).set({ lastPolledAt: null }).where(eq(deviceAuthorization.id, row.id))
    expect(await pollDeviceToken(created.deviceCode)).toMatchObject({ ok: false, error: 'invalid_grant' })
    expect(await keysOf(userId)).toHaveLength(1)
  })

  it('names the key "Device login" without a client name, and caps it at 60 characters', async () => {
    const userId = await newUser('names')
    const unnamed = await newRequest(null)
    const long = await newRequest('x'.repeat(80))
    await approveDeviceAuthorization(unnamed.userCode, userId)
    await approveDeviceAuthorization(long.userCode, userId)
    expect(await pollDeviceToken(unnamed.deviceCode)).toMatchObject({ ok: true })
    expect(await pollDeviceToken(long.deviceCode)).toMatchObject({ ok: true })
    const names = (await keysOf(userId)).map((k) => k.name).sort()
    expect(names).toEqual(['Device login', 'x'.repeat(60)])
  })

  it('returns invalid_grant for an unknown device code', async () => {
    expect(await pollDeviceToken('vfy_dev_unknown')).toMatchObject({ ok: false, error: 'invalid_grant' })
  })

  it('denies', async () => {
    const userId = await newUser('deny')
    const created = await newRequest()
    await denyDeviceAuthorization(created.userCode, userId)
    expect(await pollDeviceToken(created.deviceCode)).toMatchObject({ ok: false, error: 'access_denied' })
    expect(await keysOf(userId)).toHaveLength(0)
    // Already decided: neither approve nor deny can change it.
    await expect(approveDeviceAuthorization(created.userCode, userId)).rejects.toMatchObject({ statusCode: 404 })
    await expect(denyDeviceAuthorization(created.userCode, userId)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('refuses unknown codes with 404', async () => {
    const userId = await newUser('unknown')
    await expect(approveDeviceAuthorization('ZZZZ-ZZZZ', userId)).rejects.toMatchObject({
      statusCode: 404,
      data: { error: { code: 'NOT_FOUND', message: 'Code not found or expired' } },
    })
    await expect(denyDeviceAuthorization('ZZZZ-ZZZZ', userId)).rejects.toMatchObject({ statusCode: 404 })
    expect(await findPendingByUserCode('ZZZZ-ZZZZ')).toBeNull()
  })

  it('Review Focus 2: an expired request cannot be approved or redeemed', async () => {
    const userId = await newUser('expired')
    const created = await newRequest()
    const past = new Date(Date.now() - 1000)
    await db
      .update(deviceAuthorization)
      .set({ expiresAt: past })
      .where(eq(deviceAuthorization.userCode, normalizeUserCode(created.userCode)))

    expect(await findPendingByUserCode(created.userCode)).toBeNull()
    await expect(approveDeviceAuthorization(created.userCode, userId)).rejects.toMatchObject({ statusCode: 404 })
    await expect(denyDeviceAuthorization(created.userCode, userId)).rejects.toMatchObject({ statusCode: 404 })
    expect(await pollDeviceToken(created.deviceCode)).toMatchObject({ ok: false, error: 'expired_token' })
  })

  it('Review Focus 2: an approval that expires before redemption gives expired_token, never a key', async () => {
    const userId = await newUser('expapproved')
    const created = await newRequest()
    await approveDeviceAuthorization(created.userCode, userId)
    await db
      .update(deviceAuthorization)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(deviceAuthorization.userCode, normalizeUserCode(created.userCode)))
    expect(await pollDeviceToken(created.deviceCode)).toMatchObject({ ok: false, error: 'expired_token' })
    expect(await keysOf(userId)).toHaveLength(0)
  })

  it('Review Focus 1: racing polls after approval issue exactly one key', async () => {
    const userId = await newUser('race')
    const created = await newRequest()
    await approveDeviceAuthorization(created.userCode, userId)
    await db
      .update(deviceAuthorization)
      .set({ lastPolledAt: null })
      .where(eq(deviceAuthorization.userCode, normalizeUserCode(created.userCode)))

    // Open enough pooled connections first, so the polls overlap instead of queueing behind connection setup.
    await Promise.all(Array.from({ length: 5 }, () => db.execute(sql`select pg_sleep(0.05)`)))
    const results = await Promise.all(Array.from({ length: 5 }, () => pollDeviceToken(created.deviceCode)))
    const winners = results.filter((r) => r.ok)
    expect(winners).toHaveLength(1)
    for (const loser of results.filter((r) => !r.ok)) {
      expect(loser).toMatchObject({ ok: false, error: 'invalid_grant' })
    }
    const keys = await keysOf(userId)
    expect(keys).toHaveLength(1)
    expect((await rowFor(created.userCode)).issuedKeyId).toBe(keys[0]!.id)
  })

  it('slows down polls that come faster than the interval', async () => {
    const created = await newRequest()
    expect(await pollDeviceToken(created.deviceCode)).toMatchObject({ ok: false, error: 'authorization_pending' })
    const second = await pollDeviceToken(created.deviceCode)
    expect(second).toMatchObject({ ok: false, error: 'slow_down' })
    expect((await rowFor(created.userCode)).interval).toBe(10)
    expect(await pollDeviceToken(created.deviceCode)).toMatchObject({ ok: false, error: 'slow_down' })
    expect((await rowFor(created.userCode)).interval).toBe(15)
  })

  it('slow_down does not reveal an approval', async () => {
    const userId = await newUser('slowapproved')
    const created = await newRequest()
    expect(await pollDeviceToken(created.deviceCode)).toMatchObject({ error: 'authorization_pending' })
    await approveDeviceAuthorization(created.userCode, userId)
    expect(await pollDeviceToken(created.deviceCode)).toMatchObject({ ok: false, error: 'slow_down' })
    expect(await keysOf(userId)).toHaveLength(0)
    expect((await rowFor(created.userCode)).status).toBe('approved')
  })

  it('refuses approval at the active key cap', async () => {
    const userId = await newUser('cap')
    await seedActiveKeys(userId, MAX_ACTIVE_KEYS)
    const created = await newRequest()
    await expect(approveDeviceAuthorization(created.userCode, userId)).rejects.toMatchObject({
      statusCode: 409,
      data: { error: { code: 'CONFLICT', message: 'You already have 25 active API keys' } },
    })
    expect((await rowFor(created.userCode)).status).toBe('pending')
  })

  it('ignores revoked and expired keys when counting toward the cap', async () => {
    const userId = await newUser('capinactive')
    await seedActiveKeys(userId, MAX_ACTIVE_KEYS - 1)
    const { keyPrefix, keyHash } = generateUserApiKey()
    await db
      .insert(userApiKey)
      .values({ id: randomUUID(), userId, name: 'revoked', keyPrefix, keyHash, revokedAt: new Date() })
    const expired = generateUserApiKey()
    await db.insert(userApiKey).values({
      id: randomUUID(),
      userId,
      name: 'expired',
      keyPrefix: expired.keyPrefix,
      keyHash: expired.keyHash,
      expiresAt: new Date(Date.now() - 1000),
    })
    const created = await newRequest()
    await approveDeviceAuthorization(created.userCode, userId)
    expect((await rowFor(created.userCode)).status).toBe('approved')
  })

  it('refuses redemption when the user reached the cap after approving', async () => {
    const userId = await newUser('capredeem')
    const created = await newRequest()
    await approveDeviceAuthorization(created.userCode, userId)
    await seedActiveKeys(userId, MAX_ACTIVE_KEYS)
    expect(await pollDeviceToken(created.deviceCode)).toEqual({
      ok: false,
      error: 'access_denied',
      description: 'API key limit reached',
    })
    expect(await keysOf(userId)).toHaveLength(MAX_ACTIVE_KEYS)
    expect((await rowFor(created.userCode)).status).toBe('approved')
  })
})
