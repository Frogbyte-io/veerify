import type { SocialPost } from './types'

export type TermKind = 'brand' | 'competitor' | 'keyword'

export interface MatchTerm {
  id: string
  kind: TermKind
  label: string
  aliases: string[]
}

export interface TermMatch {
  termId: string
  kind: TermKind
}

const MIN_ALIAS_LENGTH = 3

function names(term: MatchTerm): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const candidates = [term.label, ...term.aliases.filter((a) => a.trim().length >= MIN_ALIAS_LENGTH)]
  for (const raw of candidates) {
    const name = raw.trim().replace(/\s+/g, ' ')
    const key = name.toLowerCase()
    if (name && !seen.has(key)) {
      seen.add(key)
      out.push(name)
    }
  }
  return out
}

function phraseRegex(name: string): RegExp {
  const body = name
    .split(' ')
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+')
  // Whole word/phrase: not glued to letters, digits or underscore. Apostrophes, hyphens and
  // punctuation count as boundaries, so "Veerify's" and "veerify-based" match.
  return new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, 'iu')
}

export function matchTerms(post: SocialPost, terms: MatchTerm[]): TermMatch[] {
  const haystack = `${post.title ?? ''}\n${post.text}`.normalize('NFC').replace(/[’‘]/g, "'")
  const matches: TermMatch[] = []
  for (const term of terms) {
    if (names(term).some((n) => phraseRegex(n.normalize('NFC')).test(haystack))) {
      matches.push({ termId: term.id, kind: term.kind })
    }
  }
  return matches
}

export function classifyMention(matches: { kind: TermKind }[]): 'mention' | 'competitor' | 'opportunity' | null {
  if (matches.some((m) => m.kind === 'brand')) return 'mention'
  if (matches.some((m) => m.kind === 'competitor')) return 'competitor'
  if (matches.some((m) => m.kind === 'keyword')) return 'opportunity'
  return null
}

/** Minimal deduplicated queries; each lists the terms that asked for it. */
export function buildQueries(terms: MatchTerm[]): { query: string; termIds: string[] }[] {
  const byKey = new Map<string, { query: string; termIds: string[] }>()
  for (const term of terms) {
    for (const name of names(term)) {
      const key = name.toLowerCase()
      const entry = byKey.get(key)
      if (!entry) byKey.set(key, { query: name, termIds: [term.id] })
      else if (!entry.termIds.includes(term.id)) entry.termIds.push(term.id)
    }
  }
  return [...byKey.values()]
}
