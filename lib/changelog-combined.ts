/**
 * Pure helpers for the combined changelog in All projects: which project "New entry" defaults to, and the
 * client-side memory of the last one used (per workspace).
 */

const LAST_PROJECT_PREFIX = 'veerify:changelog-last-project:'

/** Default project for a new entry: the last one used, else the active (last single) project, else the first. */
export function pickNewEntryProject<P extends { id: string }>(
  candidates: P[],
  lastUsedId: string | null | undefined,
  activeId: string | null | undefined
): P | null {
  return (
    candidates.find((p) => p.id === lastUsedId) ?? candidates.find((p) => p.id === activeId) ?? candidates[0] ?? null
  )
}

export function readLastChangelogProject(organizationId: string | undefined): string | null {
  if (!import.meta.client || !organizationId) return null
  try {
    return window.localStorage.getItem(`${LAST_PROJECT_PREFIX}${organizationId}`) || null
  } catch {
    return null
  }
}

export function rememberLastChangelogProject(organizationId: string | undefined, projectId: string) {
  if (!import.meta.client || !organizationId) return
  try {
    window.localStorage.setItem(`${LAST_PROJECT_PREFIX}${organizationId}`, projectId)
  } catch {
    // Storage unavailable: the default is only a convenience.
  }
}

/** Link to an entry's editor. The project is named in the URL so the editor works in any scoped project. */
export function changelogEntryPath(entryId: string, projectId?: string | null): string {
  const base = `/dashboard/changelog/${entryId}`
  return projectId ? `${base}?project=${encodeURIComponent(projectId)}` : base
}
