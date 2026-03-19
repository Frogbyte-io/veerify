import { createLogger } from '~/server/utils/logger'

const log = createLogger('env')

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()

  if (!config.uploadTokenSecret) {
    log.error('UPLOAD_TOKEN_SECRET is not set. This variable is required for signing upload tokens. Generate a random secret and add it to your .env file.')
    throw new Error('Missing required environment variable: UPLOAD_TOKEN_SECRET')
  }
})
