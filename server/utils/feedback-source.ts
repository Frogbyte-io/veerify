type FeedbackMetadata = Record<string, unknown> | null | undefined

/**
 * `metadata.client` (app version / OS) is only meant for project members.
 * Everything else in metadata (feedbackType, ...) stays visible to viewers without project access.
 */
export function redactClientMetadata<T extends FeedbackMetadata>(metadata: T, isProjectMember: boolean): T {
  if (isProjectMember || !metadata || !('client' in metadata)) return metadata
  const rest = { ...metadata }
  delete rest.client
  return rest as T
}

/** `apiKeyId` is internal bookkeeping; only project members may see it. */
export function stripApiKeyId<T extends { apiKeyId?: unknown }>(row: T, isProjectMember: boolean): T {
  if (isProjectMember || !('apiKeyId' in row)) return row
  const rest = { ...row }
  delete rest.apiKeyId
  return rest
}
