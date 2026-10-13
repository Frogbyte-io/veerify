import { and, eq, like } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { changelogEntry } from '~/server/database/schema/changelog'

const MAX_SLUG_LENGTH = 60

export function slugifyTitle(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '')
  return slug || 'update'
}

/** Pure: picks `base`, else `base-2`, `base-3`, ... not present in `taken`. */
export function pickUniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/** Slug unique within the project, derived from the title. */
export async function generateUniqueSlug(projectId: string, title: string): Promise<string> {
  const base = slugifyTitle(title)
  const rows = await db
    .select({ slug: changelogEntry.slug })
    .from(changelogEntry)
    .where(and(eq(changelogEntry.projectId, projectId), like(changelogEntry.slug, `${base}%`)))
  return pickUniqueSlug(base, new Set(rows.map((row) => row.slug)))
}
