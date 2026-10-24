import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { product, project } from '~/server/database/schema/feedback'
import { createErrorResponse, ErrorCode } from './response'
import { isReservedSlug } from './reserved-slugs'

/** Public sub-pages under `/<project>/`; a product slug would shadow them. */
export const RESERVED_PRODUCT_SLUGS = new Set([
  'roadmap',
  'changelog',
  'testimonials',
  'support',
  'products',
  'settings',
  'api',
])

export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100)
}

function validationError(message: string): never {
  throw createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    data: createErrorResponse(ErrorCode.VALIDATION_ERROR, message),
  })
}

function conflict(message: string): never {
  throw createError({
    statusCode: 409,
    statusMessage: 'Conflict',
    data: createErrorResponse(ErrorCode.CONFLICT, message),
  })
}

export function assertProductSlugAllowed(slug: string) {
  if (!slug) validationError('Slug is required')
  if (RESERVED_PRODUCT_SLUGS.has(slug)) validationError(`"${slug}" is reserved and cannot be used as a product slug`)
}

export function assertProjectSlugAllowed(slug: string) {
  if (!slug) validationError('Slug is required')
  if (isReservedSlug(slug)) validationError(`"${slug}" is reserved and cannot be used as a project slug`)
}

/** Slug free inside a project; with `explicit` it conflicts (409), otherwise gets a numeric suffix. */
export async function resolveProductSlug(
  projectId: string,
  input: { name: string; slug?: string | null },
  excludeProductId?: string
): Promise<string> {
  const explicit = input.slug?.trim()
  const base = explicit || slugifyName(input.name)
  assertProductSlugAllowed(base)

  const taken = async (candidate: string) => {
    const [row] = await db
      .select({ id: product.id })
      .from(product)
      .where(and(eq(product.projectId, projectId), eq(product.slug, candidate)))
      .limit(1)
    return !!row && row.id !== excludeProductId
  }

  if (!(await taken(base))) return base
  if (explicit) conflict('A product with this slug already exists in this project')
  for (let i = 2; i < 100; i++) {
    const candidate = `${base.slice(0, 95)}-${i}`
    if (!(await taken(candidate))) return candidate
  }
  conflict('Could not find a free slug for this product')
}

/** Slug free inside an organization; same explicit/auto behaviour as `resolveProductSlug`. */
export async function resolveProjectSlug(
  organizationId: string,
  input: { name: string; slug?: string | null }
): Promise<string> {
  const explicit = input.slug?.trim()
  const base = explicit || slugifyName(input.name)
  assertProjectSlugAllowed(base)

  const taken = async (candidate: string) => {
    const [row] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.organizationId, organizationId), eq(project.slug, candidate)))
      .limit(1)
    return !!row
  }

  if (!(await taken(base))) return base
  if (explicit) conflict('A project with this slug already exists in this workspace')
  for (let i = 2; i < 100; i++) {
    const candidate = `${base.slice(0, 95)}-${i}`
    if (!isReservedSlug(candidate) && !(await taken(candidate))) return candidate
  }
  conflict('Could not find a free slug for this project')
}
