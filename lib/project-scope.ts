/**
 * Client helpers for All projects (see docs/plans/2026-11-01-all-projects-view/sketch.html).
 *
 * In All projects the dashboard combines every project the user can open. Pages narrow it with the
 * project filter chips (`ProjectScopeChips`): the selection lives in the URL as `?projects=id1,id2`
 * and is remembered per page, so it survives navigation. An empty selection means every project.
 */
import type { ActiveProjectContext, ScopeProject } from '~/lib/active-project'
import { MODULE_KEYS, type ModuleKey, type ModuleSettings } from '~/lib/modules'

export function isAllProjects(context: ActiveProjectContext | null | undefined): boolean {
  return context?.scope === 'all'
}

/** The projects the page works in: every accessible project in All projects, else the active one. */
export function scopeProjects(context: ActiveProjectContext | null | undefined): ScopeProject[] {
  if (!context) return []
  const projects = context.projects ?? []
  if (isAllProjects(context)) return projects
  const active = projects.find((p) => p.id === context.project.id)
  return active ? [active] : []
}

/** Scope projects with a tool switched on. */
export function scopeProjectsWithModule(
  context: ActiveProjectContext | null | undefined,
  module: ModuleKey
): ScopeProject[] {
  return scopeProjects(context).filter((p) => p.modules?.[module])
}

/** Tool switches for the sidebar: in All projects a tool is on when any project has it on. */
export function scopeModules(context: ActiveProjectContext | null | undefined): Partial<ModuleSettings> {
  if (!context) return {}
  if (!isAllProjects(context)) return context.modules || {}
  const union: Partial<ModuleSettings> = {}
  for (const key of MODULE_KEYS) union[key] = (context.projects ?? []).some((p) => p.modules?.[key])
  return union
}

export function findScopeProject(
  context: ActiveProjectContext | null | undefined,
  projectId: string | null | undefined
): ScopeProject | null {
  if (!context || !projectId) return null
  return (context.projects ?? []).find((p) => p.id === projectId) ?? null
}

/** Parse `?projects=` (comma-separated ids). */
export function parseProjectFilter(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : ''
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

/** The `projects` query value for API calls and the URL; undefined for "every project". */
export function projectFilterParam(ids: string[]): string | undefined {
  return ids.length > 0 ? ids.join(',') : undefined
}

const FILTER_STORAGE_PREFIX = 'veerify:project-filter:'

export function readRememberedProjectFilter(page: string, organizationId: string | undefined): string[] {
  if (!import.meta.client || !organizationId) return []
  try {
    return parseProjectFilter(window.localStorage.getItem(`${FILTER_STORAGE_PREFIX}${organizationId}:${page}`))
  } catch {
    return []
  }
}

export function rememberProjectFilter(page: string, organizationId: string | undefined, ids: string[]) {
  if (!import.meta.client || !organizationId) return
  try {
    const key = `${FILTER_STORAGE_PREFIX}${organizationId}:${page}`
    if (ids.length > 0) window.localStorage.setItem(key, ids.join(','))
    else window.localStorage.removeItem(key)
  } catch {
    // Storage unavailable: the filter is only a convenience.
  }
}

/**
 * Pages that only make sense for one project: Marketing, project settings, inbox settings and
 * contacts. The sidebar hides them in All projects; switching to All projects leaves them.
 */
export function isProjectOnlyRoute(path: string): boolean {
  const clean = path.split('?')[0]!.split('#')[0]!
  return ['/marketing', '/project/settings', '/inbox/settings', '/inbox/contacts'].some(
    (base) => clean === base || clean.startsWith(`${base}/`)
  )
}

/** Alt+0 = All projects, Alt+1…9 = the nth project (Ctrl/⌘+digit is taken by the browser's tabs). */
export function projectShortcutIndex(event: KeyboardEvent): number | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null
  // Alt+digit types characters on some layouts (macOS Option); never take it from a field.
  const target = event.target as { tagName?: string; isContentEditable?: boolean } | null
  if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return null
  const match = /^Digit([0-9])$/.exec(event.code)
  return match ? Number(match[1]) : null
}
