import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

// Encryption at rest for team API keys (Anthropic, OpenAI, Firecrawl, PageSpeed).
// Payload: v1.<keyId>.<iv>.<tag>.<ciphertext>, all binary parts base64url.
//
// Callers should pass associated data (AAD) such as `team:<teamId>:<provider>`.
// AAD is not stored in the payload; it is authenticated on decrypt, so a
// ciphertext copied to another team's or provider's row fails to decrypt.

const VERSION = 'v1'
const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16

export class SecretsConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretsConfigError'
  }
}

export class SecretDecryptionError extends Error {
  constructor(message = 'Unable to decrypt secret') {
    super(message)
    this.name = 'SecretDecryptionError'
  }
}

interface KeyEntry {
  id: string
  key: Buffer
}

interface KeyRing {
  current: KeyEntry
  all: Map<string, KeyEntry>
}

// Accepts 64 hex chars, or base64 / base64url that decodes to exactly 32 bytes.
// Strict character checks because Buffer.from silently skips invalid input.
function parseKey(raw: string, name: string): KeyEntry {
  const value = raw.trim()
  let key: Buffer | null = null

  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    key = Buffer.from(value, 'hex')
  } else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
    key = Buffer.from(value, 'base64')
  }

  if (!key || key.length !== KEY_BYTES) {
    throw new SecretsConfigError(`${name} must be 32 bytes encoded as base64, base64url or 64 hex characters`)
  }

  return { id: createHash('sha256').update(key).digest('hex').slice(0, 8), key }
}

// Parsed on each call (cheap) so a changed env value is always picked up; the
// raw value is never put into an error message.
function loadKeyRing(): KeyRing {
  const currentRaw = process.env.SECRETS_ENCRYPTION_KEY
  if (!currentRaw || !currentRaw.trim()) {
    throw new SecretsConfigError('SECRETS_ENCRYPTION_KEY is not set')
  }

  const current = parseKey(currentRaw, 'SECRETS_ENCRYPTION_KEY')
  const all = new Map<string, KeyEntry>([[current.id, current]])

  const previous = (process.env.SECRETS_ENCRYPTION_KEY_PREVIOUS ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  for (const raw of previous) {
    const entry = parseKey(raw, 'SECRETS_ENCRYPTION_KEY_PREVIOUS')
    if (!all.has(entry.id)) all.set(entry.id, entry)
  }

  return { current, all }
}

function aadBuffer(aad?: string): Buffer | null {
  return aad === undefined ? null : Buffer.from(aad, 'utf8')
}

function parsePayload(payload: string) {
  const parts = typeof payload === 'string' ? payload.split('.') : []
  if (parts.length !== 5) throw new SecretDecryptionError('Malformed secret payload')

  const [version, keyId, iv, tag, ciphertext] = parts
  if (version !== VERSION) throw new SecretDecryptionError('Unsupported secret payload version')
  if (!/^[0-9a-f]{8}$/.test(keyId)) throw new SecretDecryptionError('Malformed secret payload')

  const b64url = /^[A-Za-z0-9_-]*$/
  if (![iv, tag, ciphertext].every((part) => b64url.test(part))) {
    throw new SecretDecryptionError('Malformed secret payload')
  }

  const ivBuf = Buffer.from(iv, 'base64url')
  const tagBuf = Buffer.from(tag, 'base64url')
  // Fixed lengths: GCM would accept truncated tags, which weakens authentication.
  if (ivBuf.length !== IV_BYTES || tagBuf.length !== TAG_BYTES) {
    throw new SecretDecryptionError('Malformed secret payload')
  }

  return { keyId, iv: ivBuf, tag: tagBuf, ciphertext: Buffer.from(ciphertext, 'base64url') }
}

/** True when SECRETS_ENCRYPTION_KEY (and the optional previous keys) are valid. */
export function isSecretsConfigured(): boolean {
  try {
    loadKeyRing()
    return true
  } catch {
    return false
  }
}

/** Encrypts with the current key. Pass the same `aad` to decryptSecret. */
export function encryptSecret(plaintext: string, aad?: string): string {
  const { current } = loadKeyRing()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, current.key, iv, { authTagLength: TAG_BYTES })
  const extra = aadBuffer(aad)
  if (extra) cipher.setAAD(extra)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return [
    VERSION,
    current.id,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

/** Decrypts with the key matching the payload's keyId (current or previous). */
export function decryptSecret(payload: string, aad?: string): string {
  const ring = loadKeyRing()
  const parsed = parsePayload(payload)
  const entry = ring.all.get(parsed.keyId)
  if (!entry) throw new SecretDecryptionError('No matching encryption key for secret')

  try {
    const decipher = createDecipheriv(ALGORITHM, entry.key, parsed.iv, { authTagLength: TAG_BYTES })
    decipher.setAuthTag(parsed.tag)
    const extra = aadBuffer(aad)
    if (extra) decipher.setAAD(extra)
    return Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]).toString('utf8')
  } catch {
    // Node's own error text is dropped on purpose; it adds nothing safe to log.
    throw new SecretDecryptionError('Secret failed authentication')
  }
}

/** True when the payload was encrypted with a key other than the current one. */
export function needsReencryption(payload: string): boolean {
  const { current } = loadKeyRing()
  return parsePayload(payload).keyId !== current.id
}

/** Display hint for UI: an ellipsis plus the last 4 chars (just an ellipsis if short). */
export function keyHint(secret: string): string {
  return secret.length < 8 ? '…' : `…${secret.slice(-4)}`
}
