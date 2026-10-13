import { httpError, plainText, readJson, timedFetch } from './http'
import { SocialSourceError, type SocialPost, type SocialSearchInput, type SocialSource } from './types'

// app.bsky.feed.searchPosts requires auth: the unauthenticated public AppView
// (public.api.bsky.app) answers 403 and bsky.social answers 401 without a token.
// We sign in with an app password and call the PDS, which proxies to the AppView.
// https://docs.bsky.app/docs/api/app-bsky-feed-search-posts
// https://docs.bsky.app/docs/api/com-atproto-server-create-session
const SERVICE = 'https://bsky.social'

let accessJwt: string | null = null

/** Test helper */
export function resetBlueskyState() {
  accessJwt = null
}

function credentials() {
  const identifier = process.env.BLUESKY_IDENTIFIER?.trim()
  const password = process.env.BLUESKY_APP_PASSWORD?.trim()
  return identifier && password ? { identifier, password } : null
}

function notConfigured() {
  return new SocialSourceError('bluesky', 'not_configured', 'Bluesky credentials are not configured')
}

async function createSession(signal?: AbortSignal): Promise<string> {
  const creds = credentials()
  if (!creds) throw notConfigured()
  const res = await timedFetch(
    'bluesky',
    `${SERVICE}/xrpc/com.atproto.server.createSession`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
    },
    signal
  )
  if (!res.ok) throw httpError('bluesky', res.status)
  const body = await readJson<{ accessJwt?: string }>('bluesky', res)
  if (!body.accessJwt) {
    throw new SocialSourceError('bluesky', 'auth', 'Bluesky session had no access token', 200)
  }
  accessJwt = body.accessJwt
  return accessJwt
}

interface BskyPost {
  uri: string
  author: { handle: string }
  record?: { text?: string; createdAt?: string }
  indexedAt?: string
  likeCount?: number
}

function mapPost(p: BskyPost): SocialPost | null {
  const rkey = p.uri.split('/').pop()
  const created = new Date(p.record?.createdAt ?? p.indexedAt ?? '')
  if (!rkey || Number.isNaN(created.getTime())) return null
  return {
    source: 'bluesky',
    externalId: p.uri,
    url: `https://bsky.app/profile/${p.author.handle}/post/${rkey}`,
    author: p.author.handle,
    title: null,
    text: plainText(p.record?.text),
    publishedAt: created,
    score: p.likeCount ?? null,
  }
}

export const blueskySource: SocialSource = {
  id: 'bluesky',
  label: 'Bluesky',
  isConfigured: () => credentials() !== null,
  async search({ query, since, limit, signal }: SocialSearchInput) {
    if (!credentials()) throw notConfigured()
    const params = new URLSearchParams({
      q: query.includes(' ') ? `"${query}"` : query,
      sort: 'latest',
      since: since.toISOString(),
      limit: String(Math.min(Math.max(limit, 1), 100)),
    })
    const url = `${SERVICE}/xrpc/app.bsky.feed.searchPosts?${params}`
    const call = (jwt: string) => timedFetch('bluesky', url, { headers: { Authorization: `Bearer ${jwt}` } }, signal)

    let res = await call(accessJwt ?? (await createSession(signal)))
    // Expired/invalid token (PDS answers 400 ExpiredToken or 401): sign in again once.
    if (res.status === 401 || res.status === 400) {
      const err = res.status === 400 ? await res.json().catch(() => null) : null
      if (res.status === 401 || err?.error === 'ExpiredToken') {
        res = await call(await createSession(signal))
      }
    }
    if (!res.ok) throw httpError('bluesky', res.status)
    const body = await readJson<{ posts?: BskyPost[] }>('bluesky', res)
    const sinceMs = since.getTime()
    return (body.posts ?? [])
      .map(mapPost)
      .filter((p): p is SocialPost => p !== null && p.publishedAt.getTime() >= sinceMs)
      .slice(0, limit)
  },
}
