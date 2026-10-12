import { z } from 'zod'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { findMarketingSite, type MarketingSiteRow } from '~/server/utils/marketing-site'
import type { marketingTerm } from '~/server/database/schema/marketing'

export const MAX_TERMS_PER_SITE = 50
export const MAX_ALIASES = 10

const KINDS = ['brand', 'competitor', 'keyword'] as const

const aliasList = z
  .array(z.string().trim().min(1, 'Aliases cannot be empty').max(80, 'Aliases are at most 80 characters'))
  .max(MAX_ALIASES, `At most ${MAX_ALIASES} aliases`)

const baseShape = {
  label: z.string().trim().min(2, 'Name must be at least 2 characters').max(80, 'Name is at most 80 characters'),
  aliases: aliasList.optional(),
  competitorDomain: z.string().trim().max(255).nullable().optional(),
}

export const createTermSchema = z.object({ kind: z.enum(KINDS), ...baseShape })
/** Kind is fixed after creation; changing it means deleting and re-adding the term. */
export const updateTermSchema = z.object(baseShape)

type TermRow = typeof marketingTerm.$inferSelect

export function serializeTerm(term: TermRow) {
  return {
    id: term.id,
    kind: term.kind,
    label: term.label,
    aliases: term.aliases,
    competitorDomain: term.competitorDomain,
    createdAt: term.createdAt,
  }
}

function validationError(message: string): never {
  throw createError({
    statusCode: 400,
    statusMessage: 'Validation failed',
    data: createErrorResponse(ErrorCode.VALIDATION_ERROR, message),
  })
}

/** Lowercases and strips scheme, path and `www.` so `https://www.Rival.com/pricing` becomes `rival.com`. */
export function normalizeCompetitorDomain(input: string): string {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z\d+.-]*:\/\//, '')
    .split(/[/?#]/)[0]
    .replace(/^www\./, '')
    .replace(/:\d+$/, '')
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(host)) {
    validationError('Competitor domain must be a domain name such as rival.com')
  }
  return host
}

/** De-duplicated aliases (case-insensitive), without repeating the label itself. */
export function cleanAliases(label: string, aliases: string[] | undefined): string[] {
  const seen = new Set([label.toLowerCase()])
  const out: string[] = []
  for (const alias of aliases ?? []) {
    const key = alias.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(alias)
  }
  return out
}

export function resolveCompetitorDomain(kind: string, value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (kind !== 'competitor') validationError('A domain can only be set on competitors')
  return normalizeCompetitorDomain(trimmed)
}

/** Terms hang off the site; without one there is nothing to attach them to. */
export async function requireMarketingSite(projectId: string): Promise<MarketingSiteRow> {
  const site = await findMarketingSite(projectId)
  if (!site) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Add your site before adding brand and competitor terms'),
    })
  }
  return site
}
