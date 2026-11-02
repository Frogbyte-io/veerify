/**
 * How a project is told apart in All projects: a colour and an initial (or its logo).
 *
 * The colour is the project's appearance accent when it was changed from the default;
 * otherwise it comes from a fixed palette by the project's position in its workspace
 * (creation order), so the projects of one workspace get distinct colours.
 * Shared by the server (API responses) and the client.
 */

export type ProjectIdentity = {
  color: string
  initials: string
  logoUrl: string | null
}

/** The appearance accent every project starts with (components/project/ProjectSettingsAppearance.vue). */
export const DEFAULT_ACCENT_COLOR = '#3b82f6'

/** Distinct, mid-lightness colours that read on both light and dark backgrounds. */
export const PROJECT_PALETTE = [
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#f59e0b', // amber
  '#ec4899', // pink
  '#3b82f6', // blue
  '#84cc16', // lime
  '#f97316', // orange
  '#06b6d4', // cyan
  '#ef4444', // red
  '#a855f7', // purple
] as const

const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** Near-black or white text, whichever contrasts more with the badge colour (WCAG relative luminance). */
export function projectForegroundColor(color: string): string {
  if (!HEX_COLOR.test(color)) return '#ffffff'
  const channel = (offset: number) => {
    const value = parseInt(color.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  const DARK = 0.012 // relative luminance of #111827
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / (DARK + 0.05) ? '#ffffff' : '#111827'
}

export function projectInitials(name: string): string {
  const words = String(name || '')
    .trim()
    .split(/[\s\-_.]+/)
    .filter(Boolean)
  if (words.length === 0) return '?'
  // Code points, not UTF-16 units, so a leading emoji stays whole.
  const first = (word: string) => Array.from(word)[0] ?? ''
  if (words.length === 1) return first(words[0]!).toUpperCase()
  return (first(words[0]!) + first(words[1]!)).toUpperCase()
}

/**
 * @param index the project's position among all projects of its workspace, ordered by creation.
 */
export function projectIdentity(
  project: { name: string; settings?: Record<string, unknown> | null },
  index: number
): ProjectIdentity {
  const settings = project.settings ?? {}
  const accent = typeof settings.accentColor === 'string' ? settings.accentColor : null
  const custom = accent && HEX_COLOR.test(accent) && accent.toLowerCase() !== DEFAULT_ACCENT_COLOR ? accent : null
  const logoUrl = typeof settings.logoUrl === 'string' && settings.logoUrl ? settings.logoUrl : null
  return {
    color: custom ?? PROJECT_PALETTE[Math.abs(index) % PROJECT_PALETTE.length]!,
    initials: projectInitials(project.name),
    logoUrl,
  }
}
