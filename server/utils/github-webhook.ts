import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifyGithubWebhookSignature(rawBody: string, signatureHeader: string, secret: string) {
  const trimmedSecret = secret.trim()
  if (!trimmedSecret) return false

  const prefix = 'sha256='
  if (!signatureHeader?.startsWith(prefix)) return false

  const providedDigest = signatureHeader.slice(prefix.length).trim()
  if (!providedDigest) return false

  const expectedDigest = createHmac('sha256', trimmedSecret).update(rawBody, 'utf8').digest('hex')
  const providedBuffer = Buffer.from(providedDigest, 'hex')
  const expectedBuffer = Buffer.from(expectedDigest, 'hex')

  if (providedBuffer.length === 0 || providedBuffer.length !== expectedBuffer.length) {
    return false
  }

  return timingSafeEqual(providedBuffer, expectedBuffer)
}

export function mergeMissingLabel(labels: string[], requiredLabel: string) {
  const merged = new Set<string>()

  for (const label of labels) {
    const normalized = label?.trim()
    if (normalized) {
      merged.add(normalized)
    }
  }

  const normalizedRequired = requiredLabel?.trim()
  if (normalizedRequired) {
    merged.add(normalizedRequired)
  }

  return Array.from(merged)
}

export function resolveCompletedLabel(settings: unknown) {
  if (!settings || typeof settings !== 'object') {
    return 'status:completed'
  }

  const typed = settings as Record<string, unknown>
  const candidates = [typed.completedLabel, typed.closedLabel]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return 'status:completed'
}
