/**
 * Single registry of Veerify modules (tools).
 *
 * Team-level enablement lives in `team_module_settings`, one boolean column per
 * module; product-level enablement lives in `project.settings` under the same
 * key. A module shows for a product only when both are on (delta D-31).
 *
 * Adding a module: add an entry here and a matching boolean column to
 * `teamModuleSettings` in `server/database/schema/teams.ts` (then
 * `yarn db:generate`). `teamDefault` must equal the column default — a team
 * that has never opened the Tools tab has no row and must read identically to
 * one that has.
 */

export interface ProductToggle {
  /** Label in the product Features tab and its disable dialog */
  label: string
  /** Description under the label in the product Features tab */
  description: string
  /** What the disable dialog says is hidden, e.g. "roadmap data" */
  dataLabel: string
  /** Value when `project.settings[key]` is unset */
  default: boolean
}

export interface VeerifyModule {
  key: 'feedbackEnabled' | 'roadmapEnabled' | 'changelogEnabled' | 'supportEnabled'
  label: string
  icon: string
  /** Description in the team Tools tab */
  description: string
  teamDefault: boolean
  /**
   * Present when products have their own toggle for this module. Support has
   * none: an inbox is team-scoped, not a product feature (support design.md).
   */
  product?: ProductToggle
}

export type ModuleKey = VeerifyModule['key']
export type ModuleSettings = Record<ModuleKey, boolean>

export const MODULES: readonly VeerifyModule[] = [
  {
    key: 'feedbackEnabled',
    label: 'Feedback',
    icon: 'lucide:message-square',
    description: 'Collect, vote on, and triage product feedback',
    teamDefault: true,
    product: {
      label: 'Feedback Board',
      description: 'Allow users to submit, vote, and discuss feedback for your product',
      dataLabel: 'feedback data',
      default: true,
    },
  },
  {
    key: 'roadmapEnabled',
    label: 'Roadmap',
    icon: 'lucide:map',
    description: 'Share planned work publicly as a kanban-style roadmap',
    teamDefault: false,
    product: {
      label: 'Roadmap',
      description: 'Share your planned features and priorities publicly as a kanban-style roadmap',
      dataLabel: 'roadmap data',
      default: false,
    },
  },
  {
    key: 'changelogEnabled',
    label: 'Changelog',
    icon: 'lucide:newspaper',
    description: 'Publish release notes and product updates',
    teamDefault: false,
    product: {
      label: 'Changelog',
      description: 'Publish release notes and product updates for your users',
      dataLabel: 'changelog entries',
      default: false,
    },
  },
  {
    key: 'supportEnabled',
    label: 'Support',
    icon: 'lucide:inbox',
    description: 'Shared inbox for customer conversations and contacts',
    teamDefault: false,
  },
]

export const MODULE_KEYS = MODULES.map((module) => module.key) as ModuleKey[]

export const PRODUCT_MODULES = MODULES.filter(
  (module): module is VeerifyModule & { product: ProductToggle } => module.product !== undefined
)

export const DEFAULT_TEAM_MODULES = Object.fromEntries(
  MODULES.map((module) => [module.key, module.teamDefault])
) as ModuleSettings

/** Picks the module columns from a `team_module_settings` row. */
export function pickTeamModules(row: Partial<Record<string, unknown>>): ModuleSettings {
  return Object.fromEntries(MODULES.map((module) => [module.key, row[module.key] === true])) as ModuleSettings
}

/**
 * Resolves product-level toggles from `project.settings`, applying each
 * module's default when the key is unset.
 */
export function resolveProductModules(settings: Record<string, unknown> | null | undefined) {
  return Object.fromEntries(
    PRODUCT_MODULES.map((module) => {
      const value = settings?.[module.key]
      return [module.key, typeof value === 'boolean' ? value : module.product.default]
    })
  ) as Partial<ModuleSettings>
}
