/**
 * Website forms (Inbox → Forms): the form definition and how a submission is
 * checked against it. Pure, so the admin UI and the server share one set of
 * rules. See docs/forms-api.md.
 */

export const FORM_FIELD_TYPES = ['text', 'email', 'textarea', 'select', 'checkbox'] as const
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number]

export const FORM_AUTO_REPLY_MODES = ['inbox', 'custom', 'off'] as const
export type FormAutoReplyMode = (typeof FORM_AUTO_REPLY_MODES)[number]

export interface FormFieldOption {
  value: string
  label: string
}

export interface FormField {
  /** Key in the submission's `fields` object: lowercase letters, digits, `_` and `-`. */
  key: string
  label: string
  type: FormFieldType
  required: boolean
  /** Select fields only. */
  options?: FormFieldOption[]
}

/** Which field fills the contact's name and email and the conversation subject. */
export interface FormFieldMapping {
  email: string
  name: string | null
  subject: string | null
}

export const FORM_LIMITS = {
  fields: 30,
  options: 50,
  keyLength: 40,
  labelLength: 120,
  optionValueLength: 120,
  allowedOrigins: 20,
  autoReplyLength: 5000,
  /** Characters per value, by field type. */
  text: 500,
  email: 254,
  textarea: 10_000,
  /** Whole request body, bytes. */
  bodyBytes: 64 * 1024,
  metadataValue: 2048,
  extraKeys: 20,
  extraKeyLength: 40,
  idempotencyKey: 255,
} as const

/** The browser endpoint's honeypot. Real people leave it empty; bots fill every input. */
export const FORM_HONEYPOT_FIELD = '_hp'

export const FORM_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/
export const FORM_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// Deliberately strict: the address becomes the To of every reply.
const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/

export function isValidFormEmail(value: string): boolean {
  return value.length <= FORM_LIMITS.email && EMAIL_PATTERN.test(value)
}

/** An origin as browsers send it: scheme, host and optional port, no path. `https://*.example.com` covers subdomains. */
const ORIGIN_PATTERN = /^https?:\/\/(\*\.)?[a-z0-9.-]+(:\d{1,5})?$/

export function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim().toLowerCase().replace(/\/+$/, '')
  return ORIGIN_PATTERN.test(trimmed) ? trimmed : null
}

export function originAllowed(origin: string | null | undefined, allowed: readonly string[]): boolean {
  if (!origin) return false
  const candidate = origin.trim().toLowerCase()
  for (const entry of allowed) {
    if (entry === candidate) return true
    const wildcard = /^(https?):\/\/\*\.(.+)$/.exec(entry)
    if (!wildcard) continue
    const [, scheme, rest] = wildcard
    const prefix = `${scheme}://`
    if (!candidate.startsWith(prefix)) continue
    const host = candidate.slice(prefix.length)
    // `*.example.com` matches `shop.example.com` (and a port only if the entry names it), never `example.com` itself.
    if (host.endsWith(`.${rest}`) && !host.slice(0, -rest.length - 1).includes('/')) return true
  }
  return false
}

export interface FormDefinitionInput {
  fields: FormField[]
  fieldMapping: FormFieldMapping
}

/** Problems with a definition, as `path: message` strings; empty when it is valid. */
export function validateFormDefinition(input: FormDefinitionInput): string[] {
  const errors: string[] = []
  const { fields, fieldMapping } = input
  if (!Array.isArray(fields) || fields.length === 0) return ['fields: Add at least one field']
  if (fields.length > FORM_LIMITS.fields) errors.push(`fields: At most ${FORM_LIMITS.fields} fields`)

  const keys = new Set<string>()
  fields.forEach((field, index) => {
    const at = `fields[${index}]`
    if (!FORM_KEY_PATTERN.test(field.key) || field.key.length > FORM_LIMITS.keyLength) {
      errors.push(`${at}.key: Use lowercase letters, digits, "_" or "-" (at most ${FORM_LIMITS.keyLength})`)
    }
    if (field.key === FORM_HONEYPOT_FIELD) errors.push(`${at}.key: "${FORM_HONEYPOT_FIELD}" is reserved`)
    if (keys.has(field.key)) errors.push(`${at}.key: "${field.key}" is used twice`)
    keys.add(field.key)
    if (!field.label?.trim() || field.label.length > FORM_LIMITS.labelLength) {
      errors.push(`${at}.label: Required, at most ${FORM_LIMITS.labelLength} characters`)
    }
    if (!FORM_FIELD_TYPES.includes(field.type)) errors.push(`${at}.type: Unknown type`)
    if (field.type === 'select') {
      const options = field.options ?? []
      if (options.length === 0) errors.push(`${at}.options: A select needs at least one option`)
      if (options.length > FORM_LIMITS.options) errors.push(`${at}.options: At most ${FORM_LIMITS.options} options`)
      const values = new Set<string>()
      options.forEach((option, optionIndex) => {
        const value = option.value?.trim()
        if (!value || value.length > FORM_LIMITS.optionValueLength) {
          errors.push(`${at}.options[${optionIndex}].value: Required, at most ${FORM_LIMITS.optionValueLength}`)
        } else if (values.has(value)) {
          errors.push(`${at}.options[${optionIndex}].value: "${value}" is used twice`)
        }
        values.add(value)
        if (!option.label?.trim() || option.label.length > FORM_LIMITS.labelLength) {
          errors.push(`${at}.options[${optionIndex}].label: Required, at most ${FORM_LIMITS.labelLength}`)
        }
      })
    } else if (field.options && field.options.length > 0) {
      errors.push(`${at}.options: Only select fields have options`)
    }
  })

  const byKey = new Map(fields.map((field) => [field.key, field]))
  const emailField = byKey.get(fieldMapping?.email ?? '')
  if (!emailField) errors.push('fieldMapping.email: Pick the field that holds the email address')
  else {
    if (emailField.type !== 'email') errors.push('fieldMapping.email: Must be an email field')
    if (!emailField.required) errors.push('fieldMapping.email: The email field must be required')
  }
  if (fieldMapping?.name) {
    const nameField = byKey.get(fieldMapping.name)
    if (!nameField) errors.push('fieldMapping.name: No such field')
    else if (nameField.type !== 'text') errors.push('fieldMapping.name: Must be a text field')
  }
  if (fieldMapping?.subject) {
    const subjectField = byKey.get(fieldMapping.subject)
    if (!subjectField) errors.push('fieldMapping.subject: No such field')
    else if (subjectField.type !== 'text' && subjectField.type !== 'select') {
      errors.push('fieldMapping.subject: Must be a text or select field')
    }
  }
  return errors
}

/**
 * Plain text as submitted, made safe to store and show: NFC, no control
 * characters other than newline and tab, CRLF folded to LF. Values are never
 * rendered as HTML, so markup is kept verbatim as text.
 */
export function cleanFormText(value: string, multiline: boolean): string {
  const normalized = value.normalize('NFC').replace(/\r\n?/g, '\n')
  // eslint-disable-next-line no-control-regex
  const stripped = normalized.replace(multiline ? /[\u0000-\u0008\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, ' ')
  return stripped.trim()
}

export interface SubmissionFieldValue {
  key: string
  label: string
  type: FormFieldType
  /** As submitted: the option value for a select, `true`/`false` for a checkbox. */
  value: string | boolean
  /** As shown to agents: the option label for a select, "Yes"/"No" for a checkbox. */
  display: string
}

export interface ValidatedSubmission {
  values: SubmissionFieldValue[]
  email: string
  name: string | null
  subject: string | null
}

export interface SubmissionIssue {
  field: string
  message: string
}

export type SubmissionCheck = { ok: true; submission: ValidatedSubmission } | { ok: false; issues: SubmissionIssue[] }

/** Check submitted values against the form. Unknown keys are rejected so a mismatched integration fails loudly. */
export function validateFormSubmission(
  definition: FormDefinitionInput,
  input: Record<string, unknown>
): SubmissionCheck {
  const issues: SubmissionIssue[] = []
  const known = new Set(definition.fields.map((field) => field.key))
  for (const key of Object.keys(input)) {
    if (!known.has(key)) issues.push({ field: key, message: 'Unknown field' })
  }

  const values: SubmissionFieldValue[] = []
  for (const field of definition.fields) {
    const raw = input[field.key]
    const missing = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')

    if (field.type === 'checkbox') {
      if (raw !== undefined && raw !== null && typeof raw !== 'boolean') {
        issues.push({ field: field.key, message: 'Must be true or false' })
        continue
      }
      const checked = raw === true
      if (field.required && !checked) {
        issues.push({ field: field.key, message: 'Must be checked' })
        continue
      }
      values.push({
        key: field.key,
        label: field.label,
        type: field.type,
        value: checked,
        display: checked ? 'Yes' : 'No',
      })
      continue
    }

    if (missing) {
      if (field.required) issues.push({ field: field.key, message: 'Required' })
      continue
    }
    if (typeof raw !== 'string') {
      issues.push({ field: field.key, message: 'Must be a string' })
      continue
    }

    const multiline = field.type === 'textarea'
    const value = cleanFormText(raw, multiline)
    const max =
      field.type === 'textarea' ? FORM_LIMITS.textarea : field.type === 'email' ? FORM_LIMITS.email : FORM_LIMITS.text
    if (value.length > max) {
      issues.push({ field: field.key, message: `At most ${max} characters` })
      continue
    }
    if (value === '') {
      if (field.required) issues.push({ field: field.key, message: 'Required' })
      continue
    }

    if (field.type === 'email') {
      const email = value.toLowerCase()
      if (!isValidFormEmail(email)) {
        issues.push({ field: field.key, message: 'Not a valid email address' })
        continue
      }
      values.push({ key: field.key, label: field.label, type: field.type, value: email, display: email })
      continue
    }

    if (field.type === 'select') {
      const option = (field.options ?? []).find((candidate) => candidate.value === value)
      if (!option) {
        issues.push({ field: field.key, message: 'Not one of the options' })
        continue
      }
      values.push({ key: field.key, label: field.label, type: field.type, value: option.value, display: option.label })
      continue
    }

    values.push({ key: field.key, label: field.label, type: field.type, value, display: value })
  }

  if (issues.length > 0) return { ok: false, issues }

  const displayOf = (key: string | null) => (key ? (values.find((entry) => entry.key === key)?.display ?? null) : null)
  const email = displayOf(definition.fieldMapping.email)
  if (!email) return { ok: false, issues: [{ field: definition.fieldMapping.email, message: 'Required' }] }

  return {
    ok: true,
    submission: {
      values,
      email,
      // Display names go into the To header of replies: one line only.
      name: displayOf(definition.fieldMapping.name)?.replace(/\s+/g, ' ').slice(0, 200) || null,
      subject: displayOf(definition.fieldMapping.subject)?.replace(/\s+/g, ' ').slice(0, 300) || null,
    },
  }
}

export interface FormSubmissionMetadata {
  pageUrl?: string
  locale?: string
  brand?: string
  orderNumber?: string
  clientIp?: string
  userAgent?: string
  referrer?: string
  extra?: Record<string, string>
}

export const FORM_METADATA_LABELS: Record<Exclude<keyof FormSubmissionMetadata, 'extra'>, string> = {
  pageUrl: 'Page',
  locale: 'Locale',
  brand: 'Brand',
  orderNumber: 'Order number',
  clientIp: 'IP address',
  userAgent: 'User agent',
  referrer: 'Referrer',
}

/**
 * The message body agents and the quoted history of replies see: one
 * `Label: value` line per field, long text under its label.
 */
export function formatSubmissionText(formName: string, values: SubmissionFieldValue[]): string {
  const lines: string[] = [`Submitted via the "${formName}" form.`, '']
  for (const entry of values) {
    if (entry.type === 'textarea' || entry.display.includes('\n')) {
      lines.push(`${entry.label}:`, entry.display, '')
    } else {
      lines.push(`${entry.label}: ${entry.display}`)
    }
  }
  return lines.join('\n').trim()
}
