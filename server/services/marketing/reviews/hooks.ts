import { createLogger } from '~/server/utils/logger'
import { enqueueForCsatResponse, enqueueForFeedbackStatus } from './service'

const logger = createLogger('marketing-reviews-hooks')

/**
 * Host-flow hooks. Each one swallows every error: Marketing must never be able
 * to break a CSAT submission or a feedback status change.
 */
export async function onCsatRatingRecorded(responseId: string): Promise<void> {
  try {
    await enqueueForCsatResponse(responseId)
  } catch (error) {
    logger.error('CSAT review request hook failed', {
      responseId,
      error: error instanceof Error ? error.message : 'unknown',
    })
  }
}

export async function onFeedbackStatusChanged(feedbackId: string): Promise<void> {
  try {
    await enqueueForFeedbackStatus(feedbackId)
  } catch (error) {
    logger.error('Shipped review request hook failed', {
      feedbackId,
      error: error instanceof Error ? error.message : 'unknown',
    })
  }
}
