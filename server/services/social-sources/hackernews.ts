import { htmlToText, httpError, plainText, readJson, timedFetch } from './http'
import type { SocialPost, SocialSearchInput, SocialSource } from './types'

// https://hn.algolia.com/api (no auth; public, rate limited per IP)
const ENDPOINT = 'https://hn.algolia.com/api/v1/search_by_date'

interface HnHit {
  objectID: string
  author?: string | null
  title?: string | null
  story_text?: string | null
  comment_text?: string | null
  created_at_i: number
  points?: number | null
  _tags?: string[]
}

function mapHit(hit: HnHit): SocialPost {
  const isComment = hit._tags?.includes('comment') ?? hit.comment_text != null
  return {
    source: 'hackernews',
    externalId: hit.objectID,
    url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    author: hit.author ?? null,
    title: isComment ? null : plainText(hit.title) || null,
    text: htmlToText(isComment ? hit.comment_text : hit.story_text),
    publishedAt: new Date(hit.created_at_i * 1000),
    score: isComment ? null : (hit.points ?? null),
  }
}

export const hackerNewsSource: SocialSource = {
  id: 'hackernews',
  label: 'Hacker News',
  isConfigured: () => true,
  async search({ query, since, limit, signal }: SocialSearchInput) {
    const params = new URLSearchParams({
      query: query.includes(' ') ? `"${query}"` : query,
      tags: '(story,comment)',
      numericFilters: `created_at_i>=${Math.floor(since.getTime() / 1000)}`,
      hitsPerPage: String(Math.min(Math.max(limit, 1), 100)),
    })
    const res = await timedFetch(
      'hackernews',
      `${ENDPOINT}?${params}`,
      { headers: { Accept: 'application/json' } },
      signal
    )
    if (!res.ok) throw httpError('hackernews', res.status)
    const body = await readJson<{ hits?: HnHit[] }>('hackernews', res)
    return (body.hits ?? []).slice(0, limit).map(mapHit)
  },
}
