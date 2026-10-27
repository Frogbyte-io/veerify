/**
 * Search over the generated OpenAPI operations, for the `search_api` MCP tool.
 * Operations under paths `call_api` refuses are left out entirely.
 */
import { openapiPaths } from '~/server/generated/openapi-routes'
import { isBlockedApiPath } from './api-bridge'
import type { HttpMethod } from './types'

export interface ApiOperationSummary {
  operationId: string
  method: HttpMethod
  path: string
  summary: string
  tags: string[]
}

export interface ApiOperationDetail extends ApiOperationSummary {
  description: string | null
  parameters: unknown[]
  requestBody: unknown | null
  responses: Record<string, unknown>
}

const METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 25

type RawOperation = {
  operationId?: string
  summary?: string
  description?: string
  tags?: readonly string[]
  parameters?: readonly unknown[]
  requestBody?: unknown
  responses?: Record<string, unknown>
}

let cache: ApiOperationDetail[] | null = null

function allOperations(): ApiOperationDetail[] {
  if (cache) return cache
  const operations: ApiOperationDetail[] = []
  for (const [path, item] of Object.entries(openapiPaths as Record<string, Record<string, RawOperation>>)) {
    // Blocked prefixes are literal (no templated segments), so the template path checks the same.
    if (isBlockedApiPath(path)) continue
    for (const method of METHODS) {
      const op = item[method.toLowerCase()]
      if (!op?.operationId) continue
      operations.push({
        operationId: op.operationId,
        method,
        path,
        summary: op.summary ?? '',
        tags: [...(op.tags ?? [])],
        description: op.description ?? null,
        parameters: [...(op.parameters ?? [])],
        requestBody: op.requestBody ?? null,
        responses: op.responses ?? {},
      })
    }
  }
  cache = operations
  return operations
}

function toSummary(op: ApiOperationDetail): ApiOperationSummary {
  return { operationId: op.operationId, method: op.method, path: op.path, summary: op.summary, tags: op.tags }
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function score(op: ApiOperationDetail, tokens: string[]): number {
  const operationId = op.operationId.toLowerCase()
  const path = op.path.toLowerCase()
  const summary = op.summary.toLowerCase()
  const tags = op.tags.join(' ').toLowerCase()
  const description = (op.description ?? '').toLowerCase()
  let total = 0
  for (const token of tokens) {
    if (operationId.includes(token)) total += 3
    if (path.includes(token)) total += 3
    if (summary.includes(token)) total += 2
    if (tags.includes(token)) total += 1
    if (description.includes(token)) total += 1
  }
  return total
}

function compareByPath(a: ApiOperationDetail, b: ApiOperationDetail): number {
  return a.path.localeCompare(b.path) || METHODS.indexOf(a.method) - METHODS.indexOf(b.method)
}

/**
 * Ranks operations by case-insensitive token matches: operationId/path ×3, summary ×2,
 * tags/description ×1; ties broken by path. An empty query lists (tag-filtered) operations by path.
 */
export function searchApi(query: string, opts: { tag?: string; limit?: number } = {}): ApiOperationSummary[] {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const tag = opts.tag?.trim().toLowerCase()
  const tokens = tokenize(query ?? '')

  const candidates = allOperations().filter((op) => !tag || op.tags.some((t) => t.toLowerCase() === tag))
  const ranked = candidates
    .map((op) => ({ op, score: tokens.length ? score(op, tokens) : 0 }))
    .filter((entry) => tokens.length === 0 || entry.score > 0)
    .sort((a, b) => b.score - a.score || compareByPath(a.op, b.op))

  return ranked.slice(0, limit).map((entry) => toSummary(entry.op))
}

export function getApiOperation(operationId: string): ApiOperationDetail | null {
  return allOperations().find((op) => op.operationId === operationId) ?? null
}
