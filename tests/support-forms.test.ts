import { describe, expect, it } from 'vitest'
import {
  cleanFormText,
  formatSubmissionText,
  isValidFormEmail,
  normalizeOrigin,
  originAllowed,
  validateFormDefinition,
  validateFormSubmission,
  type FormDefinitionInput,
} from '../lib/support-forms'
import { formDefinitionSchema, toPathSegments } from '../server/services/support-forms/definition'

const definition: FormDefinitionInput = {
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: false },
    { key: 'email', label: 'Email', type: 'email', required: true },
    {
      key: 'subject',
      label: 'Subject',
      type: 'select',
      required: true,
      options: [
        { value: 'order', label: 'Order / Shipping' },
        { value: 'support', label: 'Technical Support' },
      ],
    },
    { key: 'message', label: 'Message', type: 'textarea', required: true },
    { key: 'terms', label: 'I accept the terms', type: 'checkbox', required: true },
    { key: 'newsletter', label: 'Newsletter', type: 'checkbox', required: false },
  ],
  fieldMapping: { email: 'email', name: 'name', subject: 'subject' },
}

describe('validateFormDefinition', () => {
  it('accepts a well-formed definition', () => {
    expect(validateFormDefinition(definition)).toEqual([])
  })

  it('needs fields and a required email field mapped to email', () => {
    expect(validateFormDefinition({ fields: [], fieldMapping: { email: '', name: null, subject: null } })).toEqual([
      'fields: Add at least one field',
    ])
    const optionalEmail = {
      fields: [{ key: 'email', label: 'Email', type: 'email' as const, required: false }],
      fieldMapping: { email: 'email', name: null, subject: null },
    }
    expect(validateFormDefinition(optionalEmail)).toContain('fieldMapping.email: The email field must be required')
    const textAsEmail = {
      fields: [{ key: 'email', label: 'Email', type: 'text' as const, required: true }],
      fieldMapping: { email: 'email', name: null, subject: null },
    }
    expect(validateFormDefinition(textAsEmail)).toContain('fieldMapping.email: Must be an email field')
  })

  it('rejects bad and duplicate keys, the honeypot key, and selects without options', () => {
    const problems = validateFormDefinition({
      fields: [
        { key: 'email', label: 'Email', type: 'email', required: true },
        { key: 'Bad Key', label: 'x', type: 'text', required: false },
        { key: 'email', label: 'Again', type: 'text', required: false },
        { key: '_hp', label: 'Trap', type: 'text', required: false },
        { key: 'topic', label: 'Topic', type: 'select', required: false, options: [] },
        {
          key: 'dupes',
          label: 'Dupes',
          type: 'select',
          required: false,
          options: [
            { value: 'a', label: 'A' },
            { value: 'a', label: 'A again' },
          ],
        },
        { key: 'note', label: 'Note', type: 'text', required: false, options: [{ value: 'x', label: 'X' }] },
      ],
      fieldMapping: { email: 'email', name: 'topic', subject: 'note' },
    })
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^fields\[1\]\.key:/),
        'fields[2].key: "email" is used twice',
        expect.stringMatching(/^fields\[3\]\.key:/),
        'fields[4].options: A select needs at least one option',
        'fields[5].options[1].value: "a" is used twice',
        'fields[6].options: Only select fields have options',
        'fieldMapping.name: Must be a text field',
      ])
    )
  })
})

describe('validateFormSubmission', () => {
  const valid = {
    name: '  Kari\nNordmann ',
    email: ' Kari@Example.COM ',
    subject: 'support',
    message: 'Hello\r\n<script>alert(1)</script>\u0000',
    terms: true,
  }

  it('cleans values and resolves the mapped contact and subject', () => {
    const result = validateFormSubmission(definition, valid)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.submission.email).toBe('kari@example.com')
    // Single-line: a newline cannot reach a To display name.
    expect(result.submission.name).toBe('Kari Nordmann')
    expect(result.submission.subject).toBe('Technical Support')
    const message = result.submission.values.find((value) => value.key === 'message')
    expect(message?.display).toBe('Hello\n<script>alert(1)</script>')
    const newsletter = result.submission.values.find((value) => value.key === 'newsletter')
    expect(newsletter).toMatchObject({ value: false, display: 'No' })
  })

  it('reports every problem at once', () => {
    const result = validateFormSubmission(definition, {
      email: 'nope',
      subject: 'refund',
      message: 5,
      terms: false,
      newsletter: 'yes',
      surprise: 'x',
    })
    expect(result).toEqual({
      ok: false,
      issues: [
        { field: 'surprise', message: 'Unknown field' },
        { field: 'email', message: 'Not a valid email address' },
        { field: 'subject', message: 'Not one of the options' },
        { field: 'message', message: 'Must be a string' },
        { field: 'terms', message: 'Must be checked' },
        { field: 'newsletter', message: 'Must be true or false' },
      ],
    })
  })

  it('rejects addresses that could inject headers', () => {
    for (const email of [
      'a@b.c\r\nBcc: x@y.z',
      'a b@c.d',
      '<a@b.c>',
      'a@b',
      'a@b.c,d@e.f',
      'a@b..c',
      'a@b.c.',
      'a@.b.c',
    ]) {
      const result = validateFormSubmission(definition, { ...valid, email })
      expect(result.ok, email).toBe(false)
    }
  })

  it('enforces per-type lengths', () => {
    const tooLong = validateFormSubmission(definition, { ...valid, message: 'x'.repeat(10_001) })
    expect(tooLong).toEqual({ ok: false, issues: [{ field: 'message', message: 'At most 10000 characters' }] })
  })

  it('treats whitespace-only and control-only values as missing', () => {
    const result = validateFormSubmission(definition, { ...valid, message: ' \u0000 \n ' })
    expect(result).toEqual({ ok: false, issues: [{ field: 'message', message: 'Required' }] })
  })
})

describe('formatSubmissionText', () => {
  it('lays fields out as label: value, long text under its label', () => {
    const result = validateFormSubmission(definition, {
      email: 'a@b.co',
      subject: 'order',
      message: 'Line one\nLine two',
      terms: true,
    })
    if (!result.ok) throw new Error('expected valid')
    expect(formatSubmissionText('Contact', result.submission.values)).toBe(
      [
        'Submitted via the "Contact" form.',
        '',
        'Email: a@b.co',
        'Subject: Order / Shipping',
        'Message:',
        'Line one',
        'Line two',
        '',
        'I accept the terms: Yes',
        'Newsletter: No',
      ].join('\n')
    )
  })
})

describe('origins', () => {
  it('normalizes origins and rejects paths and other schemes', () => {
    expect(normalizeOrigin(' HTTPS://Shop.Example.com/ ')).toBe('https://shop.example.com')
    expect(normalizeOrigin('http://localhost:3000')).toBe('http://localhost:3000')
    expect(normalizeOrigin('https://*.example.com')).toBe('https://*.example.com')
    expect(normalizeOrigin('https://example.com/contact')).toBeNull()
    expect(normalizeOrigin('ftp://example.com')).toBeNull()
    expect(normalizeOrigin('example.com')).toBeNull()
  })

  it('matches exact origins and subdomain wildcards only', () => {
    const allowed = ['https://shop.example.com', 'https://*.brand.test']
    expect(originAllowed('https://shop.example.com', allowed)).toBe(true)
    expect(originAllowed('https://SHOP.example.com', allowed)).toBe(true)
    expect(originAllowed('http://shop.example.com', allowed)).toBe(false)
    expect(originAllowed('https://shop.example.com:8443', allowed)).toBe(false)
    expect(originAllowed('https://www.brand.test', allowed)).toBe(true)
    expect(originAllowed('https://a.b.brand.test', allowed)).toBe(true)
    expect(originAllowed('https://brand.test', allowed)).toBe(false)
    expect(originAllowed('https://evilbrand.test', allowed)).toBe(false)
    expect(originAllowed('https://www.brand.test:8443', allowed)).toBe(false)
    expect(originAllowed(null, allowed)).toBe(false)
    expect(originAllowed('null', allowed)).toBe(false)
  })
})

describe('cleanFormText', () => {
  it('folds CRLF, drops control characters and normalizes to NFC', () => {
    expect(cleanFormText('a\r\nb\rc\u0007', true)).toBe('a\nb\nc')
    expect(cleanFormText('a\nb', false)).toBe('a b')
    expect(cleanFormText('é', false)).toBe('é')
  })
})

describe('formDefinitionSchema', () => {
  const body = {
    name: 'Contact',
    slug: 'contact',
    inboxId: 'inbox-1',
    fields: definition.fields,
    fieldMapping: definition.fieldMapping,
  }

  it('applies defaults and normalizes origins', () => {
    const parsed = formDefinitionSchema.parse({
      ...body,
      allowedOrigins: ['https://Shop.example.com/', 'https://shop.example.com'],
    })
    expect(parsed).toMatchObject({
      autoReplyMode: 'inbox',
      autoReplyTemplate: null,
      browserSubmissionsEnabled: false,
      isEnabled: true,
      allowedOrigins: ['https://shop.example.com'],
    })
    // Options are kept on selects only.
    expect(parsed.fields.find((field) => field.key === 'message')).not.toHaveProperty('options')
  })

  it('reports definition problems, bad origins, missing origins and a missing custom reply', () => {
    const result = formDefinitionSchema.safeParse({
      ...body,
      slug: 'Not A Slug',
      fieldMapping: { email: 'name' },
      allowedOrigins: ['shop.example.com'],
      autoReplyMode: 'custom',
    })
    expect(result.success).toBe(false)
    const paths = result.error!.issues.map((issue) => issue.path.join('.'))
    expect(paths).toEqual(
      expect.arrayContaining(['slug', 'fieldMapping.email', 'allowedOrigins.0', 'autoReplyTemplate'])
    )

    const noOrigins = formDefinitionSchema.safeParse({ ...body, browserSubmissionsEnabled: true })
    expect(noOrigins.success).toBe(false)
    expect(noOrigins.error!.issues[0].path).toEqual(['allowedOrigins'])
  })
})

describe('review hardening', () => {
  it('rejects empty dot-separated parts in the local part too', () => {
    for (const email of ['.a@b.co', 'a.@b.co', 'a..b@c.com']) {
      expect(isValidFormEmail(email), email).toBe(false)
    }
    expect(isValidFormEmail('first.last+tag@shop.example.com')).toBe(true)
  })

  it('strips C1 control characters', () => {
    expect(cleanFormText('a\u0085b\u009bc', true)).toBe('a b c')
  })

  it('handles long runs of slashes in origins quickly and refuses over-long entries', () => {
    expect(normalizeOrigin(`https://shop.example.com${'/'.repeat(250)}`)).toBe('https://shop.example.com')
    expect(normalizeOrigin('/'.repeat(100_000))).toBeNull()
  })

  it('turns helper paths into Zod path segments', () => {
    expect(toPathSegments('fields[2].options[1].value')).toEqual(['fields', 2, 'options', 1, 'value'])
    expect(toPathSegments('fieldMapping.email')).toEqual(['fieldMapping', 'email'])
  })

  it('stores option values in the canonical form submissions are matched in', () => {
    const parsed = formDefinitionSchema.parse({
      name: 'Contact',
      slug: 'contact',
      inboxId: 'inbox-1',
      fields: [
        { key: 'email', label: 'Email', type: 'email', required: true },
        {
          key: 'topic',
          label: 'Topic',
          type: 'select',
          required: true,
          options: [{ value: 'cafe\u0301\u0007', label: 'Café' }],
        },
      ],
      fieldMapping: { email: 'email' },
    })
    const topic = parsed.fields.find((field) => field.key === 'topic')!
    expect(topic.options).toEqual([{ value: 'café', label: 'Café' }])
    const result = validateFormSubmission(parsed, { email: 'a@b.co', topic: 'cafe\u0301' })
    expect(result.ok).toBe(true)
  })

  it('reports nested definition problems with structured paths', () => {
    const result = formDefinitionSchema.safeParse({
      name: 'Contact',
      slug: 'contact',
      inboxId: 'inbox-1',
      fields: [
        { key: 'email', label: 'Email', type: 'email', required: true },
        { key: 'email', label: 'Again', type: 'text', required: false },
      ],
      fieldMapping: { email: 'email' },
    })
    expect(result.error!.issues.map((issue) => issue.path)).toContainEqual(['fields', 1, 'key'])
  })
})
