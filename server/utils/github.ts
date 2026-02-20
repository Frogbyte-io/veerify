import { createErrorResponse, ErrorCode } from './response'

interface BuildIssueLabelsParams {
  explicitLabels?: string[]
  categoryLabel?: string | null
  feedbackStatus?: string | null
}

export function parseRepoFullName(value: string) {
  const trimmed = value.trim()
  const [owner = '', repo = ''] = trimmed.split('/')

  if (!owner || !repo) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Repository must be in format "owner/repo"'),
    })
  }

  return { owner, repo }
}

export function buildIssueLabels(params: BuildIssueLabelsParams) {
  const labels = new Set<string>()

  for (const label of params.explicitLabels || []) {
    const normalized = label.trim()
    if (normalized) {
      labels.add(normalized)
    }
  }

  if (params.categoryLabel?.trim()) {
    labels.add(params.categoryLabel.trim())
  }

  if (params.feedbackStatus?.trim()) {
    labels.add(`status:${params.feedbackStatus.trim()}`)
  }

  labels.add('source:veerify')
  return Array.from(labels)
}
