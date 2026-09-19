import { pgTable, text, timestamp, boolean } from 'drizzle-orm/pg-core'
import { team } from './auth'

/**
 * Per-team module enablement — which of Veerify's modules a team uses.
 *
 * Deliberately **not** stored in `supportTeamSettings` (delta D-31): that table
 * is the home for support-only team policy (`autoLinkFeedback`), and three
 * unrelated product flags in a table named `support_team_settings` would make
 * its purpose incoherent.
 *
 * Relationship to the existing per-project toggles in
 * `project.settings.feedbackEnabled` and friends: **this is a master switch and
 * both must be on.** A product with feedback enabled, inside a team whose
 * `feedbackEnabled` is false, shows nothing. The team flag governs whether the
 * module exists for the team at all; the per-project flag governs whether a
 * given product uses it.
 *
 * Defaults mirror the per-project ones in `ProductSettingsFeatures.vue`.
 * `feedbackEnabled` defaults **true** on purpose — a false default would hide
 * the feedback navigation for every existing team the moment this migration
 * deploys.
 */
export const teamModuleSettings = pgTable('team_module_settings', {
  teamId: text('team_id')
    .primaryKey()
    .references(() => team.id, { onDelete: 'cascade' }),
  feedbackEnabled: boolean('feedback_enabled').default(true).notNull(),
  roadmapEnabled: boolean('roadmap_enabled').default(false).notNull(),
  changelogEnabled: boolean('changelog_enabled').default(false).notNull(),
  supportEnabled: boolean('support_enabled').default(false).notNull(),
  createdAt: timestamp('created_at')
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp('updated_at')
    .$defaultFn(() => new Date())
    .notNull(),
})
