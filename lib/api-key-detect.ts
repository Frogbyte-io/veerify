/**
 * Guesses which provider an API key belongs to from its prefix, so a pasted key can be filed under
 * the right provider. Returns every plausible provider, most likely first: Google issues the same
 * `AIza…` keys for Gemini and PageSpeed, so those are ambiguous and the user picks.
 */
export type DetectableProvider = 'anthropic' | 'openai' | 'gemini' | 'perplexity' | 'firecrawl' | 'pagespeed'

const RULES: Array<{ test: RegExp; providers: DetectableProvider[] }> = [
  { test: /^sk-ant-/, providers: ['anthropic'] },
  { test: /^pplx-/, providers: ['perplexity'] },
  { test: /^fc-/, providers: ['firecrawl'] },
  { test: /^AIza[0-9A-Za-z_-]{20,}$/, providers: ['gemini', 'pagespeed'] },
  // OpenAI project, service-account and legacy user keys; checked after `sk-ant-`
  { test: /^sk-(proj-|svcacct-|admin-)?[0-9A-Za-z_-]{20,}$/, providers: ['openai'] },
]

export function detectKeyProviders(rawKey: string): DetectableProvider[] {
  const key = String(rawKey || '').trim()
  if (!key) return []
  return RULES.find((rule) => rule.test.test(key))?.providers ?? []
}

/** Where to create a key for each provider (opened in a new tab). */
export const PROVIDER_KEY_LINKS: Record<DetectableProvider, { url: string; steps: string }> = {
  anthropic: {
    url: 'https://platform.claude.com/settings/keys',
    steps: 'Sign in, choose Create Key, copy it and paste it here.',
  },
  openai: {
    url: 'https://platform.openai.com/api-keys',
    steps: 'Sign in, choose Create new secret key, copy it and paste it here.',
  },
  gemini: {
    url: 'https://aistudio.google.com/app/apikey',
    steps: 'Sign in with Google, choose Create API key, copy it and paste it here.',
  },
  perplexity: {
    url: 'https://console.perplexity.ai/',
    steps: 'Sign in, open API keys, create a key, copy it and paste it here.',
  },
  firecrawl: {
    url: 'https://www.firecrawl.dev/app/api-keys',
    steps: 'Sign in, copy your API key and paste it here.',
  },
  pagespeed: {
    url: 'https://developers.google.com/speed/docs/insights/v5/get-started',
    steps: 'Choose Get a Key, pick a Google Cloud project, copy the key and paste it here.',
  },
}
