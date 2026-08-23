import { describe, expect, it } from 'vitest'

import { buildOutgoingReply } from '../server/utils/outbound-reply'

function baseInput() {
  return {
    inbox: { emailAddress: 'support@acme.com', fromName: 'Acme Support', signature: null as string | null },
    contact: { email: 'jane@example.com', name: 'Jane Customer' },
    cc: [] as { email: string }[],
    subject: 'Invoice question',
    agentBody: 'Here is your answer.',
    agentBodyHtml: null as string | null,
    previous: null as null | {
      channelMessageId: string
      references: string[]
      fromName: string
      sentAt: Date
      body: string
      bodyHtml: string | null
    },
    newMessageId: 'new-msg-uuid',
    domain: 'acme.com',
    attachments: [] as { filename: string; contentType?: string; storageKey: string; cid?: string }[],
  }
}

describe('buildOutgoingReply', () => {
  it('generates a stripped channelMessageId from the seed and domain', () => {
    const result = buildOutgoingReply(baseInput())
    expect(result.channelMessageId).toBe('new-msg-uuid@acme.com')
  })

  it('has no inReplyTo or references when there is no previous message', () => {
    const result = buildOutgoingReply(baseInput())
    expect(result.inReplyTo).toBeNull()
    expect(result.referencesForStorage).toBeNull()
    expect(result.deliveryPayload.headers?.['In-Reply-To']).toBeUndefined()
    expect(result.deliveryPayload.headers?.References).toBeUndefined()
  })

  it('threads onto the previous message: inReplyTo, References, and a bracketed Message-ID header', () => {
    const input = baseInput()
    input.previous = {
      channelMessageId: 'parent@customer.com',
      references: ['root@customer.com'],
      fromName: 'Jane Customer',
      sentAt: new Date('2026-08-20T10:00:00.000Z'),
      body: 'My original question',
      bodyHtml: null,
    }

    const result = buildOutgoingReply(input)

    expect(result.inReplyTo).toBe('parent@customer.com')
    expect(result.referencesForStorage).toBe('<root@customer.com> <parent@customer.com>')
    expect(result.deliveryPayload.headers?.['Message-ID']).toBe('<new-msg-uuid@acme.com>')
    expect(result.deliveryPayload.headers?.['In-Reply-To']).toBe('<parent@customer.com>')
    expect(result.deliveryPayload.headers?.References).toBe('<root@customer.com> <parent@customer.com>')
  })

  it('quotes the previous message body beneath the agent reply', () => {
    const input = baseInput()
    input.previous = {
      channelMessageId: 'parent@customer.com',
      references: [],
      fromName: 'Jane Customer',
      sentAt: new Date('2026-08-20T10:00:00.000Z'),
      body: 'My original question',
      bodyHtml: null,
    }

    const result = buildOutgoingReply(input)

    expect(result.deliveryPayload.text).toContain('Here is your answer.')
    expect(result.deliveryPayload.text).toContain('Jane Customer wrote')
    expect(result.deliveryPayload.text).toContain('> My original question')
  })

  it('prefixes a bare subject with "Re: " and does not double-prefix one that already has it', () => {
    const bare = buildOutgoingReply(baseInput())
    expect(bare.deliveryPayload.subject).toBe('Re: Invoice question')

    const already = buildOutgoingReply({ ...baseInput(), subject: 'Re: Invoice question' })
    expect(already.deliveryPayload.subject).toBe('Re: Invoice question')
  })

  it('sends to the contact and copies cc participants', () => {
    const input = baseInput()
    input.cc = [{ email: 'boss@example.com' }, { email: 'colleague@example.com' }]

    const result = buildOutgoingReply(input)

    expect(result.deliveryPayload.to).toBe('jane@example.com')
    expect(result.deliveryPayload.cc).toEqual(['boss@example.com', 'colleague@example.com'])
  })

  it('sets from/replyTo from the inbox identity', () => {
    const result = buildOutgoingReply(baseInput())
    expect(result.deliveryPayload.from).toEqual({ address: 'support@acme.com', name: 'Acme Support' })
    expect(result.deliveryPayload.replyTo).toBe('support@acme.com')
  })

  it('appends the inbox signature to both html and text bodies', () => {
    const input = baseInput()
    input.inbox.signature = 'Acme Support Team'

    const result = buildOutgoingReply(input)

    expect(result.deliveryPayload.text).toContain('-- \nAcme Support Team')
    expect(result.deliveryPayload.html).toContain('Acme Support Team')
  })

  it('passes attachments through unchanged, as storage-key references', () => {
    const input = baseInput()
    input.attachments = [{ filename: 'invoice.pdf', contentType: 'application/pdf', storageKey: 'support/abc.pdf' }]

    const result = buildOutgoingReply(input)

    expect(result.deliveryPayload.attachments).toEqual([
      { filename: 'invoice.pdf', contentType: 'application/pdf', storageKey: 'support/abc.pdf' },
    ])
  })
})
