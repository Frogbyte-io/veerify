type FeedbackMetadata = Record<string, unknown> | null | undefined

/**
 * `metadata.client` (app version / OS) is only meant for team members.
 * Everything else in metadata (feedbackType, ...) stays visible to non-team viewers.
 */
export function redactClientMetadata<T extends FeedbackMetadata>(metadata: T, isTeamMember: boolean): T {
  if (isTeamMember || !metadata || !('client' in metadata)) return metadata
  const rest = { ...metadata }
  delete rest.client
  return rest as T
}

/** `apiKeyId` is internal bookkeeping; only team members may see it. */
export function stripApiKeyId<T extends { apiKeyId?: unknown }>(row: T, isTeamMember: boolean): T {
  if (isTeamMember || !('apiKeyId' in row)) return row
  const rest = { ...row }
  delete rest.apiKeyId
  return rest
}
