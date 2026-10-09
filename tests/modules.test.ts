import { getTableColumns } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { DEFAULT_TEAM_MODULES, MODULE_KEYS, pickTeamModules, resolveProductModules } from '../lib/modules'
import { teamModuleSettings } from '../server/database/schema/teams'

describe('module registry', () => {
  it('has a team_module_settings column for every module, with a matching default', () => {
    const columns = getTableColumns(teamModuleSettings) as Record<string, { default?: unknown }>

    for (const key of MODULE_KEYS) {
      expect(columns[key], `missing column for ${key}`).toBeDefined()
      expect(columns[key].default, `default for ${key}`).toBe(DEFAULT_TEAM_MODULES[key])
    }
  })

  it('has a module for every boolean column in team_module_settings', () => {
    const columns = getTableColumns(teamModuleSettings) as Record<string, { dataType: string }>
    const booleanColumns = Object.entries(columns)
      .filter(([, column]) => column.dataType === 'boolean')
      .map(([name]) => name)

    expect(booleanColumns.sort()).toEqual([...MODULE_KEYS].sort())
  })

  it('picks only module columns from a settings row', () => {
    expect(
      pickTeamModules({
        teamId: 'team-1',
        feedbackEnabled: false,
        roadmapEnabled: true,
        changelogEnabled: false,
        supportEnabled: true,
        updatedAt: new Date(),
      })
    ).toEqual({ feedbackEnabled: false, roadmapEnabled: true, changelogEnabled: false, supportEnabled: true })
  })

  it('applies product defaults when project settings leave a module unset', () => {
    expect(resolveProductModules(null)).toEqual({
      feedbackEnabled: true,
      roadmapEnabled: false,
      changelogEnabled: false,
    })
    expect(resolveProductModules({ feedbackEnabled: false, roadmapEnabled: true, theme: 'dark' })).toEqual({
      feedbackEnabled: false,
      roadmapEnabled: true,
      changelogEnabled: false,
    })
  })
})
