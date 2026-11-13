/**
 * The public browser endpoint's request handling: origin checks, CORS, and
 * reading JSON or form-encoded bodies into one shape.
 */
import { createError, setResponseHeaders, type H3Event } from 'h3'
import { z } from 'zod'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { readRawBodyWithLimit } from '~/server/utils/json-body-limit'
import { FORM_HONEYPOT_FIELD, FORM_LIMITS, originAllowed, type FormField } from '~/lib/support-forms'
import { FORM_ERROR, type SupportFormRow } from './submit'

export interface BrowserSubmission {
  fields: Record<string, unknown>
  pageUrl: string | null
  locale: string | null
  honeypot: string
  challengeToken: string | null
}

/** True when the request comes from one of the form's allowed origins. */
export function browserOriginAllowed(form: Pick<SupportFormRow, 'allowedOrigins'>, origin: string | null): boolean {
  return originAllowed(origin, form.allowedOrigins)
}

export function originNotAllowed() {
  return createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    data: createErrorResponse(FORM_ERROR.ORIGIN_NOT_ALLOWED, 'This origin may not submit this form'),
  })
}

/** CORS grant for one allowed origin. Never `*`, never credentials. */
export function setFormCorsHeaders(event: H3Event, origin: string) {
  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  })
}

const jsonBodySchema = z
  .object({
    fields: z.record(z.string(), z.unknown()),
    metadata: z
      .object({
        pageUrl: z.string().max(FORM_LIMITS.metadataValue).optional(),
        locale: z.string().max(35).optional(),
      })
      .strict()
      .optional(),
    // Any value: a filled honeypot must get the normal-looking 201, never a 400 a bot could learn from.
    [FORM_HONEYPOT_FIELD]: z.unknown().optional(),
    challengeToken: z.string().max(4096).optional(),
  })
  .strict()

const TRUTHY = new Set(['on', 'true', '1', 'yes'])

const reservedSchema = z.object({
  pageUrl: z.string().max(FORM_LIMITS.metadataValue).nullable(),
  locale: z.string().max(35).nullable(),
  challengeToken: z.string().max(4096).nullable(),
})

function honeypotText(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** Form-encoded bodies carry checkboxes as `on` when ticked and nothing when not. */
function fromFormEncoded(params: URLSearchParams, fields: FormField[]): BrowserSubmission {
  const values: Record<string, unknown> = {}
  const types = new Map(fields.map((field) => [field.key, field.type]))
  for (const [name, value] of params) {
    if (name.startsWith('_')) continue
    values[name] = types.get(name) === 'checkbox' ? TRUTHY.has(value.trim().toLowerCase()) : value
  }
  // Same caps as the JSON body's metadata.
  const reserved = reservedSchema.safeParse({
    pageUrl: params.get('_page_url'),
    locale: params.get('_locale'),
    challengeToken: params.get('_challenge'),
  })
  if (!reserved.success) throw invalid('Request validation failed', reserved.error.issues)
  return {
    fields: values,
    ...reserved.data,
    honeypot: params.get(FORM_HONEYPOT_FIELD) ?? '',
  }
}

function invalid(message: string, details?: unknown) {
  return createError({
    statusCode: 400,
    statusMessage: 'Validation failed',
    data: createErrorResponse(ErrorCode.VALIDATION_ERROR, message, details),
  })
}

export async function readBrowserSubmission(event: H3Event, form: SupportFormRow): Promise<BrowserSubmission> {
  const contentType = String(event.node.req.headers['content-type'] ?? '').toLowerCase()
  const raw = (await readRawBodyWithLimit(event, FORM_LIMITS.bodyBytes)).toString('utf8')

  if (contentType.startsWith('application/x-www-form-urlencoded')) {
    return fromFormEncoded(new URLSearchParams(raw), form.fields)
  }
  if (!contentType.startsWith('application/json') && !contentType.startsWith('text/plain')) {
    throw createError({
      statusCode: 415,
      statusMessage: 'Unsupported Media Type',
      data: createErrorResponse(
        ErrorCode.VALIDATION_ERROR,
        'Send application/json or application/x-www-form-urlencoded'
      ),
    })
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw invalid('Request body must be valid JSON')
  }
  const parsed = jsonBodySchema.safeParse(json)
  if (!parsed.success) throw invalid('Request validation failed', parsed.error.issues)
  return {
    fields: parsed.data.fields,
    pageUrl: parsed.data.metadata?.pageUrl ?? null,
    locale: parsed.data.metadata?.locale ?? null,
    honeypot: honeypotText(parsed.data[FORM_HONEYPOT_FIELD]),
    challengeToken: parsed.data.challengeToken ?? null,
  }
}
