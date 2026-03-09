import type { H3Event } from 'h3'

export const GITHUB_INTEGRATION_CALLBACK_PATH = '/api/auth/callback/github/integration'

export function resolveGithubIntegrationCallbackUrl(event: H3Event) {
  return `${getRequestURL(event).origin}${GITHUB_INTEGRATION_CALLBACK_PATH}`
}
