/**
 * Detail/nested pages (e.g. /inbox/<id>, /feedback/<id>) reference records of the previous
 * organization and would 404 after a switch; top-level pages, the dashboard/settings sections and
 * the project settings page reload in place.
 */
export function shouldLeaveRouteOnOrgSwitch(path: string): boolean {
  const segments = path.split('?')[0]!.split('#')[0]!.split('/').filter(Boolean)
  if (segments.length <= 1) return false
  if (segments[0] === 'project' && segments[1] === 'settings') return false
  return !['dashboard', 'settings'].includes(segments[0]!)
}
