import { blueskySource } from './bluesky'
import { hackerNewsSource } from './hackernews'
import { redditSource } from './reddit'
import type { SocialSource, SocialSourceId } from './types'

export const SOCIAL_SOURCES: SocialSource[] = [hackerNewsSource, redditSource, blueskySource]

export function getSocialSource(id: SocialSourceId): SocialSource | undefined {
  return SOCIAL_SOURCES.find((s) => s.id === id)
}

export * from './types'
export * from './match'
