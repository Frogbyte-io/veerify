/**
 * Social source contract, shared by marketing mentions (Stage M4) and the
 * planned support social channel (support Stage 12).
 */

export type SocialSourceId = 'hackernews' | 'reddit' | 'bluesky'

export interface SocialPost {
  source: SocialSourceId
  /** Stable id within the source, used for de-duplication */
  externalId: string
  url: string
  author: string | null
  /** Title for top-level posts (HN story, Reddit post); null for comments/skeets */
  title: string | null
  /** Plain text body, HTML stripped, truncated to 2000 characters */
  text: string
  publishedAt: Date
  /** Engagement signal for sorting: points/upvotes/likes when the source reports it */
  score: number | null
}

export interface SocialSearchInput {
  /** Single term or phrase; adapters quote multi-word phrases as the source requires */
  query: string
  /** Only posts published at or after this time */
  since: Date
  limit: number
  signal?: AbortSignal
}

export class SocialSourceError extends Error {
  constructor(
    readonly source: SocialSourceId,
    readonly kind: 'auth' | 'rate_limit' | 'server' | 'network' | 'timeout' | 'not_configured',
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'SocialSourceError'
  }
}

export interface SocialSource {
  id: SocialSourceId
  label: string
  /** False when the install lacks required instance credentials (e.g. Reddit OAuth app) */
  isConfigured(): boolean
  search(input: SocialSearchInput): Promise<SocialPost[]>
}
