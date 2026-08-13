import { createHash } from 'node:crypto'
import { toCategorySlug } from '~/server/utils/project-categories'
import { toStatusValue } from '~/server/utils/project-statuses'

export function normalizeWhitespace(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : ''
}

export function toNullableString(value: unknown) {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return null
}

export function toOptionalNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed.replace(/,/g, ''))
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export function toOptionalBoolean(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true
    if (['false', '0', 'no', 'n'].includes(normalized)) return false
  }
  return null
}

export function toOptionalIsoDate(value: unknown) {
  if (value == null) return null
  const raw = typeof value === 'string' ? value.trim() : String(value)
  if (!raw) return null
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export function normalizeStatusValue(nameOrValue: string | null | undefined) {
  const value = normalizeWhitespace(nameOrValue)
  return value ? toStatusValue(value) : ''
}

export function normalizeCategorySlug(nameOrSlug: string | null | undefined) {
  const value = normalizeWhitespace(nameOrSlug)
  return value ? toCategorySlug(value) : ''
}

export function buildImportContentHash(input: {
  sourceType: string
  title: string
  body?: string | null
  createdAt?: string | null
}) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        sourceType: input.sourceType,
        title: normalizeWhitespace(input.title).toLowerCase(),
        body: normalizeWhitespace(input.body).toLowerCase(),
        createdAt: input.createdAt || null,
      })
    )
    .digest('hex')
}

export function sanitizeColor(value: string | null | undefined) {
  const color = normalizeWhitespace(value)
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : null
}

export function pickFirstString(record: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    const value = toNullableString(record[key])
    if (value) return value
  }
  return null
}

export function pickFirstNumber(record: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    const value = toOptionalNumber(record[key])
    if (value != null) return value
  }
  return null
}

export function unwrapArrayPayload(payload: unknown): any[] {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object') {
    const typed = payload as Record<string, any>
    for (const key of ['data', 'items', 'results', 'records']) {
      if (Array.isArray(typed[key])) return typed[key]
    }
  }
  return []
}

export function parseCsv(content: string) {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let inQuotes = false

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    const next = content[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(value)
      value = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1
      }
      row.push(value)
      value = ''
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row)
      }
      row = []
      continue
    }

    value += char
  }

  row.push(value)
  if (row.some((cell) => cell.length > 0)) {
    rows.push(row)
  }

  return rows
}

export function csvRowsToObjects(content: string) {
  const rows = parseCsv(content)
  if (rows.length === 0) return []

  const headers = rows[0].map((header) => normalizeCsvHeader(header))
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {}
    headers.forEach((header, index) => {
      if (header) {
        record[header] = row[index] ?? ''
      }
    })
    return record
  })
}

export function normalizeCsvHeader(header: string) {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}
