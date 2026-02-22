import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { mergeMissingLabel, resolveCompletedLabel, verifyGithubWebhookSignature } from '../server/utils/github-webhook'

describe('github webhook utils', () => {
  it('verifies a valid github webhook signature', () => {
    const body = JSON.stringify({ action: 'closed', issue: { number: 42 } })
    const secret = 'secret-value'
    const digest = createHmac('sha256', secret).update(body, 'utf8').digest('hex')
    const signature = `sha256=${digest}`

    expect(verifyGithubWebhookSignature(body, signature, secret)).toBe(true)
    expect(verifyGithubWebhookSignature(body, signature, 'wrong-secret')).toBe(false)
  })

  it('merges a required label only once', () => {
    const labels = mergeMissingLabel(['bug', 'status:completed'], 'status:completed')
    expect(labels).toContain('bug')
    expect(labels).toContain('status:completed')
    expect(labels.filter((label) => label === 'status:completed')).toHaveLength(1)
  })

  it('resolves completed label from integration settings when provided', () => {
    expect(resolveCompletedLabel({ completedLabel: 'done' })).toBe('done')
    expect(resolveCompletedLabel({ closedLabel: 'closed' })).toBe('closed')
    expect(resolveCompletedLabel({})).toBe('status:completed')
  })
})
