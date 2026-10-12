export const DEFAULT_TEAM_NAME = 'Default'

export type SwitchableTeam = { id: string; name: string; organizationId: string }

/**
 * Choose the team to activate after switching to an organization.
 * `teams` are the teams the user belongs to (any org); only those in `organizationId` qualify.
 * Order of preference: the hinted (last used) team, the org's `Default` team, then the first team
 * (callers pass teams oldest-first, matching the "primary workspace" ordering).
 */
export function pickTeamForOrganization<T extends SwitchableTeam>(
  teams: T[],
  organizationId: string,
  preferredTeamId?: string | null
): T | null {
  const candidates = teams.filter((t) => t.organizationId === organizationId)
  if (candidates.length === 0) return null
  return (
    (preferredTeamId ? candidates.find((t) => t.id === preferredTeamId) : undefined) ||
    candidates.find((t) => t.name === DEFAULT_TEAM_NAME) ||
    candidates[0]!
  )
}

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
