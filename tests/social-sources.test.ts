import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { blueskySource, resetBlueskyState } from '../server/services/social-sources/bluesky'
import { hackerNewsSource } from '../server/services/social-sources/hackernews'
import { getSocialSource, SOCIAL_SOURCES } from '../server/services/social-sources'
import { redditSource, resetRedditState } from '../server/services/social-sources/reddit'
import { SocialSourceError } from '../server/services/social-sources/types'

const fetchMock = vi.fn()
const since = new Date(Date.now() - 2 * 24 * 3600 * 1000)

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

async function kindOf(p: Promise<unknown>) {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(SocialSourceError)
    return (e as SocialSourceError).kind
  }
  return null
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('REDDIT_CLIENT_ID', '')
  vi.stubEnv('REDDIT_CLIENT_SECRET', '')
  vi.stubEnv('REDDIT_USER_AGENT', '')
  vi.stubEnv('BLUESKY_IDENTIFIER', '')
  vi.stubEnv('BLUESKY_APP_PASSWORD', '')
  resetRedditState()
  resetBlueskyState()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('registry', () => {
  it('lists all adapters', () => {
    expect(SOCIAL_SOURCES.map((s) => s.id)).toEqual(['hackernews', 'reddit', 'bluesky'])
    expect(getSocialSource('reddit')).toBe(redditSource)
  })
})

describe('hackernews', () => {
  it('maps stories and comments, strips HTML, builds filters', async () => {
    fetchMock.mockResolvedValue(
      json({
        hits: [
          {
            objectID: '10',
            author: 'a',
            title: 'Show HN: Veerify &amp; co',
            story_text: null,
            created_at_i: 1760000000,
            points: 42,
            _tags: ['story'],
          },
          {
            objectID: '11',
            author: 'b',
            comment_text: 'Hi<p>I use <a href="x">Veerify</a> &#x27;a&#x27; &lt;3 &amp; more',
            created_at_i: 1760000100,
            points: null,
            _tags: ['comment'],
          },
        ],
      })
    )
    const posts = await hackerNewsSource.search({ query: 'feedback tool', since, limit: 20 })
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.pathname).toBe('/api/v1/search_by_date')
    expect(url.searchParams.get('query')).toBe('"feedback tool"')
    expect(url.searchParams.get('tags')).toBe('(story,comment)')
    expect(url.searchParams.get('numericFilters')).toBe(`created_at_i>=${Math.floor(since.getTime() / 1000)}`)
    expect(posts[0]).toMatchObject({
      externalId: '10',
      url: 'https://news.ycombinator.com/item?id=10',
      title: 'Show HN: Veerify & co',
      score: 42,
    })
    expect(posts[1].title).toBeNull()
    expect(posts[1].text).toBe("Hi\nI use Veerify 'a' <3 & more")
    expect(hackerNewsSource.isConfigured()).toBe(true)
  })

  it('truncates text to 2000 chars', async () => {
    fetchMock.mockResolvedValue(
      json({
        hits: [{ objectID: '1', comment_text: 'x'.repeat(5000), created_at_i: 1, _tags: ['comment'] }],
      })
    )
    const [p] = await hackerNewsSource.search({ query: 'x', since, limit: 5 })
    expect(p.text).toHaveLength(2000)
  })

  it('maps errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429 }))
    expect(await kindOf(hackerNewsSource.search({ query: 'x', since, limit: 5 }))).toBe('rate_limit')
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }))
    expect(await kindOf(hackerNewsSource.search({ query: 'x', since, limit: 5 }))).toBe('server')
    fetchMock.mockRejectedValueOnce(new TypeError('boom'))
    expect(await kindOf(hackerNewsSource.search({ query: 'x', since, limit: 5 }))).toBe('network')
  })

  it('reports timeout when the request is aborted by the timeout signal', async () => {
    const ctl = new AbortController()
    ctl.abort()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(ctl.signal)
    fetchMock.mockRejectedValue(new DOMException('x', 'TimeoutError'))
    expect(await kindOf(hackerNewsSource.search({ query: 'x', since, limit: 5 }))).toBe('timeout')
    vi.restoreAllMocks()
  })
})

describe('reddit', () => {
  const children = (created: number) => ({
    data: {
      children: [
        {
          data: {
            id: 'abc',
            name: 't3_abc',
            title: 'Looking for a feedback tool',
            selftext: 'any &amp; all',
            author: 'bob',
            permalink: '/r/saas/comments/abc/x/',
            created_utc: created,
            score: 7,
          },
        },
        {
          data: { id: 'old', title: 'old', created_utc: 1, score: 1, permalink: '/r/x/comments/old/' },
        },
      ],
    },
  })

  it('is unconfigured without credentials and throws not_configured', async () => {
    expect(redditSource.isConfigured()).toBe(false)
    expect(await kindOf(redditSource.search({ query: 'x', since, limit: 5 }))).toBe('not_configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches a token once, caches it, sends UA, filters by since', async () => {
    vi.stubEnv('REDDIT_CLIENT_ID', 'id')
    vi.stubEnv('REDDIT_CLIENT_SECRET', 'secret')
    expect(redditSource.isConfigured()).toBe(true)
    const created = Math.floor(Date.now() / 1000) - 3600
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('access_token')
        ? json({ access_token: 'tok', expires_in: 86400 })
        : json(children(created), { headers: { 'x-ratelimit-remaining': '50', 'x-ratelimit-reset': '30' } })
    )
    const posts = await redditSource.search({ query: 'feedback tool', since, limit: 10 })
    await redditSource.search({ query: 'other', since, limit: 10 })
    const tokenCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('access_token'))
    expect(tokenCalls).toHaveLength(1)
    expect(tokenCalls[0][1].headers.Authorization).toBe(`Basic ${Buffer.from('id:secret').toString('base64')}`)
    expect(tokenCalls[0][1].headers['User-Agent']).toBe('veerify:marketing-mentions:1.0 (self-hosted)')
    const searchCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/search'))!
    expect(searchCall[1].headers.Authorization).toBe('Bearer tok')
    const u = new URL(searchCall[0])
    expect(u.host).toBe('oauth.reddit.com')
    expect(u.searchParams.get('sort')).toBe('new')
    expect(u.searchParams.get('t')).toBe('week')
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({
      externalId: 't3_abc',
      url: 'https://www.reddit.com/r/saas/comments/abc/x/',
      text: 'any & all',
      score: 7,
    })
  })

  it('uses REDDIT_USER_AGENT when set', async () => {
    vi.stubEnv('REDDIT_CLIENT_ID', 'id')
    vi.stubEnv('REDDIT_CLIENT_SECRET', 'secret')
    vi.stubEnv('REDDIT_USER_AGENT', 'custom:ua:1 (by /u/me)')
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('access_token') ? json({ access_token: 't', expires_in: 3600 }) : json({ data: { children: [] } })
    )
    await redditSource.search({ query: 'x', since, limit: 5 })
    expect(fetchMock.mock.calls[1][1].headers['User-Agent']).toBe('custom:ua:1 (by /u/me)')
  })

  it('stops with rate_limit once remaining is exhausted', async () => {
    vi.stubEnv('REDDIT_CLIENT_ID', 'id')
    vi.stubEnv('REDDIT_CLIENT_SECRET', 'secret')
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('access_token')
        ? json({ access_token: 't', expires_in: 3600 })
        : json({ data: { children: [] } }, { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '120' } })
    )
    await redditSource.search({ query: 'x', since, limit: 5 })
    const calls = fetchMock.mock.calls.length
    expect(await kindOf(redditSource.search({ query: 'y', since, limit: 5 }))).toBe('rate_limit')
    expect(fetchMock.mock.calls.length).toBe(calls)
  })

  it('maps token auth failure', async () => {
    vi.stubEnv('REDDIT_CLIENT_ID', 'id')
    vi.stubEnv('REDDIT_CLIENT_SECRET', 'secret')
    fetchMock.mockResolvedValue(new Response('', { status: 401 }))
    expect(await kindOf(redditSource.search({ query: 'x', since, limit: 5 }))).toBe('auth')
  })
})

describe('bluesky', () => {
  const posts = {
    posts: [
      {
        uri: 'at://did:plc:abc/app.bsky.feed.post/3kxyz',
        author: { handle: 'alice.bsky.social' },
        record: { text: 'Veerify rocks', createdAt: new Date().toISOString() },
        likeCount: 3,
      },
      {
        uri: 'at://did:plc:abc/app.bsky.feed.post/old',
        author: { handle: 'alice.bsky.social' },
        record: { text: 'old', createdAt: '2020-01-01T00:00:00Z' },
      },
    ],
  }

  it('is unconfigured without credentials', async () => {
    expect(blueskySource.isConfigured()).toBe(false)
    expect(await kindOf(blueskySource.search({ query: 'x', since, limit: 5 }))).toBe('not_configured')
  })

  it('signs in, caches the session, maps posts', async () => {
    vi.stubEnv('BLUESKY_IDENTIFIER', 'me.bsky.social')
    vi.stubEnv('BLUESKY_APP_PASSWORD', 'pw')
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('createSession') ? json({ accessJwt: 'jwt1' }) : json(posts)
    )
    const res = await blueskySource.search({ query: 'veerify', since, limit: 10 })
    await blueskySource.search({ query: 'veerify', since, limit: 10 })
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('createSession'))).toHaveLength(1)
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('searchPosts'))!
    expect(call[1].headers.Authorization).toBe('Bearer jwt1')
    expect(new URL(call[0]).searchParams.get('since')).toBe(since.toISOString())
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({
      url: 'https://bsky.app/profile/alice.bsky.social/post/3kxyz',
      author: 'alice.bsky.social',
      title: null,
      score: 3,
    })
  })

  it('re-authenticates once on an expired token', async () => {
    vi.stubEnv('BLUESKY_IDENTIFIER', 'me')
    vi.stubEnv('BLUESKY_APP_PASSWORD', 'pw')
    let session = 0
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes('createSession')) return json({ accessJwt: `jwt${++session}` })
      const auth = (init.headers as Record<string, string>).Authorization
      return auth === 'Bearer jwt1' ? json({ error: 'ExpiredToken' }, { status: 400 }) : json(posts)
    })
    const res = await blueskySource.search({ query: 'veerify', since, limit: 10 })
    expect(res).toHaveLength(1)
    expect(session).toBe(2)
  })

  it('maps bad credentials to auth', async () => {
    vi.stubEnv('BLUESKY_IDENTIFIER', 'me')
    vi.stubEnv('BLUESKY_APP_PASSWORD', 'bad')
    fetchMock.mockResolvedValue(new Response('', { status: 401 }))
    expect(await kindOf(blueskySource.search({ query: 'x', since, limit: 5 }))).toBe('auth')
  })
})
