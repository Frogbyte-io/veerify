import { eq, sql } from 'drizzle-orm'
import { project } from '../../../server/database/schema/feedback'
import { db } from './db'

/**
 * Switches the Support tool on for a project (`project.settings.supportEnabled`). Seeded projects
 * ship with support off, so any spec that exercises the inbox must call this first. Idempotent;
 * merges into the existing settings JSON instead of replacing it.
 */
export async function enableProjectSupport(projectId: string): Promise<string> {
  await db
    .update(project)
    .set({ settings: sql`coalesce(${project.settings}, '{}'::jsonb) || '{"supportEnabled": true}'::jsonb` })
    .where(eq(project.id, projectId))
  return projectId
}
