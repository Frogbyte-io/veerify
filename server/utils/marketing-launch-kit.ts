import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import { launchKitItem, type LaunchKitStatus } from '~/server/database/schema/marketing'
import { getLaunchDirectory, LAUNCH_DIRECTORIES } from '~/server/services/marketing/launch-kit/directories'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'

export const MAX_CUSTOM_DIRECTORIES = 30
export const CUSTOM_PREFIX = 'custom:'
export const LAUNCH_KIT_STATUSES = ['todo', 'in_progress', 'submitted', 'live', 'rejected', 'skipped'] as const

type ItemRow = typeof launchKitItem.$inferSelect

const httpsUrl = z
  .string()
  .trim()
  .max(500, 'URL is at most 500 characters')
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:'
    } catch {
      return false
    }
  }, 'URL must be a valid https:// address')

/** Empty string is treated as "clear". */
const optionalUrl = z.preprocess((value) => (value === '' ? null : value), httpsUrl.nullable().optional())

export const updateItemSchema = z.object({
  status: z.enum(LAUNCH_KIT_STATUSES),
  url: optionalUrl,
  notes: z
    .string()
    .trim()
    .max(1000, 'Notes are at most 1000 characters')
    .nullable()
    .optional()
    .transform((value) => (value === '' ? null : value)),
})

export const createCustomSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80, 'Name is at most 80 characters'),
  url: optionalUrl,
})

export function isCustomId(directoryId: string): boolean {
  return directoryId.startsWith(CUSTOM_PREFIX) && directoryId.length > CUSTOM_PREFIX.length
}

export function launchKitNotFound(): never {
  throw createError({
    statusCode: 404,
    statusMessage: 'Not Found',
    data: createErrorResponse(ErrorCode.NOT_FOUND, 'Directory not found'),
  })
}

export async function findItem(projectId: string, directoryId: string): Promise<ItemRow | undefined> {
  const [row] = await db
    .select()
    .from(launchKitItem)
    .where(and(eq(launchKitItem.projectId, projectId), eq(launchKitItem.directoryId, directoryId)))
    .limit(1)
  return row
}

/**
 * Item fields shared by catalog and custom entries. For catalog directories
 * `url` is the team's own listing URL; for custom ones it is the directory link.
 */
function itemState(row: ItemRow | undefined) {
  return {
    status: (row?.status ?? 'todo') as LaunchKitStatus,
    url: row?.url ?? null,
    notes: row?.notes ?? null,
    submittedAt: row?.submittedAt ?? null,
    liveAt: row?.liveAt ?? null,
  }
}

export function serializeCustomItem(row: ItemRow) {
  return {
    id: row.directoryId,
    custom: true as const,
    name: row.name ?? 'Custom directory',
    siteUrl: row.url,
    ...itemState(row),
  }
}

/** Catalog merged with this product's items; progress counts every entry by status. */
export function buildLaunchKit(rows: ItemRow[], catalog: ReturnType<typeof listCatalog>) {
  const byDirectory = new Map(rows.map((row) => [row.directoryId, row]))
  const directories = catalog.map(({ url: siteUrl, ...directory }) => ({
    ...directory,
    siteUrl,
    custom: false as const,
    ...itemState(byDirectory.get(directory.id)),
  }))
  const custom = rows.filter((row) => isCustomId(row.directoryId)).map(serializeCustomItem)

  const counts: Record<LaunchKitStatus, number> = {
    todo: 0,
    in_progress: 0,
    submitted: 0,
    live: 0,
    rejected: 0,
    skipped: 0,
  }
  for (const entry of [...directories, ...custom]) counts[entry.status] += 1

  return { directories, custom, progress: { total: directories.length + custom.length, counts } }
}

export function listCatalog() {
  return LAUNCH_DIRECTORIES
}

export { getLaunchDirectory }
