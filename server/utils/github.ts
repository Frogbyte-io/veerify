import { createErrorResponse, ErrorCode } from './response'

interface BuildIssueLabelsParams {
  explicitLabels?: string[]
  categoryLabel?: string | null
  feedbackStatus?: string | null
}

// Hex colors (without #) for labels Veerify manages on GitHub
const LABEL_COLORS: Record<string, string> = {
  veerify: '6366f1',
  open: '0075ca',
  in_progress: 'fbca04',
  planned: '7057ff',
  completed: '0e8a16',
  closed: 'cfd3d7',
  declined: 'd93f0b',
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
    labels.add(params.feedbackStatus.trim())
  }

  labels.add('veerify')
  return Array.from(labels)
}

interface RegisterWebhookResult {
  webhookId: string
  webhookSecret: string
}

/**
 * Registers a webhook on a GitHub repo that delivers `issues` events to
 * /api/github/webhook. Returns the webhook ID and generated secret.
 * Throws if the GitHub API call fails.
 */
export async function registerGitHubWebhook(
  owner: string,
  repo: string,
  accessToken: string,
  webhookUrl: string,
): Promise<RegisterWebhookResult> {
  const webhookSecret = crypto.randomUUID().replace(/-/g, '')

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Veerify',
    },
    body: JSON.stringify({
      name: 'web',
      active: true,
      events: ['issues'],
      config: {
        url: webhookUrl,
        content_type: 'json',
        secret: webhookSecret,
        insecure_ssl: '0',
      },
    }),
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null
    throw createError({
      statusCode: response.status,
      statusMessage: 'GitHub webhook registration failed',
      data: createErrorResponse(ErrorCode.INTERNAL_ERROR, body?.message || 'Failed to register GitHub webhook'),
    })
  }

  const created = (await response.json()) as { id: number }
  return { webhookId: String(created.id), webhookSecret }
}

/**
 * Deletes a previously registered webhook. Failures are swallowed — the webhook
 * may have already been deleted manually in GitHub.
 */
export async function deleteGitHubWebhook(
  owner: string,
  repo: string,
  webhookId: string,
  accessToken: string,
): Promise<void> {
  await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks/${webhookId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Veerify',
    },
  }).catch(() => {})
}

/**
 * Ensures that any Veerify-managed labels exist in the repo with the correct colour.
 * Creates the label if it doesn't exist; updates the colour if it does.
 * Failures are swallowed — labels are non-critical.
 */
export async function ensureGitHubLabels(
  owner: string,
  repo: string,
  labels: string[],
  accessToken: string,
): Promise<void> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Veerify',
  }

  const managed = labels.filter((l) => l in LABEL_COLORS)

  await Promise.allSettled(
    managed.map(async (label) => {
      const color = LABEL_COLORS[label]!
      const base = `https://api.github.com/repos/${owner}/${repo}/labels`

      const create = await fetch(base, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: label, color }),
      })

      // 422 = label already exists — update its colour instead
      if (create.status === 422) {
        await fetch(`${base}/${encodeURIComponent(label)}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ color }),
        })
      }
    }),
  )
}
