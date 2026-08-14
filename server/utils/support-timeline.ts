export interface ContactTimelineLink {
  entityType: string
  entityId: string
  [key: string]: unknown
}

export interface ProbableFeedback {
  id: string
  [key: string]: unknown
}

/**
 * Keep confirmed links authoritative while presenting heuristic matches as a
 * separate, suggestion-only section. A feedback item that was explicitly
 * linked must not be shown again as a probable match.
 */
export function buildContactTimeline<TLink extends ContactTimelineLink, TFeedback extends ProbableFeedback>(
  linked: TLink[],
  probableFeedback: TFeedback[]
) {
  const linkedFeedbackIds = new Set(
    linked.filter((link) => link.entityType === 'feedback').map((link) => link.entityId)
  )

  return {
    linked,
    probableFeedback: probableFeedback.filter((feedback) => !linkedFeedbackIds.has(feedback.id)),
  }
}

export function isAutoLinkEnabled(settings: { autoLinkFeedback?: boolean } | null | undefined): boolean {
  return settings?.autoLinkFeedback === true
}
