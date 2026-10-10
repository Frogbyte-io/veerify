import type { H3Event } from 'h3'
import type { ApiCredentialProvider } from '~/server/database/schema/marketing'
import { isApiCredentialProvider, LLM_CREDENTIAL_PROVIDERS } from '~/server/utils/team-credentials'
import { isSecretsConfigured } from '~/server/utils/secrets'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { requireRouteParam } from '~/server/utils/marketing-site'

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
