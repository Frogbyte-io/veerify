import { createHash } from 'node:crypto'
import { toCategorySlug } from '~/server/utils/project-categories'
import { toStatusValue } from '~/server/utils/project-statuses'
import {
  IMPORT_FORMAT,
  importPersonSchema,
  type ImportCategory,
  type ImportChangelog,
  type ImportComment,
  type ImportDocument,
  type ImportFeedback,
  type ImportPerson,
  type ImportStatus,
} from '../format'

export type ConverterOptions = { source?: string; sourceLabel?: string }
export type ConverterResult = { document: Omit<ImportDocument, 'target'>; warnings: string[] }

const MAX_TITLE = 200
const MAX_BODY = 20_000

export function toNullableString(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

export function toOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim().replace(/,/g, ''))
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export function toOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true
    if (['false', '0', 'no', 'n'].includes(normalized)) return false
  }
  return null
}

export function pickFirstString(record: Record<string, any>, keys: string[]): string | null {
  for (const key of keys) {
    const value = toNullableString(record[key])
    if (value) return value
  }
  return null
}

export function pickFirstNumber(record: Record<string, any>, keys: string[]): number | null {
  for (const key of keys) {
    const value = toOptionalNumber(record[key])
    if (value != null) return value
  }
  return null
}

export function sanitizeColor(value: string | null | undefined): string | undefined {
  const color = (value ?? '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : undefined
}

export function stableId(prefix: string, seed: string): string {
  return `${prefix}_${createHash('sha256').update(seed.toLowerCase()).digest('hex').slice(0, 16)}`
}

export function voteCountOf(value: number | null | undefined): number | undefined {
  return value == null ? undefined : Math.max(0, Math.round(value))
}

/** Shared accumulator: dedupes taxonomy and people, normalizes values and collects warnings. */
export class ImportBuilder {
  readonly warnings: string[] = []
  readonly statuses = new Map<string, ImportStatus>()
  readonly categories = new Map<string, ImportCategory>()
  readonly people = new Map<string, ImportPerson>()
  readonly feedback: ImportFeedback[] = []
  readonly comments: ImportComment[] = []
  readonly changelog: ImportChangelog[] = []
  private droppedSubscriptions = 0

  constructor(
    private readonly defaults: { source: string; sourceLabel: string },
    private readonly options: ConverterOptions
  ) {}

  warn(message: string) {
    this.warnings.push(message)
  }

  dropSubscription() {
    this.droppedSubscriptions += 1
  }

  date(value: unknown, context: string): string | undefined {
    const raw = toNullableString(value)
    if (!raw) return undefined
    const date = new Date(raw)
    if (Number.isNaN(date.getTime())) {
      this.warn(`${context}: dropped unparseable date "${raw}"`)
      return undefined
    }
    return date.toISOString()
  }

  title(value: string, context: string): string {
    if (value.length <= MAX_TITLE) return value
    this.warn(`${context}: title truncated to ${MAX_TITLE} characters`)
    return value.slice(0, MAX_TITLE)
  }

  body(value: string | null | undefined, context: string): string | undefined {
    if (!value) return undefined
    if (value.length <= MAX_BODY) return value
    this.warn(`${context}: body truncated to ${MAX_BODY} characters`)
    return value.slice(0, MAX_BODY)
  }

  private capKey(key: string, kind: string): string {
    if (key.length <= 200) return key
    this.warn(`${kind} key truncated to 200 characters: "${key.slice(0, 40)}..."`)
    return key.slice(0, 200)
  }

  private capName(name: string): string {
    if (name.length <= 100) return name
    this.warn(`name truncated to 100 characters: "${name.slice(0, 40)}..."`)
    return name.slice(0, 100)
  }

  /** Returns the key feedback should reference, creating the status when new. */
  status(name: string | null | undefined, color?: string): string | undefined {
    const trimmed = name?.trim()
    if (!trimmed) return undefined
    const key = this.capKey(toStatusValue(trimmed) || trimmed.toLowerCase(), 'status')
    const existing = this.statuses.get(key)
    if (!existing) this.statuses.set(key, { externalId: key, name: this.capName(trimmed), ...(color ? { color } : {}) })
    else if (color && !existing.color) existing.color = color
    return key
  }

  category(name: string | null | undefined, color?: string): string | undefined {
    const trimmed = name?.trim()
    if (!trimmed) return undefined
    const key = this.capKey(toCategorySlug(trimmed) || trimmed.toLowerCase(), 'category')
    const existing = this.categories.get(key)
    if (!existing)
      this.categories.set(key, { externalId: key, name: this.capName(trimmed), ...(color ? { color } : {}) })
    else if (color && !existing.color) existing.color = color
    return key
  }

  /** Registers an author and returns its externalId, or undefined when neither name nor valid email is usable. */
  person(name: string | null | undefined, email: string | null | undefined, context: string): string | undefined {
    let cleanEmail = email?.trim().toLowerCase() || undefined
    if (cleanEmail && !importPersonSchema.shape.email.safeParse(cleanEmail).success) {
      this.warn(`${context}: dropped invalid email "${cleanEmail}"`)
      cleanEmail = undefined
    }
    const cleanName = name?.trim().slice(0, 200) || undefined
    if (!cleanEmail && !cleanName) return undefined
    const id = (cleanEmail ?? stableId('name', cleanName!)).slice(0, 200)
    const existing = this.people.get(id)
    if (!existing) {
      this.people.set(id, {
        externalId: id,
        ...(cleanName ? { name: cleanName } : {}),
        ...(cleanEmail ? { email: cleanEmail } : {}),
      })
    } else if (cleanName && !existing.name) existing.name = cleanName
    return id
  }

  build(): ConverterResult {
    const feedbackIds = new Set(this.feedback.map((f) => f.externalId))
    const kept = this.comments.filter((c) => feedbackIds.has(c.feedbackExternalId))
    if (kept.length !== this.comments.length) {
      for (const c of this.comments) {
        if (!feedbackIds.has(c.feedbackExternalId)) {
          this.warn(`comment ${c.externalId}: dropped because feedback "${c.feedbackExternalId}" is not in the import`)
        }
      }
      this.comments.length = 0
      this.comments.push(...kept)
    }
    if (this.droppedSubscriptions > 0) {
      this.warn(
        `Dropped ${this.droppedSubscriptions} subscription(s): the import format has no subscriptions and imports never send email`
      )
    }
    return {
      document: {
        format: IMPORT_FORMAT,
        source: this.options.source || this.defaults.source,
        sourceLabel: this.options.sourceLabel || this.defaults.sourceLabel,
        statuses: [...this.statuses.values()],
        categories: [...this.categories.values()],
        people: [...this.people.values()],
        feedback: this.feedback,
        comments: this.comments,
        changelog: this.changelog,
      },
      warnings: this.warnings,
    }
  }
}
