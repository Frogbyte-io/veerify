import { describe, expect, it } from 'vitest'

import {
  KNOWN_CRAWLERS,
  crawlerAccess,
  isAllowed,
  parseRobots,
  robotsSitemaps,
} from '~/server/services/marketing/audit/robots'

const verdictOf = (txt: string | null, bot: string) => crawlerAccess(txt).find((c) => c.bot === bot)?.verdict

describe('parseRobots', () => {
  it('groups consecutive user-agents and ignores comments and BOM', () => {
    const parsed = parseRobots(
      '﻿# top\nUser-agent: A\nUser-agent: B # both\nDisallow: /x\n\nUser-agent: *\nAllow: /\nSitemap: https://e.com/s.xml\n'
    )
    expect(parsed.groups).toHaveLength(2)
    expect(parsed.groups[0].agents).toEqual(['a', 'b'])
    expect(parsed.groups[0].rules).toEqual([{ allow: false, pattern: '/x' }])
    expect(parsed.sitemaps).toEqual(['https://e.com/s.xml'])
  })

  it('does not split a group on a Sitemap line between agents', () => {
    const parsed = parseRobots('User-agent: A\nSitemap: https://e.com/s.xml\nUser-agent: B\nDisallow: /')
    expect(parsed.groups).toHaveLength(1)
    expect(parsed.groups[0].agents).toEqual(['a', 'b'])
  })

  it('handles CRLF and exposes sitemaps', () => {
    expect(
      robotsSitemaps('User-agent: *\r\nDisallow:\r\nSitemap: https://e.com/a.xml\r\nsitemap: https://e.com/b.xml')
    ).toEqual(['https://e.com/a.xml', 'https://e.com/b.xml'])
  })
})

describe('isAllowed', () => {
  it('allows everything with empty Disallow or empty file', () => {
    expect(isAllowed('User-agent: *\nDisallow:', 'Googlebot', '/anything')).toBe(true)
    expect(isAllowed('', 'Googlebot', '/')).toBe(true)
  })

  it('blocks by prefix', () => {
    const txt = 'User-agent: *\nDisallow: /private'
    expect(isAllowed(txt, 'Googlebot', '/private')).toBe(false)
    expect(isAllowed(txt, 'Googlebot', '/private/x')).toBe(false)
    expect(isAllowed(txt, 'Googlebot', '/public')).toBe(true)
  })

  it('uses longest match, with Allow winning ties', () => {
    const txt = 'User-agent: *\nDisallow: /folder/\nAllow: /folder/open'
    expect(isAllowed(txt, 'x', '/folder/secret')).toBe(false)
    expect(isAllowed(txt, 'x', '/folder/open/page')).toBe(true)
    const tie = 'User-agent: *\nDisallow: /a\nAllow: /a'
    expect(isAllowed(tie, 'x', '/a')).toBe(true)
  })

  it('supports * and $ wildcards', () => {
    const txt = 'User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp*/cache\nAllow: /tmp-ok/cache'
    expect(isAllowed(txt, 'x', '/files/a.pdf')).toBe(false)
    expect(isAllowed(txt, 'x', '/files/a.pdf?download=1')).toBe(true)
    expect(isAllowed(txt, 'x', '/tmp123/cache')).toBe(false)
    expect(isAllowed(txt, 'x', '/tmp-ok/cache')).toBe(true)
  })

  it('escapes regex metacharacters in patterns', () => {
    expect(isAllowed('User-agent: *\nDisallow: /a.b', 'x', '/aXb')).toBe(true)
    expect(isAllowed('User-agent: *\nDisallow: /a.b', 'x', '/a.b')).toBe(false)
  })

  it('prefers the specific group over *, case-insensitively', () => {
    const txt = 'User-agent: *\nDisallow: /\n\nUser-agent: googlebot\nDisallow: /nope'
    expect(isAllowed(txt, 'Googlebot', '/')).toBe(true)
    expect(isAllowed(txt, 'Googlebot', '/nope')).toBe(false)
    expect(isAllowed(txt, 'Bingbot', '/')).toBe(false)
  })

  it('merges multiple groups for the same agent', () => {
    const txt = 'User-agent: GPTBot\nDisallow: /a\n\nUser-agent: GPTBot\nDisallow: /b'
    expect(isAllowed(txt, 'GPTBot', '/a')).toBe(false)
    expect(isAllowed(txt, 'GPTBot', '/b')).toBe(false)
    expect(isAllowed(txt, 'GPTBot', '/c')).toBe(true)
  })

  it('allows when no group matches and there is no * group', () => {
    expect(isAllowed('User-agent: Other\nDisallow: /', 'Googlebot', '/')).toBe(true)
  })

  it('ignores rules that appear before any user-agent', () => {
    expect(isAllowed('Disallow: /\nUser-agent: *\nAllow: /', 'x', '/')).toBe(true)
  })

  it('normalises paths without a leading slash', () => {
    expect(isAllowed('User-agent: *\nDisallow: /a', 'x', 'a/b')).toBe(false)
  })
})

describe('crawlerAccess', () => {
  it('lists every known crawler with operator and purpose', () => {
    const access = crawlerAccess(null)
    expect(access).toHaveLength(KNOWN_CRAWLERS.length)
    expect(access.every((a) => a.verdict === 'allowed')).toBe(true)
    expect(access.find((a) => a.bot === 'GPTBot')).toMatchObject({
      operator: 'OpenAI',
      purpose: 'ai-training',
    })
    expect(access.find((a) => a.bot === 'ClaudeBot')).toMatchObject({
      operator: 'Anthropic',
      purpose: 'ai-training',
    })
    expect(access.find((a) => a.bot === 'Claude-User')?.purpose).toBe('ai-assistant')
    expect(access.find((a) => a.bot === 'OAI-SearchBot')?.purpose).toBe('ai-search')
    expect(access.find((a) => a.bot === 'Googlebot')?.purpose).toBe('search')
  })

  it('treats a permissive robots.txt as allowed', () => {
    expect(verdictOf('User-agent: *\nDisallow:', 'GPTBot')).toBe('allowed')
  })

  it('reports blocked, partial and allowed per bot', () => {
    const txt = [
      'User-agent: GPTBot',
      'Disallow: /',
      '',
      'User-agent: CCBot',
      'User-agent: ClaudeBot',
      'Disallow: /private/',
      '',
      'User-agent: *',
      'Disallow:',
    ].join('\n')
    expect(verdictOf(txt, 'GPTBot')).toBe('blocked')
    expect(verdictOf(txt, 'CCBot')).toBe('partial')
    expect(verdictOf(txt, 'ClaudeBot')).toBe('partial')
    expect(verdictOf(txt, 'PerplexityBot')).toBe('allowed')
  })

  it('applies a wildcard Disallow: / to every bot', () => {
    for (const a of crawlerAccess('User-agent: *\nDisallow: /')) expect(a.verdict).toBe('blocked')
  })

  it('lets a specific Allow: / override a wildcard block', () => {
    const txt = 'User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /'
    expect(verdictOf(txt, 'Googlebot')).toBe('allowed')
    expect(verdictOf(txt, 'Bingbot')).toBe('blocked')
  })

  it('treats "Disallow: /" with a longer Allow: / as allowed-but-partial', () => {
    const txt = 'User-agent: *\nDisallow: /\nAllow: /$'
    expect(verdictOf(txt, 'GPTBot')).toBe('partial')
  })
})
