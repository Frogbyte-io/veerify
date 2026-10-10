import { DEFAULT_TEAM_MODULES, resolveProductModules } from '~/lib/modules'

const DAY_MS = 24 * 60 * 60 * 1000

/** How long the links in a review request email keep recording clicks and accepting testimonials. */
export const REQUEST_LINK_MAX_AGE_DAYS = 60

export interface MarketingToggleInput {
  projectSettings: Record<string, unknown> | null
  /** `null` when the team never opened the Tools tab (registry default applies) */
  teamMarketingEnabled: boolean | null
}

/** Marketing must be on for both the team and the product. */
export function isMarketingOn(input: MarketingToggleInput): boolean {
  const teamOn = input.teamMarketingEnabled ?? DEFAULT_TEAM_MODULES.marketingEnabled
  return teamOn && resolveProductModules(input.projectSettings).marketingEnabled === true
}

/** True once a request link is older than `REQUEST_LINK_MAX_AGE_DAYS`, measured from when it was sent. */
export function isRequestLinkExpired(
  request: { sentAt: Date | null; createdAt: Date },
  now: Date = new Date()
): boolean {
  const issuedAt = request.sentAt ?? request.createdAt
  return now.getTime() - issuedAt.getTime() > REQUEST_LINK_MAX_AGE_DAYS * DAY_MS
}
