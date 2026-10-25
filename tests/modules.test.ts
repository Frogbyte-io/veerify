import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PROJECT_MODULES,
  MODULE_KEYS,
  MODULES,
  isModuleEnabled,
  isModuleKey,
  resolveProjectModules,
} from '../lib/modules'

describe('module registry', () => {
  it('has a unique key and a default for every module', () => {
    expect(new Set(MODULE_KEYS).size).toBe(MODULES.length)
    for (const module of MODULES) {
      expect(DEFAULT_PROJECT_MODULES[module.key], `default for ${module.key}`).toBe(module.default)
    }
  })

  it('recognises module keys', () => {
    expect(isModuleKey('supportEnabled')).toBe(true)
    expect(isModuleKey('theme')).toBe(false)
    expect(isModuleKey(undefined)).toBe(false)
  })

  it('applies defaults when project settings leave a tool unset', () => {
    expect(resolveProjectModules(null)).toEqual({
      feedbackEnabled: true,
      roadmapEnabled: false,
      changelogEnabled: false,
      supportEnabled: false,
      marketingEnabled: false,
    })
  })

  it('lets project settings override defaults and ignores unrelated keys', () => {
    expect(
      resolveProjectModules({ feedbackEnabled: false, supportEnabled: true, theme: 'dark', roadmapEnabled: 'yes' })
    ).toEqual({
      feedbackEnabled: false,
      roadmapEnabled: false,
      changelogEnabled: false,
      supportEnabled: true,
      marketingEnabled: false,
    })
  })

  it('checks a single tool', () => {
    expect(isModuleEnabled({ marketingEnabled: true }, 'marketingEnabled')).toBe(true)
    expect(isModuleEnabled({}, 'marketingEnabled')).toBe(false)
  })
})
