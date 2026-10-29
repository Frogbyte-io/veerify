/** Pure helpers for the public project shell (PublicProjectShell.vue). */

import { FEEDBACK_POST_SEGMENT, feedbackPostRef } from './public-site-path'

export interface ProjectPaths {
  feedback: string
  roadmap: string
  changelog: string
  testimonials: string
  /** `/<project>/<product>` (custom domain: `/<product>`) */
  // eslint-disable-next-line no-unused-vars
  product: (productSlug: string) => string
  /** A feedback item's own page: `/<project>/p/<title-slug>-<id>` (custom domain: `/p/...`) */
  // eslint-disable-next-line no-unused-vars
  post: (item: { id: string; title?: string | null }) => string
}

/**
 * Tab links of a project's public site. Custom domains address sub-pages
 * without the project slug (`/changelog`, `/<product>`), workspace subdomains
 * with it (`/<project>/changelog`, `/<project>/<product>`).
 */
export function projectPaths(projectSlug: string, onCustomDomain: boolean): ProjectPaths {
  const base = onCustomDomain ? '' : `/${projectSlug}`
  return {
    feedback: base || '/',
    roadmap: `${base}/roadmap`,
    changelog: `${base}/changelog`,
    testimonials: `${base}/testimonials`,
    product: (productSlug: string) => `${base}/${productSlug}`,
    post: (item) => `${base}/${FEEDBACK_POST_SEGMENT}/${feedbackPostRef(item)}`,
  }
}

const TAB_LABELS: Record<string, string> = {
  feedback: 'Feedback',
  roadmap: 'Roadmap',
  changelog: 'Changelog',
  testimonials: 'Testimonials',
}

/** `<entry> · Changelog · <project>`, omitting what is not known yet. */
export function shellTitle(active: string, projectName?: string | null, pageTitle?: string | null): string {
  return [pageTitle, TAB_LABELS[active] ?? active, projectName].filter(Boolean).join(' · ')
}
