/**
 * Single registry of Veerify modules (tools).
 *
 * Tools are switched on per project, in `project.settings[key]`. There is no
 * second (team/workspace) switch: a tool is on for a project exactly when its
 * key resolves to true here.
 *
 * Adding a module: add an entry here; no schema change is needed.
 */

export interface VeerifyModule {
  key: 'feedbackEnabled' | 'roadmapEnabled' | 'changelogEnabled' | 'supportEnabled' | 'marketingEnabled'
  label: string
  icon: string
  /** One-line description in the project Tools tab and the "Add tool" flow */
  description: string
  /** What the disable dialog says is hidden, e.g. "roadmap data" */
  dataLabel: string
  /** Value when `project.settings[key]` is unset */
  default: boolean
}

export type ModuleKey = VeerifyModule['key']
export type ModuleSettings = Record<ModuleKey, boolean>

export const MODULES: readonly VeerifyModule[] = [
  {
    key: 'feedbackEnabled',
    label: 'Feedback',
    icon: 'lucide:message-square',
    description: 'Let users submit, vote on, and discuss feedback for each product',
    dataLabel: 'feedback data',
    default: true,
  },
  {
    key: 'roadmapEnabled',
    label: 'Roadmap',
    icon: 'lucide:map',
    description: 'Share planned work as a kanban-style roadmap, filterable by product',
    dataLabel: 'roadmap data',
    default: false,
  },
  {
    key: 'changelogEnabled',
    label: 'Changelog',
    icon: 'lucide:newspaper',
    description: 'Publish release notes and product updates',
    dataLabel: 'changelog entries',
    default: false,
  },
  {
    key: 'supportEnabled',
    label: 'Support',
    icon: 'lucide:inbox',
    description: 'Shared inbox for customer conversations and contacts',
    dataLabel: 'support conversations',
    default: false,
  },
  {
    key: 'marketingEnabled',
    label: 'Marketing',
    icon: 'lucide:megaphone',
    description: 'Audit your site, track how AI assistants recommend you, and monitor mentions',
    dataLabel: 'marketing data',
    default: false,
  },
]

export const MODULE_KEYS = MODULES.map((module) => module.key) as ModuleKey[]

export const DEFAULT_PROJECT_MODULES = Object.fromEntries(
  MODULES.map((module) => [module.key, module.default])
) as ModuleSettings

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === 'string' && (MODULE_KEYS as string[]).includes(value)
}

/** Resolves a project's tool switches from `project.settings`, applying defaults for unset keys. */
export function resolveProjectModules(settings: Record<string, unknown> | null | undefined): ModuleSettings {
  return Object.fromEntries(
    MODULES.map((module) => {
      const value = settings?.[module.key]
      return [module.key, typeof value === 'boolean' ? value : module.default]
    })
  ) as ModuleSettings
}

/** Whether a single tool is on for a project's settings. */
export function isModuleEnabled(settings: Record<string, unknown> | null | undefined, key: ModuleKey): boolean {
  return resolveProjectModules(settings)[key]
}
