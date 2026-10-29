import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { and, eq, gt, inArray, lt } from 'drizzle-orm'
import { createConsola } from 'consola'
import { sendDeviceKeyIssuedEmail } from '~/lib/email'
import { user } from '~/server/database/schema/auth'
import { db } from '~/server/database/drizzle'
import { deviceAuthorization, userApiKey } from '~/server/database/schema/credentials'
import { getPublicBaseUrl } from '~/server/utils/device-http'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { MAX_ACTIVE_KEYS, countActiveUserApiKeys, generateUserApiKey } from '~/server/utils/user-api-keys'

/**
 * Device login (RFC 8628 shaped): an agent requests a code, the user approves it in the browser, and the agent's
 * poll redeems the approval for a new personal API key. Only the SHA-256 of the device code is stored, the key is
 * minted at redemption (never stored in plaintext), and exactly one poll can redeem an approval.
 */

export const DEVICE_CODE_TTL_SECONDS = 600
export const DEVICE_POLL_INTERVAL_SECONDS = 5
export const DEVICE_KEY_TTL_DAYS = 90
/** No vowels (no accidental words) and no look-alikes (0/O, 1/I/L are absent). */
export const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ'

const logger = createConsola().withTag('veerify').withTag('device-login')

const DEVICE_CODE_PREFIX = 'vfy_dev_'
const USER_CODE_LENGTH = 8
const SLOW_DOWN_INCREMENT_SECONDS = 5
const MAX_CREATE_ATTEMPTS = 5
const MAX_KEY_NAME_LENGTH = 60
const DEFAULT_KEY_NAME = 'Device login'
/** The poll interval may be undercut by this much (network jitter) before a poll counts as too fast. */
const POLL_SLACK_MS = 1000
/** Expired rows are kept this long (so a late poll still says expired_token), then purged. */
const PURGE_AFTER_EXPIRY_MS = 86_400_000
const OPPORTUNISTIC_PURGE_LIMIT = 100

export type DeviceTokenError =
  | 'authorization_pending'
  | 'slow_down'
  | 'access_denied'
  | 'expired_token'
  | 'invalid_grant'

export type DeviceTokenResult =
  | { ok: true; accessToken: string; expiresIn: number }
  | { ok: false; error: DeviceTokenError; description: string }

const DESCRIPTIONS: Record<DeviceTokenError, string> = {
  authorization_pending: 'The request has not been approved yet. Keep polling.',
  slow_down: 'Polling too fast. Wait at least the interval before polling again.',
  access_denied: 'The request was denied.',
  expired_token: 'The device code has expired. Start a new login.',
  invalid_grant: 'The device code is unknown or has already been used.',
}

function tokenError(error: DeviceTokenError, description = DESCRIPTIONS[error]): DeviceTokenResult {
  return { ok: false, error, description }
}

export function hashDeviceCode(deviceCode: string): string {
  return createHash('sha256').update(deviceCode).digest('hex')
}

export function generateUserCode(): string {
  let code = ''
  for (let i = 0; i < USER_CODE_LENGTH; i++) code += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)]
  return code
}

/** Upper-cases and drops everything outside the alphabet (dashes, spaces, vowels, digits). */
export function normalizeUserCode(input: string): string {
  let code = ''
  for (const ch of input.toUpperCase()) if (USER_CODE_ALPHABET.includes(ch)) code += ch
  return code
}

export function formatUserCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

function keyName(clientName: string | null | undefined): string {
  const trimmed = clientName?.trim().slice(0, MAX_KEY_NAME_LENGTH).trim()
  return trimmed || DEFAULT_KEY_NAME
}

/** Deletes authorizations that expired more than a day ago. Returns the number of rows removed. */
export async function purgeExpiredDeviceAuthorizations(): Promise<number> {
  const deleted = await db
    .delete(deviceAuthorization)
    .where(lt(deviceAuthorization.expiresAt, new Date(Date.now() - PURGE_AFTER_EXPIRY_MS)))
    .returning({ id: deviceAuthorization.id })
  return deleted.length
}

/** Bounded variant run on every create, so an unauthenticated flood cannot outgrow the scheduled purge. */
async function purgeSomeExpired(): Promise<void> {
  const cutoff = new Date(Date.now() - PURGE_AFTER_EXPIRY_MS)
  await db
    .delete(deviceAuthorization)
    .where(
      inArray(
        deviceAuthorization.id,
        db
          .select({ id: deviceAuthorization.id })
          .from(deviceAuthorization)
          .where(lt(deviceAuthorization.expiresAt, cutoff))
          .limit(OPPORTUNISTIC_PURGE_LIMIT)
      )
    )
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let e: unknown = error; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    const pg = e as { code?: string; constraint?: string }
    if (pg.code === '23505') return pg.constraint === undefined || pg.constraint.includes(constraint)
  }
  return false
}

/**
 * Starts a device login. Returns the device code (only its hash is stored) and the user code formatted as
 * `XXXX-XXXX`. A user code collision is retried with a fresh code.
 */
export async function createDeviceAuthorization(input: {
  clientName?: string | null
}): Promise<{ deviceCode: string; userCode: string; expiresIn: number; interval: number }> {
  const clientName = input.clientName?.trim() || null
  await purgeSomeExpired().catch((error) => logger.warn('Opportunistic device authorization purge failed', error))
  for (let attempt = 1; ; attempt++) {
    const deviceCode = DEVICE_CODE_PREFIX + randomBytes(32).toString('base64url')
    const userCode = generateUserCode()
    const now = new Date()
    try {
      await db.insert(deviceAuthorization).values({
        id: randomUUID(),
        deviceCodeHash: hashDeviceCode(deviceCode),
        userCode,
        clientName,
        status: 'pending',
        interval: DEVICE_POLL_INTERVAL_SECONDS,
        expiresAt: new Date(now.getTime() + DEVICE_CODE_TTL_SECONDS * 1000),
        createdAt: now,
      })
      return {
        deviceCode,
        userCode: formatUserCode(userCode),
        expiresIn: DEVICE_CODE_TTL_SECONDS,
        interval: DEVICE_POLL_INTERVAL_SECONDS,
      }
    } catch (error) {
      if (attempt >= MAX_CREATE_ATTEMPTS || !isUniqueViolation(error, 'user_code')) throw error
    }
  }
}

function pendingByUserCode(userCode: string, now: Date) {
  return and(
    eq(deviceAuthorization.userCode, normalizeUserCode(userCode)),
    eq(deviceAuthorization.status, 'pending'),
    gt(deviceAuthorization.expiresAt, now)
  )
}

export function notFound(): never {
  throw createError({
    statusCode: 404,
    statusMessage: 'Not Found',
    data: createErrorResponse(ErrorCode.NOT_FOUND, 'Code not found or expired'),
  })
}

/** The pending, unexpired request for a user code, or null (unknown, decided and expired all look the same). */
export async function findPendingByUserCode(
  userCode: string
): Promise<{ id: string; clientName: string | null; expiresAt: Date; createdAt: Date } | null> {
  const code = normalizeUserCode(userCode)
  if (code.length !== USER_CODE_LENGTH) return null
  const [row] = await db
    .select({
      id: deviceAuthorization.id,
      clientName: deviceAuthorization.clientName,
      expiresAt: deviceAuthorization.expiresAt,
      createdAt: deviceAuthorization.createdAt,
    })
    .from(deviceAuthorization)
    .where(pendingByUserCode(code, new Date()))
    .limit(1)
  return row ?? null
}

export async function approveDeviceAuthorization(userCode: string, userId: string): Promise<void> {
  if (!(await findPendingByUserCode(userCode))) notFound()
  if ((await countActiveUserApiKeys(userId)) >= MAX_ACTIVE_KEYS) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(ErrorCode.CONFLICT, `You already have ${MAX_ACTIVE_KEYS} active API keys`),
    })
  }
  const now = new Date()
  // Conditional: a request that was decided or expired in the meantime is not approved.
  const updated = await db
    .update(deviceAuthorization)
    .set({ status: 'approved', userId, approvedAt: now })
    .where(pendingByUserCode(userCode, now))
    .returning({ id: deviceAuthorization.id })
  if (updated.length === 0) notFound()
}

export async function denyDeviceAuthorization(userCode: string, userId: string): Promise<void> {
  const updated = await db
    .update(deviceAuthorization)
    .set({ status: 'denied', userId })
    .where(pendingByUserCode(userCode, new Date()))
    .returning({ id: deviceAuthorization.id })
  if (updated.length === 0) notFound()
}

/**
 * One poll of the token endpoint. Runs in a transaction holding the row lock, so concurrent polls serialise: the
 * first redeems an approval and every later one sees `redeemed` (invalid_grant). A poll that arrives before the
 * interval has passed gets slow_down without learning the status.
 */
export async function pollDeviceToken(deviceCode: string): Promise<DeviceTokenResult> {
  const hash = hashDeviceCode(deviceCode)
  let issued: { userId: string; keyName: string; issuedAt: Date } | null = null
  const result = await db.transaction(async (tx): Promise<DeviceTokenResult> => {
    const [row] = await tx
      .select()
      .from(deviceAuthorization)
      .where(eq(deviceAuthorization.deviceCodeHash, hash))
      .for('update')
    if (!row) return tokenError('invalid_grant')
    if (row.status === 'redeemed') return tokenError('invalid_grant')

    const now = new Date()
    if (now.getTime() >= row.expiresAt.getTime()) return tokenError('expired_token')

    if (row.lastPolledAt && now.getTime() - row.lastPolledAt.getTime() < row.interval * 1000 - POLL_SLACK_MS) {
      await tx
        .update(deviceAuthorization)
        .set({ interval: row.interval + SLOW_DOWN_INCREMENT_SECONDS, lastPolledAt: now })
        .where(eq(deviceAuthorization.id, row.id))
      return tokenError('slow_down')
    }

    await tx.update(deviceAuthorization).set({ lastPolledAt: now }).where(eq(deviceAuthorization.id, row.id))

    if (row.status === 'pending') return tokenError('authorization_pending')
    if (row.status !== 'approved' || !row.userId) return tokenError('access_denied')

    if ((await countActiveUserApiKeys(row.userId, tx)) >= MAX_ACTIVE_KEYS) {
      return tokenError('access_denied', 'API key limit reached')
    }

    const { key, keyPrefix, keyHash } = generateUserApiKey()
    const keyId = randomUUID()
    const name = keyName(row.clientName)
    await tx.insert(userApiKey).values({
      id: keyId,
      userId: row.userId,
      name,
      keyPrefix,
      keyHash,
      createdVia: 'device',
      createdAt: now,
      expiresAt: new Date(now.getTime() + DEVICE_KEY_TTL_DAYS * 86_400_000),
    })
    const redeemed = await tx
      .update(deviceAuthorization)
      .set({ status: 'redeemed', redeemedAt: now, issuedKeyId: keyId })
      .where(and(eq(deviceAuthorization.id, row.id), eq(deviceAuthorization.status, 'approved')))
      .returning({ id: deviceAuthorization.id })
    // Unreachable while the row lock is held; throwing rolls the key insert back rather than issuing a second key.
    if (redeemed.length === 0) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Internal Server Error',
        data: createErrorResponse(ErrorCode.INTERNAL_ERROR, 'Device authorization was redeemed concurrently'),
      })
    }

    issued = { userId: row.userId, keyName: name, issuedAt: now }
    return { ok: true, accessToken: key, expiresIn: DEVICE_KEY_TTL_DAYS * 86_400 }
  })
  // The transaction has committed. The notification must never block or fail the token response.
  if (result.ok && issued) void notifyKeyIssued(issued)
  return result
}

async function notifyKeyIssued(issued: { userId: string; keyName: string; issuedAt: Date }): Promise<void> {
  try {
    const [owner] = await db
      .select({ email: user.email, name: user.name })
      .from(user)
      .where(eq(user.id, issued.userId))
      .limit(1)
    if (!owner?.email) return
    await sendDeviceKeyIssuedEmail({
      to: owner.email,
      name: owner.name,
      keyName: issued.keyName,
      issuedAt: issued.issuedAt,
      settingsUrl: `${getPublicBaseUrl()}/settings#api-keys`,
    })
  } catch (error) {
    logger.error('Failed to send the device key issued email', error)
  }
}
