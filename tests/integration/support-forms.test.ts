import { randomUUID } from 'node:crypto'
import * as h3 from 'h3'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Website forms through the real HTTP routes and a real database: the server
 * API (`/api/v1/forms/{slug}/submissions`) and the browser endpoint
 * (`/api/public/forms/{publicId}/submissions`) are mounted on an h3 router and
 * called with real Requests. Mocked: realtime, the outbound worker pass, the
 * sender policy, the automation trigger (spied, to see that a submission fires
 * `conversation_created`), and, for the inbox-delete case only, `requireAuth`
 * and `requireInboxRole` (inbox-admin authorization has its own suite in
 * tests/support-route-authorization.test.ts).
 */

// Nitro auto-imports h3's helpers as globals; the route files rely on that.
for (const [name, value] of Object.entries(h3)) vi.stubGlobal(name, value)

const automation = vi.hoisted(() => ({ triggerAutomationEvent: vi.fn(async () => undefined) }))
vi.mock('~/server/utils/automation-engine', () => automation)
vi.mock('~/server/utils/support-realtime', () => ({ publishConversationEvent: async () => undefined }))
// Only the inbox-delete route below authenticates; it runs as an inbox admin.
vi.mock('~/server/utils/auth-middleware', () => ({ requireAuth: async () => ({ user: { id: 'user-forms' } }) }))
vi.mock('~/server/utils/support-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/server/utils/support-access')>()),
  requireInboxRole: async () => undefined,
}))
vi.mock('~/server/utils/sender-enforcement', () => ({ isSenderAllowedOrRecordBlock: async () => true }))
vi.mock('~/server/utils/outbound-delivery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/server/utils/outbound-delivery')>()),
  runOutboundDeliveryWorker: async () => undefined,
}))

const { db } = await import('../../server/database/drizzle')
const { organization } = await import('../../server/database/schema/auth')
const { project, product, projectApiKey } = await import('../../server/database/schema/feedback')
const {
  contact,
  conversation,
  conversationMessage,
  slaPolicy,
  slaTarget,
  supportForm,
  supportFormSubmission,
  supportInbox,
  supportOutboundDelivery,
} = await import('../../server/database/schema/support')
const { generateAppKey } = await import('../../server/utils/app-keys')
const serverRoute = (await import('../../server/api/v1/forms/[formSlug]/submissions.post')).default
const browserRoute = (await import('../../server/api/public/forms/[publicId]/submissions.post')).default
const preflightRoute = (await import('../../server/api/public/forms/[publicId]/submissions.options')).default
const inboxDeleteRoute = (await import('../../server/api/support/inboxes/[id].delete')).default

const router = h3.createRouter()
router.post('/api/v1/forms/:formSlug/submissions', serverRoute)
router.post('/api/public/forms/:publicId/submissions', browserRoute)
router.options('/api/public/forms/:publicId/submissions', preflightRoute)
router.delete('/api/support/inboxes/:id', inboxDeleteRoute)
const app = h3.createApp()
app.use(router)
const handle = h3.toWebHandler(app)

const runId = randomUUID().slice(0, 8)
const orgId = `org_forms_${runId}`
const projectId = `project_forms_${runId}`
const otherProjectId = `project_forms_other_${runId}`
const inboxId = `inbox_forms_${runId}`
const offInboxId = `inbox_forms_off_${runId}`
const otherInboxId = `inbox_forms_other_${runId}`
const inboxAddress = `support-${runId}@shop.example.test`
const ORIGIN = 'https://shop.example.test'
const publicId = `frm_public_${runId}`
const now = new Date()

const keys = { server: '', other: '', revoked: '', app: '' }
let ipCounter = 0
/** A fresh caller IP per request unless a test wants to share one, so buckets never leak between tests. */
const nextIp = () => `198.51.100.${(ipCounter++ % 250) + 1}-${runId}`

const contactFields = [
  { key: 'name', label: 'Name', type: 'text', required: true },
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
  { key: 'newsletter', label: 'Subscribe me', type: 'checkbox', required: false },
] as const

function formRow(overrides: Partial<typeof supportForm.$inferInsert> & { id: string; slug: string }) {
  return {
    projectId,
    inboxId,
    name: 'Contact',
    publicId: `frm_${overrides.id}`,
    fields: contactFields.map((field) => ({ ...field, options: 'options' in field ? [...field.options] : undefined })),
    fieldMapping: { email: 'email', name: 'name', subject: 'subject' },
    autoReplyMode: 'inbox',
    autoReplyTemplate: null,
    allowedOrigins: [],
    browserSubmissionsEnabled: false,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function validFields(email = `customer-${randomUUID().slice(0, 6)}@buyer.example.test`) {
  return {
    name: 'Kari Nordmann',
    email,
    subject: 'support',
    message: 'My <b>dot x</b> will not boot.\r\nIt blinks red.',
  }
}

interface CallOptions {
  key?: string | null
  idempotencyKey?: string
  ip?: string
  body?: unknown
  rawBody?: string
  contentType?: string
  origin?: string | null
  method?: string
}

async function call(path: string, options: CallOptions = {}) {
  const headers: Record<string, string> = {
    'content-type': options.contentType ?? 'application/json',
    'x-forwarded-for': options.ip ?? nextIp(),
  }
  if (options.key) headers.authorization = `Bearer ${options.key}`
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey
  if (options.origin) headers.origin = options.origin
  const response = await handle(
    new Request(`http://veerify.test${path}`, {
      method: options.method ?? 'POST',
      headers,
      ...(options.method === 'OPTIONS' || options.method === 'DELETE'
        ? {}
        : { body: options.rawBody ?? JSON.stringify(options.body ?? { fields: validFields() }) }),
    })
  )
  const text = await response.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: response.status, headers: response.headers, json }
}

const submit = (slug: string, options: CallOptions = {}) =>
  call(`/api/v1/forms/${slug}/submissions`, { key: keys.server, ...options })
const submitFromBrowser = (id: string, options: CallOptions = {}) =>
  call(`/api/public/forms/${id}/submissions`, { origin: ORIGIN, ...options })

const errorCode = (json: any) => json?.data?.error?.code

async function messagesOf(conversationId: string) {
  return db.select().from(conversationMessage).where(eq(conversationMessage.conversationId, conversationId))
}

async function conversationsFor(email: string) {
  const [row] = await db
    .select({ id: contact.id })
    .from(contact)
    .where(and(eq(contact.projectId, projectId), eq(contact.email, email)))
  if (!row) return []
  return db.select().from(conversation).where(eq(conversation.contactId, row.id))
}

async function insertKey(kind: 'server' | 'app', projectRef: string, revoked = false) {
  const { key, keyPrefix, keyHash } = generateAppKey(kind)
  await db.insert(projectApiKey).values({
    id: randomUUID(),
    projectId: projectRef,
    kind,
    productId: kind === 'app' ? `product_forms_${runId}` : null,
    name: `${kind} key`,
    keyPrefix,
    keyHash,
    createdAt: now,
    revokedAt: revoked ? now : null,
  })
  return key
}

beforeAll(async () => {
  await db.insert(organization).values({ id: orgId, name: 'Forms Org', slug: `forms-org-${runId}` })
  await db.insert(project).values([
    {
      id: projectId,
      name: 'Shop',
      slug: `forms-shop-${runId}`,
      organizationId: orgId,
      settings: { supportEnabled: true },
    },
    {
      id: otherProjectId,
      name: 'Other',
      slug: `forms-other-${runId}`,
      organizationId: orgId,
      settings: { supportEnabled: true },
    },
  ])
  await db.insert(product).values({ id: `product_forms_${runId}`, projectId, name: 'Shop', slug: `shop-${runId}` })
  await db.insert(supportInbox).values([
    {
      id: inboxId,
      projectId,
      name: 'Support',
      slug: `support-${runId}`,
      emailAddress: inboxAddress,
      autoReplyEnabled: true,
      autoReplyTemplate: 'Thanks, we got your message.',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: otherInboxId,
      projectId: otherProjectId,
      name: 'Other',
      slug: `other-${runId}`,
      emailAddress: `other-${runId}@shop.example.test`,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: offInboxId,
      projectId,
      name: 'Off',
      slug: `off-${runId}`,
      emailAddress: `off-${runId}@shop.example.test`,
      isEnabled: false,
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(slaPolicy).values({
    id: `sla_forms_${runId}`,
    projectId,
    name: 'Default',
    conditions: {},
    escalation: {},
    isDefault: true,
  })
  await db.insert(slaTarget).values({
    id: `sla_target_forms_${runId}`,
    slaPolicyId: `sla_forms_${runId}`,
    metric: 'first_response',
    priority: null,
    targetMinutes: 60,
  })
  await db.insert(supportForm).values([
    formRow({ id: `form_contact_${runId}`, slug: 'contact' }),
    formRow({ id: `form_disabled_${runId}`, slug: 'disabled', isEnabled: false }),
    formRow({ id: `form_offinbox_${runId}`, slug: 'off-inbox', inboxId: offInboxId }),
    formRow({
      id: `form_custom_${runId}`,
      slug: 'custom-reply',
      autoReplyMode: 'custom',
      autoReplyTemplate: 'Custom form thanks.',
    }),
    formRow({ id: `form_noreply_${runId}`, slug: 'no-reply', autoReplyMode: 'off' }),
    formRow({ id: `form_limited_${runId}`, slug: 'limited' }),
    formRow({
      id: `form_proto_${runId}`,
      slug: 'proto',
      autoReplyMode: 'off',
      fields: [
        { key: 'email', label: 'Email', type: 'email', required: true },
        { key: 'constructor', label: 'Built by', type: 'text', required: false },
      ],
      fieldMapping: { email: 'email', name: null, subject: null },
    }),
    formRow({
      id: `form_browser_${runId}`,
      slug: 'browser',
      publicId,
      allowedOrigins: [ORIGIN, 'https://*.brand.example.test'],
      browserSubmissionsEnabled: true,
    }),
    formRow({
      id: `form_browser_off_${runId}`,
      slug: 'browser-off',
      allowedOrigins: [ORIGIN],
      browserSubmissionsEnabled: false,
    }),
    formRow({
      id: `form_other_${runId}`,
      projectId: otherProjectId,
      inboxId: otherInboxId,
      slug: 'other-contact',
    }),
  ])
  keys.server = await insertKey('server', projectId)
  keys.other = await insertKey('server', otherProjectId)
  keys.revoked = await insertKey('server', projectId, true)
  keys.app = await insertKey('app', projectId)
})

beforeEach(() => {
  automation.triggerAutomationEvent.mockClear()
})

afterAll(async () => {
  const conversations = await db
    .select({ id: conversation.id })
    .from(conversation)
    .where(inArray(conversation.projectId, [projectId, otherProjectId]))
  if (conversations.length > 0) {
    const messageIds = await db
      .select({ id: conversationMessage.id })
      .from(conversationMessage)
      .where(
        inArray(
          conversationMessage.conversationId,
          conversations.map((row) => row.id)
        )
      )
    if (messageIds.length > 0) {
      await db.delete(supportOutboundDelivery).where(
        inArray(
          supportOutboundDelivery.messageId,
          messageIds.map((row) => row.id)
        )
      )
    }
  }
  await db.delete(supportForm).where(inArray(supportForm.projectId, [projectId, otherProjectId]))
  await db.delete(organization).where(eq(organization.id, orgId))
})

describe('server API: authentication', () => {
  it('rejects a missing, app, revoked or unknown key with 401', async () => {
    for (const key of [null, keys.app, keys.revoked, 'vfy_srv_not-a-real-key']) {
      const response = await submit('contact', { key })
      expect(response.status).toBe(401)
      expect(errorCode(response.json)).toBe('UNAUTHORIZED')
    }
  })

  it("only reaches the key's own project: another project's form is 404", async () => {
    expect((await submit('other-contact')).status).toBe(404)
    const own = await submit('other-contact', { key: keys.other })
    expect(own.status).toBe(201)
  })

  it('404s an unknown slug with FORM_NOT_FOUND', async () => {
    const response = await submit('nope')
    expect(response.status).toBe(404)
    expect(errorCode(response.json)).toBe('FORM_NOT_FOUND')
  })
})

describe('server API: validation', () => {
  it('lists unknown, missing and invalid fields', async () => {
    const response = await submit('contact', {
      body: {
        fields: { email: 'not-an-email', subject: 'refund', message: '   ', newsletter: 'yes', extra: 'x' },
      },
    })
    expect(response.status).toBe(400)
    expect(errorCode(response.json)).toBe('VALIDATION_ERROR')
    const byField = Object.fromEntries(
      (response.json.data.error.details as { field: string; message: string }[]).map((issue) => [
        issue.field,
        issue.message,
      ])
    )
    expect(byField).toEqual({
      extra: 'Unknown field',
      name: 'Required',
      email: 'Not a valid email address',
      subject: 'Not one of the options',
      message: 'Required',
      newsletter: 'Must be true or false',
    })
  })

  it('rejects unknown top-level and metadata keys, and bad JSON', async () => {
    expect((await submit('contact', { body: { fields: validFields(), other: 1 } })).status).toBe(400)
    expect((await submit('contact', { body: { fields: validFields(), metadata: { color: 'red' } } })).status).toBe(400)
    expect((await submit('contact', { rawBody: '{"fields":' })).status).toBe(400)
  })

  it('refuses a body over 64 KiB with 413', async () => {
    const response = await submit('contact', {
      body: { fields: { ...validFields(), message: 'x'.repeat(70 * 1024) } },
    })
    expect(response.status).toBe(413)
  })

  it('rejects an over-long value', async () => {
    const response = await submit('contact', { body: { fields: { ...validFields(), name: 'n'.repeat(501) } } })
    expect(response.status).toBe(400)
    expect(response.json.data.error.details).toEqual([{ field: 'name', message: 'At most 500 characters' }])
  })

  it('refuses a disabled form and a form whose inbox is off with 403', async () => {
    const disabled = await submit('disabled')
    expect(disabled.status).toBe(403)
    expect(errorCode(disabled.json)).toBe('FORM_DISABLED')
    const offInbox = await submit('off-inbox')
    expect(offInbox.status).toBe(403)
    expect(errorCode(offInbox.json)).toBe('INBOX_UNAVAILABLE')
  })
})

describe('server API: filing into the inbox', () => {
  it('opens a helpdesk conversation from the submitter, like an inbound email', async () => {
    const email = `kari-${runId}@buyer.example.test`
    const response = await submit('contact', {
      body: {
        fields: { ...validFields(email), email: email.toUpperCase(), newsletter: true },
        metadata: {
          pageUrl: 'https://shop.example.test/contact',
          locale: 'nb-NO',
          brand: 'dotmatrixlabs',
          orderNumber: 'DML-1042',
          clientIp: '203.0.113.9',
          userAgent: 'Mozilla/5.0',
          extra: { cart: '3 items' },
        },
      },
    })

    expect(response.status).toBe(201)
    const { id, conversationId } = response.json.data
    expect(id).toEqual(expect.any(String))

    const [row] = await db.select().from(conversation).where(eq(conversation.id, conversationId))
    expect(row).toMatchObject({
      inboxId,
      projectId,
      subject: 'Technical Support',
      status: 'open',
      behaviour: 'helpdesk',
      mailAddressId: null,
      spamAt: null,
    })
    expect(row.firstResponseDueAt).toBeInstanceOf(Date)
    expect(row.channelThreadKey).toBe(`form-${id}@shop.example.test`)
    expect(row.metadata).toEqual({ formSubmission: { formId: `form_contact_${runId}`, submissionId: id } })

    const [person] = await db.select().from(contact).where(eq(contact.id, row.contactId))
    expect(person).toMatchObject({ email, name: 'Kari Nordmann' })

    const messages = await messagesOf(conversationId)
    const incoming = messages.find((message) => message.kind === 'incoming')!
    expect(incoming.bodyHtml).toBeNull()
    expect(incoming.senderContactId).toBe(row.contactId)
    // Markup stays text; CRLF is folded.
    expect(incoming.body).toBe(
      [
        'Submitted via the "Contact" form.',
        '',
        'Name: Kari Nordmann',
        `Email: ${email}`,
        'Subject: Technical Support',
        'Message:',
        'My <b>dot x</b> will not boot.\nIt blinks red.',
        '',
        'Subscribe me: Yes',
      ].join('\n')
    )
    expect(incoming.metadata?.formSubmission).toMatchObject({
      submissionId: id,
      formName: 'Contact',
      source: 'api',
      metadata: {
        pageUrl: 'https://shop.example.test/contact',
        locale: 'nb-NO',
        brand: 'dotmatrixlabs',
        orderNumber: 'DML-1042',
        clientIp: '203.0.113.9',
        userAgent: 'Mozilla/5.0',
        extra: { cart: '3 items' },
      },
    })
    expect(incoming.metadata?.formSubmission.fields[2]).toEqual({
      key: 'subject',
      label: 'Subject',
      type: 'select',
      display: 'Technical Support',
    })

    // The inbox's auto-reply goes to the submitter through the outbox, threaded on the submission.
    const autoReply = messages.find((message) => message.kind === 'outgoing')!
    expect(autoReply.body).toBe('Thanks, we got your message.')
    expect(autoReply.inReplyTo).toBe(`form-${id}@shop.example.test`)
    const [delivery] = await db
      .select()
      .from(supportOutboundDelivery)
      .where(eq(supportOutboundDelivery.messageId, autoReply.id))
    expect(delivery.payload).toMatchObject({ to: email, from: { address: inboxAddress } })

    expect(automation.triggerAutomationEvent).toHaveBeenCalledWith({ conversationId, trigger: 'conversation_created' })

    const [submission] = await db.select().from(supportFormSubmission).where(eq(supportFormSubmission.id, id))
    expect(submission).toMatchObject({ conversationId, source: 'api', messageId: incoming.id })
  })

  it('never puts submitted text in the auto-reply, which goes to whatever address was typed in', async () => {
    const email = `relay-${runId}@victim.example.test`
    const response = await submit('contact', {
      body: {
        fields: {
          name: 'Your bank',
          email,
          subject: 'support',
          message: 'Your account is locked, log in at http://phish.example.test',
        },
      },
    })
    const [autoReply] = (await messagesOf(response.json.data.conversationId)).filter((m) => m.kind === 'outgoing')
    const [delivery] = await db
      .select()
      .from(supportOutboundDelivery)
      .where(eq(supportOutboundDelivery.messageId, autoReply.id))
    const payload = delivery.payload as { subject: string; text: string; html: string }
    expect(payload.subject).toBe('Re: Contact')
    for (const part of [payload.text, payload.html]) {
      expect(part).not.toContain('phish')
      expect(part).not.toContain('Your bank')
    }
    expect(payload.text).toContain('Thanks, we got your message.')
  })

  it('reuses the contact but opens a new conversation for every submission', async () => {
    const email = `repeat-${runId}@buyer.example.test`
    const first = await submit('no-reply', { body: { fields: validFields(email) } })
    const second = await submit('no-reply', { body: { fields: validFields(email) } })
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(second.json.data.conversationId).not.toBe(first.json.data.conversationId)
    expect(await conversationsFor(email)).toHaveLength(2)
  })

  it("uses the form's own auto-reply, or none", async () => {
    const custom = await submit('custom-reply')
    const customReplies = (await messagesOf(custom.json.data.conversationId)).filter((m) => m.kind === 'outgoing')
    expect(customReplies.map((m) => m.body)).toEqual(['Custom form thanks.'])

    const none = await submit('no-reply')
    const noneReplies = (await messagesOf(none.json.data.conversationId)).filter((m) => m.kind === 'outgoing')
    expect(noneReplies).toEqual([])
  })
})

describe('server API: edge cases', () => {
  it('treats an omitted field named like an Object.prototype member as missing', async () => {
    const response = await submit('proto', { body: { fields: { email: `proto-${runId}@buyer.example.test` } } })
    expect(response.status).toBe(201)
  })
})

describe('database guards', () => {
  it("refuses a form pointing at another project's inbox", async () => {
    await expect(
      db.insert(supportForm).values(formRow({ id: `form_cross_${runId}`, slug: 'cross', projectId: otherProjectId }))
    ).rejects.toThrow()
  })

  it('still deletes a whole project whose inbox has forms', async () => {
    const id = `proj_delete_${runId}`
    await db.insert(project).values({ id, name: 'Gone', slug: `gone-${runId}`, organizationId: orgId })
    await db.insert(supportInbox).values({ id, projectId: id, name: 'Gone', slug: `gone-${runId}` })
    await db.insert(supportForm).values(formRow({ id, slug: 'gone', projectId: id, inboxId: id }))
    await db.delete(project).where(eq(project.id, id))
    expect(await db.select().from(supportForm).where(eq(supportForm.id, id))).toEqual([])
  })

  it('refuses deleting an inbox that a form delivers to, and keeps the form', async () => {
    const response = await call(`/api/support/inboxes/${inboxId}`, { method: 'DELETE' })
    expect(response.status).toBe(409)
    expect(response.json.data.error.message).toContain('form')
    const [form] = await db
      .select()
      .from(supportForm)
      .where(eq(supportForm.id, `form_contact_${runId}`))
    expect(form).toBeTruthy()
  })
})

describe('server API: idempotency', () => {
  it('answers a retry with the first result and files once', async () => {
    const email = `idem-${runId}@buyer.example.test`
    const body = { fields: validFields(email) }
    const first = await submit('no-reply', { body, idempotencyKey: `order-${runId}` })
    // Same body, different key order.
    const reordered = { fields: Object.fromEntries(Object.entries(body.fields).reverse()) }
    const retry = await submit('no-reply', { body: reordered, idempotencyKey: `order-${runId}` })

    expect(first.status).toBe(201)
    expect(retry.status).toBe(200)
    expect(retry.headers.get('idempotent-replayed')).toBe('true')
    expect(retry.json.data).toEqual(first.json.data)
    expect(await conversationsFor(email)).toHaveLength(1)
  })

  it('files once when the same key races', async () => {
    const email = `race-${runId}@buyer.example.test`
    const body = { fields: validFields(email) }
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => submit('no-reply', { body, idempotencyKey: `race-${runId}` }))
    )
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 200, 201])
    expect(new Set(responses.map((response) => response.json.data.conversationId)).size).toBe(1)
    expect(await conversationsFor(email)).toHaveLength(1)
  })

  it('keeps browser and server keys apart', async () => {
    const key = `shared-${runId}`
    const browser = await submitFromBrowser(publicId, { idempotencyKey: key })
    expect(browser.status).toBe(201)
    const server = await submit('browser', { idempotencyKey: key })
    expect(server.status).toBe(201)
    expect(server.json.data.id).not.toBe(browser.json.data.id)
  })

  it('replays a filed submission even after the form is switched off', async () => {
    const formId = `form_replay_${runId}`
    await db.insert(supportForm).values(formRow({ id: formId, slug: 'replay', autoReplyMode: 'off' }))
    const body = { fields: validFields() }
    const first = await submit('replay', { body, idempotencyKey: `replay-${runId}` })
    expect(first.status).toBe(201)
    await db.update(supportForm).set({ isEnabled: false }).where(eq(supportForm.id, formId))
    const retry = await submit('replay', { body, idempotencyKey: `replay-${runId}` })
    expect(retry.status).toBe(200)
    expect(retry.json.data).toEqual(first.json.data)
    expect((await submit('replay')).status).toBe(403)
  })

  it('422s a reused key with a different body', async () => {
    await submit('no-reply', { idempotencyKey: `reuse-${runId}` })
    const reused = await submit('no-reply', { idempotencyKey: `reuse-${runId}` })
    expect(reused.status).toBe(422)
    expect(errorCode(reused.json)).toBe('IDEMPOTENCY_KEY_REUSED')
  })

  it('400s a malformed key', async () => {
    expect((await submit('no-reply', { idempotencyKey: 'x'.repeat(256) })).status).toBe(400)
  })
})

describe('server API: rate limiting', () => {
  it('limits one visitor IP per form to 10 submissions in 10 minutes', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      const response = await submit('limited', {
        body: { fields: validFields(), metadata: { clientIp: `203.0.113.77-${runId}` } },
      })
      statuses.push(response.status)
    }
    expect(statuses.slice(0, 10).every((status) => status === 201)).toBe(true)
    expect(statuses[10]).toBe(429)
    // Another visitor is unaffected.
    const other = await submit('limited', { body: { fields: validFields(), metadata: { clientIp: '203.0.113.78' } } })
    expect(other.status).toBe(201)
  })
})

describe('browser endpoint', () => {
  it('404s an unknown id and a form without browser submissions', async () => {
    expect((await submitFromBrowser('frm_unknown')).status).toBe(404)
    expect((await submitFromBrowser(`frm_form_browser_off_${runId}`)).status).toBe(404)
  })

  it('403s a missing or unlisted origin', async () => {
    const missing = await submitFromBrowser(publicId, { origin: null })
    expect(missing.status).toBe(403)
    expect(errorCode(missing.json)).toBe('ORIGIN_NOT_ALLOWED')
    expect(missing.headers.get('access-control-allow-origin')).toBeNull()
    expect((await submitFromBrowser(publicId, { origin: 'https://evil.example.test' })).status).toBe(403)
    expect((await submitFromBrowser(publicId, { origin: 'https://brand.example.test' })).status).toBe(403)
  })

  it('files a JSON submission from an allowed origin and grants CORS to it only', async () => {
    const email = `browser-${runId}@buyer.example.test`
    const response = await submitFromBrowser(publicId, {
      origin: 'https://www.brand.example.test',
      body: { fields: validFields(email), metadata: { pageUrl: 'https://www.brand.example.test/contact' } },
    })
    expect(response.status).toBe(201)
    expect(Object.keys(response.json.data)).toEqual(['id'])
    expect(response.headers.get('access-control-allow-origin')).toBe('https://www.brand.example.test')

    const [row] = await conversationsFor(email)
    const [incoming] = (await messagesOf(row.id)).filter((m) => m.kind === 'incoming')
    expect(incoming.metadata?.formSubmission).toMatchObject({
      source: 'browser',
      metadata: { pageUrl: 'https://www.brand.example.test/contact' },
    })
    expect(incoming.metadata?.formSubmission.metadata.clientIp).toEqual(expect.any(String))
  })

  it('accepts form-encoded bodies, ticked checkboxes included', async () => {
    const email = `encoded-${runId}@buyer.example.test`
    const params = new URLSearchParams({ ...validFields(email), newsletter: 'on', _hp: '', _page_url: `${ORIGIN}/c` })
    const response = await submitFromBrowser(publicId, {
      contentType: 'application/x-www-form-urlencoded',
      rawBody: params.toString(),
    })
    expect(response.status).toBe(201)
    const [row] = await conversationsFor(email)
    const [incoming] = (await messagesOf(row.id)).filter((m) => m.kind === 'incoming')
    expect(incoming.body).toContain('Subscribe me: Yes')
    expect(incoming.metadata?.formSubmission.metadata.pageUrl).toBe(`${ORIGIN}/c`)
  })

  it('pretends to accept a filled honeypot and files nothing', async () => {
    const email = `bot-${runId}@buyer.example.test`
    const response = await submitFromBrowser(publicId, { body: { fields: validFields(email), _hp: 'http://spam' } })
    expect(response.status).toBe(201)
    expect(response.json.data.id).toEqual(expect.any(String))
    expect(await conversationsFor(email)).toHaveLength(0)
  })

  it('pretends to accept a honeypot filled with a non-string value', async () => {
    const email = `bot2-${runId}@buyer.example.test`
    const response = await submitFromBrowser(publicId, { body: { fields: validFields(email), _hp: { url: 'x' } } })
    expect(response.status).toBe(201)
    expect(await conversationsFor(email)).toHaveLength(0)
  })

  it('caps the reserved form-encoded values like the JSON metadata', async () => {
    const params = new URLSearchParams({ ...validFields(), _page_url: `${ORIGIN}/${'x'.repeat(3000)}` })
    const response = await submitFromBrowser(publicId, {
      contentType: 'application/x-www-form-urlencoded',
      rawBody: params.toString(),
    })
    expect(response.status).toBe(400)
  })

  it('rejects other content types with 415', async () => {
    expect((await submitFromBrowser(publicId, { contentType: 'application/xml', rawBody: '<x/>' })).status).toBe(415)
  })

  it('limits one visitor to 5 submissions per form in 10 minutes', async () => {
    const ip = `192.0.2.50-${runId}`
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) statuses.push((await submitFromBrowser(publicId, { ip })).status)
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429])
  })

  it('answers the CORS preflight for allowed origins only', async () => {
    const allowed = await submitFromBrowser(publicId, { method: 'OPTIONS' })
    expect(allowed.status).toBe(204)
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(allowed.headers.get('access-control-allow-headers')).toContain('Idempotency-Key')

    const denied = await submitFromBrowser(publicId, { method: 'OPTIONS', origin: 'https://evil.example.test' })
    expect(denied.status).toBe(204)
    expect(denied.headers.get('access-control-allow-origin')).toBeNull()
  })
})
