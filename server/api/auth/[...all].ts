import { auth } from '~/lib/auth' // import your auth config
import { createLogger } from '~/server/utils/logger'
import {
  createDatabaseUnavailableError,
  isDatabaseConnectionError,
  summarizeDatabaseConnectionError,
} from '~/server/utils/database-errors'

const log = createLogger('auth-handler')

export default defineEventHandler(async (event) => {
  try {
    return await auth.handler(toWebRequest(event))
  } catch (error) {
    if (isDatabaseConnectionError(error)) {
      log.warn('Database unavailable while handling Better Auth request', summarizeDatabaseConnectionError(error))
      createDatabaseUnavailableError()
    }
    throw error
  }
})
