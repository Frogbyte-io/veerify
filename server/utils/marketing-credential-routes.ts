import { createError } from 'h3'
import type { H3Event } from 'h3'
import type { ApiCredentialProvider } from '~/server/database/schema/marketing'
import { isApiCredentialProvider, LLM_CREDENTIAL_PROVIDERS } from '~/server/utils/org-credentials'
import { isSecretsConfigured } from '~/server/utils/secrets'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { requireOrganizationAdmin, requireOrganizationMember } from '~/server/utils/project-access'

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
    // project-access messages are generic; surface a marketing one
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

/** Workspace owners and admins manage API keys, budgets, consent and erasure. */
export function requireCredentialAdmin(organizationId: string, userId: string) {
  return rewriteForbidden(
    () => requireOrganizationAdmin(organizationId, userId),
    'Only workspace owners and admins can manage marketing API keys'
  )
}

/** Any workspace member can read keys' hints and status. */
export function requireCredentialMember(organizationId: string, userId: string) {
  return rewriteForbidden(
    () => requireOrganizationMember(organizationId, userId),
    'You do not have access to this workspace'
  )
}
