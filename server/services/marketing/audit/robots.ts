import type { CrawlerAccess } from './types'

/**
 * RFC 9309 robots.txt parsing and matching. Pure functions; callers fetch the file.
 */

export interface RobotsRule {
  allow: boolean
  pattern: string
}

export interface RobotsGroup {
  /** Lower-cased user-agent tokens */
  agents: string[]
  rules: RobotsRule[]
}

export interface ParsedRobots {
  groups: RobotsGroup[]
  sitemaps: string[]
}

export function parseRobots(robotsTxt: string): ParsedRobots {
  const groups: RobotsGroup[] = []
  const sitemaps: string[] = []
  let current: RobotsGroup | null = null
  let lastWasAgent = false

  for (const rawLine of robotsTxt.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)) {
    const line = rawLine.split('#')[0].trim()
    if (!line) continue
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const field = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()

    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
    } else if (field === 'allow' || field === 'disallow') {
      lastWasAgent = false
      // Rules before any user-agent line belong to no group and are ignored.
      current?.rules.push({ allow: field === 'allow', pattern: value })
    } else if (field === 'sitemap') {
      if (value) sitemaps.push(value)
      // Sitemap lines are global and do not end a group's agent list.
    } else {
      lastWasAgent = false
    }
  }
  return { groups, sitemaps }
}

/** Sitemap URLs declared in robots.txt. */
export function robotsSitemaps(robotsTxt: string): string[] {
  return parseRobots(robotsTxt).sitemaps
}

/** Rules that apply to a user-agent token: the matching groups, else the `*` groups. */
export function rulesForAgent(parsed: ParsedRobots, userAgentToken: string): RobotsRule[] {
  const token = userAgentToken.toLowerCase()
  const specific = parsed.groups.filter((g) => g.agents.includes(token))
  const chosen = specific.length ? specific : parsed.groups.filter((g) => g.agents.includes('*'))
  return chosen.flatMap((g) => g.rules)
}

function patternToRegExp(pattern: string): RegExp {
  let anchored = false
  let p = pattern
  if (p.endsWith('$')) {
    anchored = true
    p = p.slice(0, -1)
  }
  const body = p
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${body}${anchored ? '$' : ''}`)
}

function allowedByRules(rules: RobotsRule[], path: string): boolean {
  let best: { allow: boolean; length: number } | null = null
  for (const rule of rules) {
    // Empty Disallow means "allow everything"; empty Allow has no effect.
    if (rule.pattern === '') continue
    if (!patternToRegExp(rule.pattern).test(path)) continue
    const length = rule.pattern.length
    if (!best || length > best.length || (length === best.length && rule.allow)) {
      best = { allow: rule.allow, length }
    }
  }
  return best ? best.allow : true
}

/** Whether `userAgentToken` may fetch `path` (path plus optional query) under this robots.txt. */
export function isAllowed(robotsTxt: string, userAgentToken: string, path: string): boolean {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return allowedByRules(rulesForAgent(parseRobots(robotsTxt), userAgentToken), normalized)
}

export interface KnownCrawler {
  bot: string
  operator: string
  purpose: CrawlerAccess['purpose']
}

export const KNOWN_CRAWLERS: readonly KnownCrawler[] = [
  { bot: 'Googlebot', operator: 'Google', purpose: 'search' },
  { bot: 'Bingbot', operator: 'Microsoft', purpose: 'search' },
  { bot: 'GPTBot', operator: 'OpenAI', purpose: 'ai-training' },
  { bot: 'Google-Extended', operator: 'Google', purpose: 'ai-training' },
  { bot: 'Applebot-Extended', operator: 'Apple', purpose: 'ai-training' },
  { bot: 'CCBot', operator: 'Common Crawl', purpose: 'ai-training' },
  { bot: 'Bytespider', operator: 'ByteDance', purpose: 'ai-training' },
  { bot: 'ClaudeBot', operator: 'Anthropic', purpose: 'ai-training' },
  { bot: 'OAI-SearchBot', operator: 'OpenAI', purpose: 'ai-search' },
  { bot: 'Claude-SearchBot', operator: 'Anthropic', purpose: 'ai-search' },
  { bot: 'PerplexityBot', operator: 'Perplexity', purpose: 'ai-search' },
  { bot: 'ChatGPT-User', operator: 'OpenAI', purpose: 'ai-assistant' },
  { bot: 'Claude-User', operator: 'Anthropic', purpose: 'ai-assistant' },
  { bot: 'Perplexity-User', operator: 'Perplexity', purpose: 'ai-assistant' },
]

/**
 * Per-bot verdict for the root path. `blocked`: `/` is disallowed. `partial`: `/` is
 * allowed but the applicable group has any non-empty Disallow. A missing robots.txt
 * (null) allows everything.
 */
export function crawlerAccess(robotsTxt: string | null): CrawlerAccess[] {
  const parsed = robotsTxt === null ? null : parseRobots(robotsTxt)
  return KNOWN_CRAWLERS.map((crawler) => {
    let verdict: CrawlerAccess['verdict'] = 'allowed'
    if (parsed) {
      const rules = rulesForAgent(parsed, crawler.bot)
      if (!allowedByRules(rules, '/')) verdict = 'blocked'
      else if (rules.some((r) => !r.allow && r.pattern !== '')) verdict = 'partial'
    }
    return { ...crawler, verdict }
  })
}
