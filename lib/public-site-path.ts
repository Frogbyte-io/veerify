// Project-wide sub-pages of the public site. Product slugs can never be one of
// these (reserved when a product is created). Mirrors pages/[...slug].vue.
export const PUBLIC_SUB_PAGES = ['roadmap', 'changelog', 'testimonials'] as const

export type PublicPage =
  | { kind: 'board'; productSlug: string | null }
  | { kind: 'roadmap' }
  | { kind: 'changelog'; entrySlug: string | null }
  | { kind: 'testimonials' }

export type ParsedPublicPath = { projectSlug: string | null; page: PublicPage } | null

/**
 * Maps a public-site pathname to the page it renders, or null for a 404.
 *
 *   org subdomain:  /<project>[/<product> | /roadmap | /changelog[/<entry>] | /testimonials]
 *   custom domain:  /[<product> | /roadmap | /changelog[/<entry>] | /testimonials]
 *
 * `/` on an org subdomain lists the workspace's projects: `{ projectSlug: null }`.
 */
export function parsePublicPath(pathname: string, onCustomDomain: boolean): ParsedPublicPath {
  const parts = pathname
    .split('?')[0]!
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })

  let projectSlug: string | null = null
  let rest = parts
  if (!onCustomDomain) {
    if (parts.length === 0) return { projectSlug: null, page: { kind: 'board', productSlug: null } }
    projectSlug = parts[0]!
    rest = parts.slice(1)
  }

  const first = rest[0] ?? null
  if (first === 'changelog') {
    if (rest.length > 2) return null
    return { projectSlug, page: { kind: 'changelog', entrySlug: rest[1] ?? null } }
  }
  if (rest.length > 1) return null
  if (first === 'roadmap') return { projectSlug, page: { kind: 'roadmap' } }
  if (first === 'testimonials') return { projectSlug, page: { kind: 'testimonials' } }
  return { projectSlug, page: { kind: 'board', productSlug: first } }
}

/** Path of a page relative to the project's board URL (no leading slash for the board itself). */
export function publicPagePath(page: PublicPage): string {
  switch (page.kind) {
    case 'board':
      return page.productSlug ? `/${page.productSlug}` : ''
    case 'roadmap':
      return '/roadmap'
    case 'changelog':
      return page.entrySlug ? `/changelog/${page.entrySlug}` : '/changelog'
    case 'testimonials':
      return '/testimonials'
  }
}

/**
 * The page path a `.md` twin URL stands for (`/roadmap.md` → `/roadmap`,
 * `/index.md` → `/`, `/acme/index.md` → `/acme`), or null for any other path.
 */
export function markdownTwinPath(pathname: string): string | null {
  if (!pathname.endsWith('.md')) return null
  const path = pathname.slice(0, -'.md'.length)
  if (path === '/index') return '/'
  return path.endsWith('/index') ? path.slice(0, -'/index'.length) : path
}
