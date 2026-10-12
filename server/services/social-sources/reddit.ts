import { httpError, plainText, readJson, timedFetch } from './http'
import { SocialSourceError, type SocialPost, type SocialSearchInput, type SocialSource } from './types'

// https://github.com/reddit-archive/reddit/wiki/OAuth2 (app-only client_credentials grant)
// https://github.com/reddit-archive/reddit/wiki/API (60 req/min for OAuth clients, descriptive UA)
const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token'
const API_BASE = 'https://oauth.reddit.com'
const DEFAULT_USER_AGENT = 'veerify:marketing-mentions:1.0 (self-hosted)'
const TOKEN_SKEW_MS = 60_000

let token: { value: string; expiresAt: number } | null = null
/** Epoch ms until which Reddit asked us to stop (from X-Ratelimit-Reset when remaining hit 0). */
let blockedUntil = 0

/** Test helper */
export function resetRedditState() {
  token = null
  blockedUntil = 0
}

function credentials() {
  const id = process.env.REDDIT_CLIENT_ID?.trim()
  const secret = process.env.REDDIT_CLIENT_SECRET?.trim()
  return id && secret ? { id, secret } : null
}

function userAgent() {
  return process.env.REDDIT_USER_AGENT?.trim() || DEFAULT_USER_AGENT
}

function notConfigured() {
  return new SocialSourceError('reddit', 'not_configured', 'Reddit credentials are not configured')
}

async function getToken(signal?: AbortSignal): Promise<string> {
  if (token && token.expiresAt - TOKEN_SKEW_MS > Date.now()) return token.value
  const creds = credentials()
  if (!creds) throw notConfigured()
  const res = await timedFetch(
    'reddit',
    TOKEN_URL,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.id}:${creds.secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': userAgent(),
      },
      body: 'grant_type=client_credentials',
    },
    signal
  )
  if (!res.ok) throw httpError('reddit', res.status)
  const body = await readJson<{ access_token?: string; expires_in?: number }>('reddit', res)
  if (!body.access_token) {
    throw new SocialSourceError('reddit', 'auth', 'Reddit token response had no access token', 200)
  }
  token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 }
  return token.value
}

function timeBucket(since: Date): string {
  const age = Date.now() - since.getTime()
  const hour = 3_600_000
  if (age <= hour) return 'hour'
  if (age <= 24 * hour) return 'day'
  if (age <= 7 * 24 * hour) return 'week'
  if (age <= 31 * 24 * hour) return 'month'
  if (age <= 366 * 24 * hour) return 'year'
  return 'all'
}

interface RedditChild {
  data: {
    id: string
    name?: string
    title?: string
    selftext?: string
    author?: string
    permalink?: string
    created_utc: number
    score?: number
  }
}

export const redditSource: SocialSource = {
  id: 'reddit',
  label: 'Reddit',
  isConfigured: () => credentials() !== null,
  async search({ query, since, limit, signal }: SocialSearchInput) {
    if (!credentials()) throw notConfigured()
    if (blockedUntil > Date.now()) {
      throw new SocialSourceError('reddit', 'rate_limit', 'Reddit rate limit exhausted, retry later')
    }
    const accessToken = await getToken(signal)
    // The data API only searches posts (links); comment search is not offered.
    const params = new URLSearchParams({
      q: query.includes(' ') ? `"${query}"` : query,
      sort: 'new',
      t: timeBucket(since),
      type: 'link',
      limit: String(Math.min(Math.max(limit, 1), 100)),
      raw_json: '1',
    })
    const res = await timedFetch(
      'reddit',
      `${API_BASE}/search?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': userAgent() } },
      signal
    )

    const remaining = Number.parseFloat(res.headers.get('x-ratelimit-remaining') ?? '')
    const reset = Number.parseFloat(res.headers.get('x-ratelimit-reset') ?? '')
    if ((Number.isFinite(remaining) && remaining < 1) || res.status === 429) {
      blockedUntil = Date.now() + (Number.isFinite(reset) ? reset : 60) * 1000
    }
    if (res.status === 401) token = null
    if (!res.ok) throw httpError('reddit', res.status)

    const body = await readJson<{ data?: { children?: RedditChild[] } }>('reddit', res)
    const sinceMs = since.getTime()
    return (body.data?.children ?? [])
      .map((c) => c.data)
      .filter((d) => d.created_utc * 1000 >= sinceMs)
      .slice(0, limit)
      .map(
        (d): SocialPost => ({
          source: 'reddit',
          externalId: d.name ?? `t3_${d.id}`,
          url: `https://www.reddit.com${d.permalink ?? `/comments/${d.id}`}`,
          author: d.author && d.author !== '[deleted]' ? d.author : null,
          title: plainText(d.title) || null,
          text: plainText(d.selftext),
          publishedAt: new Date(d.created_utc * 1000),
          score: d.score ?? null,
        })
      )
  },
}
