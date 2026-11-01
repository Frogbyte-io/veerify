import { asc, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { feedbackCategory, feedbackStatus } from '~/server/database/schema/feedback'
import { toCategorySlug } from '~/server/utils/project-categories'
import { SYSTEM_STATUSES, toStatusValue } from '~/server/utils/project-statuses'
import type { ImportBatch, IssueInput } from './format'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = typeof db | Transaction

export interface TaxonomyResolution {
  statusValueByExternalId: Map<string, string>
  defaultStatusValue: string
  categoryIdByExternalId: Map<string, string | null>
  toCreate: {
    /** systemDefault: a built-in status saved because the project still used the defaults, not one from the import. */
    statuses: { name: string; value: string; color?: string; systemDefault?: true }[]
    categories: { name: string; slug: string; color?: string }[]
  }
  issues: IssueInput[]
}

const DEFAULT_COLOR = '#6b7280'

export async function resolveTaxonomy(
  projectId: string,
  batch: Pick<ImportBatch, 'statuses' | 'categories'>,
  options: { apply: boolean; tx?: Executor }
): Promise<TaxonomyResolution> {
  const exec: Executor = options.tx ?? db
  const issues: IssueInput[] = []
  const statusValueByExternalId = new Map<string, string>()
  const categoryIdByExternalId = new Map<string, string | null>()
  const toCreate: TaxonomyResolution['toCreate'] = { statuses: [], categories: [] }

  // Statuses
  const statusRows = await exec
    .select()
    .from(feedbackStatus)
    .where(eq(feedbackStatus.projectId, projectId))
    .orderBy(asc(feedbackStatus.sortOrder), asc(feedbackStatus.value))
  const hasRows = statusRows.length > 0
  const defaultStatusValue = hasRows ? (statusRows.find((s) => s.isDefault) ?? statusRows[0]).value : 'open'
  const effective = new Set<string>(hasRows ? statusRows.map((s) => s.value) : SYSTEM_STATUSES.map((s) => s.value))
  const created = new Map<string, { name: string; value: string; color?: string }>()

  for (const status of batch.statuses) {
    let value: string | undefined
    if (status.mapTo !== undefined) {
      if (effective.has(status.mapTo) || created.has(status.mapTo)) value = status.mapTo
      else
        issues.push({
          severity: 'warning',
          entityType: 'status',
          externalId: status.externalId,
          message: `mapTo "${status.mapTo}" is not a status of this project; matched by name instead`,
        })
    }
    if (value === undefined) {
      const byName = toStatusValue(status.name)
      if (!byName) {
        issues.push({
          severity: 'warning',
          entityType: 'status',
          externalId: status.externalId,
          message: `Status name "${status.name}" cannot be converted to a status value`,
        })
        continue
      }
      if (!effective.has(byName) && !created.has(byName)) {
        created.set(byName, { name: status.name, value: byName, color: status.color || DEFAULT_COLOR })
      }
      value = byName
    }
    statusValueByExternalId.set(status.externalId, value)
  }

  if (created.size > 0) {
    if (!hasRows) {
      for (const s of SYSTEM_STATUSES) {
        toCreate.statuses.push({ name: s.name, value: s.value, color: s.color, systemDefault: true })
      }
    }
    toCreate.statuses.push(...created.values())

    if (options.apply) {
      const now = new Date()
      const rows: (typeof feedbackStatus.$inferInsert)[] = []
      if (!hasRows) {
        for (const s of SYSTEM_STATUSES) {
          rows.push({
            id: crypto.randomUUID(),
            projectId,
            name: s.name,
            value: s.value,
            color: s.color,
            description: s.description,
            sortOrder: s.sortOrder,
            isDefault: s.isDefault,
            createdAt: now,
          })
        }
      }
      let next = hasRows ? Math.max(...statusRows.map((s) => s.sortOrder)) + 1 : SYSTEM_STATUSES.length
      for (const c of created.values()) {
        rows.push({
          id: crypto.randomUUID(),
          projectId,
          name: c.name,
          value: c.value,
          color: c.color || DEFAULT_COLOR,
          description: null,
          sortOrder: next++,
          isDefault: false,
          createdAt: now,
        })
      }
      await exec.insert(feedbackStatus).values(rows).onConflictDoNothing()
    }
  }

  // Categories
  const categoryRows = await exec.select().from(feedbackCategory).where(eq(feedbackCategory.projectId, projectId))
  const byId = new Map(categoryRows.map((c) => [c.id, c]))
  const bySlug = new Map(categoryRows.map((c) => [c.slug, c]))
  const newCategories = new Map<string, { name: string; slug: string; color?: string }>()
  const pending: { externalId: string; slug: string }[] = []

  for (const category of batch.categories) {
    let existing: { id: string } | undefined
    if (category.mapTo !== undefined) {
      existing = byId.get(category.mapTo) ?? bySlug.get(category.mapTo)
      if (!existing)
        issues.push({
          severity: 'warning',
          entityType: 'category',
          externalId: category.externalId,
          message: `mapTo "${category.mapTo}" is not a category of this project; matched by name instead`,
        })
    }
    if (!existing) {
      const slug = toCategorySlug(category.name)
      if (!slug) {
        issues.push({
          severity: 'warning',
          entityType: 'category',
          externalId: category.externalId,
          message: `Category name "${category.name}" cannot be converted to a slug`,
        })
        categoryIdByExternalId.set(category.externalId, null)
        continue
      }
      existing = bySlug.get(slug)
      if (!existing) {
        if (!newCategories.has(slug)) newCategories.set(slug, { name: category.name, slug, color: category.color })
        pending.push({ externalId: category.externalId, slug })
        categoryIdByExternalId.set(category.externalId, null)
        continue
      }
    }
    categoryIdByExternalId.set(category.externalId, existing.id)
  }

  toCreate.categories.push(...newCategories.values())

  if (options.apply && newCategories.size > 0) {
    const now = new Date()
    let next = categoryRows.length ? Math.max(...categoryRows.map((c) => c.sortOrder)) + 1 : 0
    await exec
      .insert(feedbackCategory)
      .values(
        [...newCategories.values()].map((c) => ({
          id: crypto.randomUUID(),
          projectId,
          name: c.name,
          slug: c.slug,
          color: c.color || null,
          sortOrder: next++,
          isDefault: false,
          createdAt: now,
        }))
      )
      .onConflictDoNothing()
    const reread = await exec.select().from(feedbackCategory).where(eq(feedbackCategory.projectId, projectId))
    const idBySlug = new Map(reread.map((c) => [c.slug, c.id]))
    for (const p of pending) categoryIdByExternalId.set(p.externalId, idBySlug.get(p.slug) ?? null)
  }

  return { statusValueByExternalId, defaultStatusValue, categoryIdByExternalId, toCreate, issues }
}

export function resolveFeedbackStatus(
  raw: string | undefined,
  res: Pick<TaxonomyResolution, 'statusValueByExternalId' | 'defaultStatusValue'>,
  effective: Set<string>
): { value: string; issue?: IssueInput } {
  if (raw === undefined || raw === '') return { value: res.defaultStatusValue }
  const mapped = res.statusValueByExternalId.get(raw)
  if (mapped) return { value: mapped }
  if (effective.has(raw)) return { value: raw }
  return {
    value: res.defaultStatusValue,
    issue: {
      severity: 'warning',
      entityType: 'feedback',
      message: `Unknown status "${raw}"; imported as ${res.defaultStatusValue}`,
    },
  }
}
