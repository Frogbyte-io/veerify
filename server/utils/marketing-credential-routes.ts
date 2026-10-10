import { createError } from 'h3'
import type { H3Event } from 'h3'
import type { ApiCredentialProvider } from '~/server/database/schema/marketing'
import { isApiCredentialProvider, LLM_CREDENTIAL_PROVIDERS } from '~/server/utils/team-credentials'
import { isSecretsConfigured } from '~/server/utils/secrets'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { requireTeamAdmin, requireTeamMembership } from '~/server/utils/support-access'

export function isLlmCredentialProvider(provider: ApiCredentialProvider): boolean {
  return (LLM_CREDENTIAL_PROVIDERS as readonly string[]).includes(provider)
}

export function requireCredentialProvider(event: H3Event): ApiCredentialProvider {
  const provider = requireRouteParam(event, 'provider')
  if (!isApiCredentialProvider(provider)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, `Unknown provider: ${provider}`),
    })
  }
  return provider
}

/** Keys cannot be stored without an instance encryption key; say what to set. */
export function requireSecretsConfigured(): void {
  if (!isSecretsConfigured()) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      data: createErrorResponse(
        ErrorCode.INTERNAL_ERROR,
        'API keys cannot be stored on this installation yet. The server administrator must set SECRETS_ENCRYPTION_KEY.'
      ),
    })
  }
}

export function badRequest(message: string): never {
  throw createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    data: createErrorResponse(ErrorCode.VALIDATION_ERROR, message),
  })
}

function rewriteForbidden<T>(run: () => Promise<T>, message: string): Promise<T> {
  return run().catch((error: unknown) => {
    // support-access messages mention support inboxes; surface a marketing one
    if ((error as { statusCode?: number })?.statusCode === 403) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
        data: createErrorResponse(ErrorCode.FORBIDDEN, message),
      })
    }
    throw error
  })
}

export function requireCredentialAdmin(teamId: string, userId: string) {
  return rewriteForbidden(() => requireTeamAdmin(teamId, userId), 'Only team admins can manage marketing API keys')
}

export function requireCredentialMember(teamId: string, userId: string) {
  return rewriteForbidden(() => requireTeamMembership(teamId, userId), 'You do not have access to this team')
}
