export const selectors = {
  loginEmail: '[data-testid="login-email"]',
  loginPassword: '[data-testid="login-password"]',
  loginSubmit: '[data-testid="login-submit"]',
  loginError: '[data-testid="login-error"]',
  settingsTabProfile: '[data-testid="settings-tab-profile"]',
  settingsTabSecurity: '[data-testid="settings-tab-security"]',
  settingsTabNotifications: '[data-testid="settings-tab-notifications"]',
  settingsTabTeam: '[data-testid="settings-tab-team"]',
  settingsTabBilling: '[data-testid="settings-tab-billing"]',
  settingsTabAppearance: '[data-testid="settings-tab-appearance"]',
  settingsBillingPanel: '[data-testid="settings-billing-panel"]',
  teamTitle: '[data-testid="team-title"]',
  teamMembersCount: '[data-testid="team-members-count"]',
  teamOpenCreateDialog: '[data-testid="team-open-create-dialog"]',
  teamCreateName: '[data-testid="team-create-name"]',
  teamCreateSubmit: '[data-testid="team-create-submit"]',
  teamSwitcherTrigger: '[data-testid="team-switcher-trigger"]',
  teamSwitcherActiveName: '[data-testid="team-switcher-active-name"]',
  teamSwitcherActiveOrg: '[data-testid="team-switcher-active-org"]',
}

export const teamSwitcherItemSelector = (teamId: string) => `[data-testid="team-switcher-item-${teamId}"]`
