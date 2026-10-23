/**
 * Detail/nested pages (e.g. /support/<id>, /feedback/<id>) reference records of the previous
 * organization and would 404 after a switch; top-level pages and the dashboard/settings sections
 * reload in place.
 */
export function shouldLeaveRouteOnOrgSwitch(path: string): boolean {
  const segments = path.split('?')[0]!.split('#')[0]!.split('/').filter(Boolean)
  if (segments.length <= 1) return false
  return !['dashboard', 'settings'].includes(segments[0]!)
}
