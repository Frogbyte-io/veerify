// Project-wide sub-pages of the public site. Product slugs can never be one of
// these (reserved when a product is created). Mirrors pages/[...slug].vue.
export const PUBLIC_SUB_PAGES = ['roadmap', 'changelog', 'testimonials'] as const

/** Path segment of a feedback item's own page: `/<project>/p/<title-slug>-<id>` */
export const FEEDBACK_POST_SEGMENT = 'p'

export type PublicPage =
  | { kind: 'board'; productSlug: string | null }
  | { kind: 'roadmap' }
  | { kind: 'changelog'; entrySlug: string | null }
  | { kind: 'testimonials' }
  /** One feedback item; `ref` is the URL segment (`<title-slug>-<id>`, or a bare id) */
  | { kind: 'post'; ref: string }

export type ParsedPublicPath = { projectSlug: string | null; page: PublicPage } | null

/**
 * Maps a public-site pathname to the page it renders, or null for a 404.
 *
 *   org subdomain:  /<project>[/<product> | /p/<post> | /roadmap | /changelog[/<entry>] | /testimonials]
 *   custom domain:  /[<product> | /p/<post> | /roadmap | /changelog[/<entry>] | /testimonials]
 *
 * `/<project>/p` alone is still a product board (a product may be called `p`).
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
  if (first === FEEDBACK_POST_SEGMENT && rest.length === 2) {
    return { projectSlug, page: { kind: 'post', ref: rest[1]! } }
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
    case 'post':
      return `/${FEEDBACK_POST_SEGMENT}/${page.ref}`
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

const UUID_SUFFIX = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

/** Lowercase ASCII slug of a title, for readable feedback URLs. */
export function titleSlug(title: string, maxLength = 60): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, maxLength)
    .replace(/^-+|-+$/g, '')
}

/**
 * URL segment of a feedback item: `<title-slug>-<uuid>`. Ids that are not
 * UUIDs (seeded or imported data) are used bare, so parsing stays unambiguous.
 */
export function feedbackPostRef(item: { id: string; title?: string | null }): string {
  if (!UUID_SUFFIX.test(item.id) || item.id.length !== 36) return encodeURIComponent(item.id)
  const slug = titleSlug(item.title || '')
  return slug ? `${slug}-${item.id}` : item.id
}

/** Feedback id a post segment points at (the trailing UUID, else the whole segment). */
export function feedbackIdFromRef(ref: string): string {
  return UUID_SUFFIX.exec(ref)?.[1]?.toLowerCase() ?? ref
}
