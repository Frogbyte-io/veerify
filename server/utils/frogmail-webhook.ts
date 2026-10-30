/**
 * Native Frogmail webhook verification (`Frogmail-Signature`, or the legacy
 * `Larasend-Signature`): `t=<unix>,v1=<hex>[,v1=<hex>...]`, every `v1` an
 * HMAC-SHA256 of `"<t>.<raw body>"`. Several `v1` values and several secrets
 * (comma-separated `FROGMAIL_WEBHOOK_SECRET`) allow key rotation.
 *
 * Replay guard: an accepted signature is remembered for the tolerance window.
 * Redis (`SET NX EX`) when `REDIS_URL` is set, so it holds across instances;
 * otherwise, or when Redis fails, an in-process map (single instance only).
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getSharedRedisClient } from '~/server/services/redis/client'

export const FROGMAIL_WEBHOOK_TOLERANCE_SECONDS = 300

export type FrogmailWebhookFailure =
  | 'missing_signature'
  | 'malformed_signature'
  | 'signature_mismatch'
  | 'timestamp_outside_tolerance'
  | 'replayed'

export type FrogmailWebhookResult = { ok: true } | { ok: false; reason: FrogmailWebhookFailure }

export interface ReplayStore {
  /** True when `key` was new, false when seen before. */
  remember(key: string, ttlSeconds: number): Promise<boolean> | boolean
}

const MAX_MEMORY_ENTRIES = 10_000

export function createMemoryReplayStore(now: () => number = Date.now): ReplayStore {
  const entries = new Map<string, number>()
  return {
    remember(key, ttlSeconds) {
      const at = now()
      const expiresAt = entries.get(key)
      if (expiresAt !== undefined && expiresAt > at) return false
      entries.delete(key)
      entries.set(key, at + ttlSeconds * 1000)
      for (const [entryKey, entryExpiry] of entries) {
        if (entries.size <= MAX_MEMORY_ENTRIES && entryExpiry > at) break
        entries.delete(entryKey)
      }
      return true
    },
  }
}

const memoryStore = createMemoryReplayStore()

export function getReplayStore(): ReplayStore {
  const url = process.env.REDIS_URL
  if (!url) return memoryStore
  return {
    async remember(key, ttlSeconds) {
      try {
        const result = await getSharedRedisClient(url).set(`frogmail-webhook:${key}`, '1', 'EX', ttlSeconds, 'NX')
        return result === 'OK'
      } catch {
        return memoryStore.remember(key, ttlSeconds)
      }
    },
  }
}

export function parseWebhookSecrets(value: string | undefined | null): string[] {
  return (value ?? '')
    .split(',')
    .map((secret) => secret.trim())
    .filter(Boolean)
}

function parseSignatureHeader(value: string): { timestamp: number; signatures: string[] } | null {
  let timestamp: number | null = null
  const signatures: string[] = []
  for (const part of value.split(',')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const name = part.slice(0, index).trim()
    const content = part.slice(index + 1).trim()
    if (name === 't' && /^\d+$/.test(content)) timestamp = Number(content)
    else if (name === 'v1' && /^[0-9a-f]+$/i.test(content)) signatures.push(content.toLowerCase())
  }
  if (timestamp === null || signatures.length === 0) return null
  return { timestamp, signatures }
}

function hmacMatches(secret: string, signedPayload: string, candidate: string): boolean {
  const expected = createHmac('sha256', secret).update(signedPayload, 'utf8').digest()
  const provided = Buffer.from(candidate, 'hex')
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

export async function verifyFrogmailWebhook(input: {
  rawBody: string
  headers: Record<string, string | undefined>
  secrets: string[]
  now?: () => number
  replayStore?: ReplayStore
  toleranceSeconds?: number
}): Promise<FrogmailWebhookResult> {
  const header = input.headers['frogmail-signature'] ?? input.headers['larasend-signature']
  if (!header) return { ok: false, reason: 'missing_signature' }

  const parsed = parseSignatureHeader(header)
  if (!parsed) return { ok: false, reason: 'malformed_signature' }

  const tolerance = input.toleranceSeconds ?? FROGMAIL_WEBHOOK_TOLERANCE_SECONDS
  const nowSeconds = (input.now ?? Date.now)() / 1000
  if (Math.abs(nowSeconds - parsed.timestamp) > tolerance) return { ok: false, reason: 'timestamp_outside_tolerance' }

  const signedPayload = `${parsed.timestamp}.${input.rawBody}`
  // No early exit across secrets/signatures, so timing does not reveal which matched.
  let matched: string | null = null
  for (const secret of input.secrets) {
    for (const candidate of parsed.signatures) {
      if (hmacMatches(secret, signedPayload, candidate) && matched === null) matched = candidate
    }
  }
  if (matched === null) return { ok: false, reason: 'signature_mismatch' }

  const fresh = await (input.replayStore ?? getReplayStore()).remember(matched, tolerance * 2)
  return fresh ? { ok: true } : { ok: false, reason: 'replayed' }
}
