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

/**
 * Maps a GitHub close reason to a Veerify feedback status.
 * - state_reason "completed"  → "completed"
 * - state_reason "not_planned" or "duplicate" → "closed"
 */
export function resolveStatusFromCloseReason(stateReason: string | null | undefined): 'completed' | 'closed' {
  return stateReason === 'completed' ? 'completed' : 'closed'
}

export function resolveCompletedLabel(settings: unknown): string {
  if (settings && typeof settings === 'object') {
    const typed = settings as Record<string, unknown>

    for (const key of ['completedLabel', 'closedLabel']) {
      const custom = typed[key]
      if (typeof custom === 'string' && custom.trim()) {
        return custom.trim()
      }
    }
  }

  return 'status:completed'
}

export function resolveStatusLabel(feedbackStatus: 'completed' | 'closed', settings: unknown): string {
  if (settings && typeof settings === 'object') {
    const typed = settings as Record<string, unknown>
    const key = feedbackStatus === 'completed' ? 'completedLabel' : 'closedLabel'
    const custom = typed[key]
    if (typeof custom === 'string' && custom.trim()) {
      return custom.trim()
    }
  }

  return feedbackStatus
}
