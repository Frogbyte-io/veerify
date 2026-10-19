/** Pure helpers for the public project shell (PublicProjectShell.vue). */

export interface ProjectPaths {
  feedback: string
  roadmap: string
  changelog: string
  testimonials: string
}

/**
 * Tab links of a product's public site. Custom domains address sub-pages
 * without the product slug (`/changelog`), team subdomains with it
 * (`/<product>/changelog`).
 */
export function projectPaths(projectSlug: string, onCustomDomain: boolean): ProjectPaths {
  const base = onCustomDomain ? '' : `/${projectSlug}`
  return {
    feedback: base || '/',
    roadmap: `${base}/roadmap`,
    changelog: `${base}/changelog`,
    testimonials: `${base}/testimonials`,
  }
}

const TAB_LABELS: Record<string, string> = { changelog: 'Changelog', testimonials: 'Testimonials' }

/** `<entry> · Changelog · <product>`, omitting what is not known yet. */
export function shellTitle(active: string, projectName?: string | null, pageTitle?: string | null): string {
  return [pageTitle, TAB_LABELS[active] ?? active, projectName].filter(Boolean).join(' · ')
}
