import { describe, expect, it } from 'vitest'

import { buildAutoReply, shouldSendAutoReply } from '../server/utils/auto-reply'

describe('shouldSendAutoReply', () => {
  it('sends when the conversation is new, the inbox has auto-reply on, and a template is set', () => {
    expect(shouldSendAutoReply({ isNewConversation: true, autoReplyEnabled: true, autoReplyTemplate: 'Thanks!' })).toBe(
      true
    )
  })

  it('never fires on an existing conversation, even with auto-reply enabled', () => {
    // This is also how guard 3 (never more than once per conversation) is
    // satisfied: the only path that can create a second message on this
    // conversation is the "existing" branch, which this always rejects.
    expect(
      shouldSendAutoReply({ isNewConversation: false, autoReplyEnabled: true, autoReplyTemplate: 'Thanks!' })
    ).toBe(false)
  })

  it('never fires when the inbox has auto-reply disabled', () => {
    expect(
      shouldSendAutoReply({ isNewConversation: true, autoReplyEnabled: false, autoReplyTemplate: 'Thanks!' })
    ).toBe(false)
  })

  it('never fires with no template configured', () => {
    expect(shouldSendAutoReply({ isNewConversation: true, autoReplyEnabled: true, autoReplyTemplate: null })).toBe(
      false
    )
    expect(shouldSendAutoReply({ isNewConversation: true, autoReplyEnabled: true, autoReplyTemplate: '   ' })).toBe(
      false
    )
  })
})

describe('buildAutoReply', () => {
  function baseInput() {
    return {
      inbox: { emailAddress: 'support@acme.com', fromName: 'Acme Support', signature: null as string | null },
      contact: { email: 'jane@example.com', name: 'Jane Customer' },
      subject: 'Invoice question',
      template: "Thanks for reaching out, we'll get back to you soon.",
      previous: {
        channelMessageId: 'inbound@customer.com',
        references: [] as string[],
        fromName: 'Jane Customer',
        sentAt: new Date('2026-08-20T10:00:00.000Z'),
        body: 'My original question',
        bodyHtml: null as string | null,
      },
      newMessageId: 'auto-reply-uuid',
      domain: 'acme.com',
    }
  }

  it('uses the template as the body', () => {
    const result = buildAutoReply(baseInput())
    expect(result.deliveryPayload.text).toContain("Thanks for reaching out, we'll get back to you soon.")
  })

  it('sets Auto-Submitted: auto-replied so the other end does not loop', () => {
    const result = buildAutoReply(baseInput())
    expect(result.deliveryPayload.headers?.['Auto-Submitted']).toBe('auto-replied')
  })

  it('still threads onto the inbound message that triggered it', () => {
    const result = buildAutoReply(baseInput())
    expect(result.inReplyTo).toBe('inbound@customer.com')
    expect(result.deliveryPayload.headers?.['In-Reply-To']).toBe('<inbound@customer.com>')
  })

  it('sends no attachments', () => {
    const result = buildAutoReply(baseInput())
    expect(result.deliveryPayload.attachments).toBeUndefined()
  })
})
