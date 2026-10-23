import { createLogger } from '~/server/utils/logger'
import { domainProviderEnvIssues } from '~/server/services/domains/env'
import { sendingDomainEnvIssues } from '~/lib/support-sending-domains'

const log = createLogger('env')

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()

  if (!config.uploadTokenSecret) {
    log.error(
      'UPLOAD_TOKEN_SECRET is not set. This variable is required for signing upload tokens. Generate a random secret and add it to your .env file.'
    )
    throw new Error('Missing required environment variable: UPLOAD_TOKEN_SECRET')
  }

  // Custom board domains: a selected provider with missing credentials is logged, never fatal.
  for (const message of domainProviderEnvIssues(process.env, config)) {
    log.warn(message)
  }

  // Customer sending domains: misconfiguration is logged, never fatal.
  for (const issue of sendingDomainEnvIssues(process.env)) {
    if (issue.level === 'error') log.error(issue.message)
    else if (issue.level === 'warn') log.warn(issue.message)
    else log.info(issue.message)
  }
})
