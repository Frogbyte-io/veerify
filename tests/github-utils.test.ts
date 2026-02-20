import { describe, expect, it } from 'vitest'
import { buildIssueLabels, parseRepoFullName } from '../server/utils/github'

describe('github utils', () => {
  it('parses repository full name', () => {
    expect(parseRepoFullName('owner/repo')).toEqual({ owner: 'owner', repo: 'repo' })
  })

  it('builds deduplicated issue labels', () => {
    const labels = buildIssueLabels({
      explicitLabels: ['bug', 'bug', 'urgent'],
      categoryLabel: 'Feature Request',
      feedbackStatus: 'open',
    })

    expect(labels).toContain('bug')
    expect(labels).toContain('urgent')
    expect(labels).toContain('Feature Request')
    expect(labels).toContain('status:open')
    expect(labels).toContain('source:veerify')
    expect(labels.filter((label) => label === 'bug')).toHaveLength(1)
  })
})
