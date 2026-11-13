/**
 * Request validation for creating and editing form definitions (admin API).
 * The structural rules live in `lib/support-forms.ts` so the editor shows the
 * same messages before saving.
 */
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import {
  FORM_AUTO_REPLY_MODES,
  FORM_FIELD_TYPES,
  FORM_LIMITS,
  FORM_SLUG_PATTERN,
  normalizeOrigin,
  validateFormDefinition,
} from '~/lib/support-forms'

const fieldSchema = z.object({
  key: z.string().trim().min(1).max(FORM_LIMITS.keyLength),
  label: z.string().trim().min(1).max(FORM_LIMITS.labelLength),
  type: z.enum(FORM_FIELD_TYPES),
  required: z.boolean().default(false),
  options: z
    .array(
      z.object({
        value: z.string().trim().min(1).max(FORM_LIMITS.optionValueLength),
        label: z.string().trim().min(1).max(FORM_LIMITS.labelLength),
      })
    )
    .max(FORM_LIMITS.options)
    .optional(),
})

export const formDefinitionSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(80),
    slug: z.string().trim().min(1).max(60).regex(FORM_SLUG_PATTERN, 'Use lowercase letters, digits and hyphens'),
    inboxId: z.string().min(1, 'Pick an inbox'),
    fields: z.array(fieldSchema).min(1).max(FORM_LIMITS.fields),
    fieldMapping: z.object({
      email: z.string().min(1),
      name: z.string().min(1).nullable().default(null),
      subject: z.string().min(1).nullable().default(null),
    }),
    autoReplyMode: z.enum(FORM_AUTO_REPLY_MODES).default('inbox'),
    autoReplyTemplate: z.string().max(FORM_LIMITS.autoReplyLength).nullable().default(null),
    allowedOrigins: z.array(z.string()).max(FORM_LIMITS.allowedOrigins).default([]),
    browserSubmissionsEnabled: z.boolean().default(false),
    isEnabled: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    for (const problem of validateFormDefinition({ fields: value.fields, fieldMapping: value.fieldMapping })) {
      const [path, ...rest] = problem.split(': ')
      ctx.addIssue({ code: 'custom', path: [path], message: rest.join(': ') })
    }
    value.allowedOrigins.forEach((origin, index) => {
      if (!normalizeOrigin(origin)) {
        ctx.addIssue({
          code: 'custom',
          path: ['allowedOrigins', index],
          message: `"${origin}" is not an origin like https://shop.example.com`,
        })
      }
    })
    if (value.browserSubmissionsEnabled && value.allowedOrigins.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['allowedOrigins'],
        message: 'Add at least one allowed origin to accept browser submissions',
      })
    }
    if (value.autoReplyMode === 'custom' && !value.autoReplyTemplate?.trim()) {
      ctx.addIssue({ code: 'custom', path: ['autoReplyTemplate'], message: 'Write the auto-reply' })
    }
  })
  .transform((value) => ({
    ...value,
    fields: value.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required,
      ...(field.type === 'select' ? { options: field.options ?? [] } : {}),
    })),
    allowedOrigins: [...new Set(value.allowedOrigins.map((origin) => normalizeOrigin(origin) as string))],
    autoReplyTemplate: value.autoReplyTemplate?.trim() || null,
  }))

export type FormDefinitionBody = z.output<typeof formDefinitionSchema>

export function generateFormPublicId(): string {
  return `frm_${randomBytes(12).toString('base64url')}`
}
