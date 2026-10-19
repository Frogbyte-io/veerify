import { describe, expect, it } from 'vitest'

import { parseSubmissionMessageId, resolveMailTransportConfig } from '../lib/mail-transport'

/**
 * System mail (sign-in, verification, password reset, notifications, digests)
 * can leave through its own SMTP transport so support mail can move to another
 * provider without taking account recovery with it. Unset means "exactly as
 * before": the primary nuxt-nodemailer transport.
 */
describe('resolveMailTransportConfig - fallback', () => {
  it('uses the primary transport for system mail when SYSTEM_SMTP_HOST is unset', () => {
    expect(resolveMailTransportConfig('system', {})).toBeNull()
  })

  it('treats an empty or whitespace-only SYSTEM_SMTP_HOST as unset', () => {
    expect(resolveMailTransportConfig('system', { SYSTEM_SMTP_HOST: '' })).toBeNull()
    expect(resolveMailTransportConfig('system', { SYSTEM_SMTP_HOST: '   ', SYSTEM_SMTP_USER: 'resend' })).toBeNull()
  })

  it('always sends support mail through the primary transport, even with a system override', () => {
    expect(
      resolveMailTransportConfig('support', {
        SYSTEM_SMTP_HOST: 'smtp.resend.com',
        SYSTEM_SMTP_USER: 'resend',
        SYSTEM_SMTP_PASS: 'test-pass',
      })
    ).toBeNull()
  })
})

describe('resolveMailTransportConfig - override', () => {
  it('builds the dedicated transport from SYSTEM_SMTP_*', () => {
    expect(
      resolveMailTransportConfig('system', {
        SYSTEM_SMTP_HOST: ' smtp.resend.com ',
        SYSTEM_SMTP_PORT: '465',
        SYSTEM_SMTP_SECURE: 'true',
        SYSTEM_SMTP_USER: 'resend',
        SYSTEM_SMTP_PASS: 'test-pass',
        SYSTEM_MAIL_FROM: 'Veerify <noreply@example.test>',
        MAIL_FROM: 'support@example.test',
      })
    ).toEqual({
      host: 'smtp.resend.com',
      port: 465,
      secure: true,
      auth: { user: 'resend', pass: 'test-pass' },
      from: 'Veerify <noreply@example.test>',
    })
  })

  it('defaults the port from SYSTEM_SMTP_SECURE when it is unset or invalid', () => {
    expect(resolveMailTransportConfig('system', { SYSTEM_SMTP_HOST: 'h' })).toMatchObject({ port: 587, secure: false })
    expect(
      resolveMailTransportConfig('system', { SYSTEM_SMTP_HOST: 'h', SYSTEM_SMTP_SECURE: 'true', SYSTEM_SMTP_PORT: '' })
    ).toMatchObject({ port: 465, secure: true })
    expect(resolveMailTransportConfig('system', { SYSTEM_SMTP_HOST: 'h', SYSTEM_SMTP_PORT: 'abc' })).toMatchObject({
      port: 587,
    })
  })

  it('only authenticates when both user and password are set', () => {
    expect(resolveMailTransportConfig('system', { SYSTEM_SMTP_HOST: 'h', SYSTEM_SMTP_USER: 'u' })).not.toHaveProperty(
      'auth'
    )
    expect(
      resolveMailTransportConfig('system', { SYSTEM_SMTP_HOST: 'h', SYSTEM_SMTP_USER: 'u', SYSTEM_SMTP_PASS: '' })
    ).not.toHaveProperty('auth')
  })

  it('falls back to the primary From when SYSTEM_MAIL_FROM is unset', () => {
    expect(
      resolveMailTransportConfig('system', {
        SYSTEM_SMTP_HOST: 'h',
        SYSTEM_MAIL_FROM: '',
        NUXT_NODEMAILER_FROM: 'Veerify <runtime@example.test>',
        MAIL_FROM: 'build@example.test',
      })
    ).toMatchObject({ from: 'Veerify <runtime@example.test>' })
    expect(
      resolveMailTransportConfig('system', { SYSTEM_SMTP_HOST: 'h', MAIL_FROM: 'build@example.test' })
    ).toMatchObject({ from: 'build@example.test' })
    expect(resolveMailTransportConfig('system', { SYSTEM_SMTP_HOST: 'h' })).not.toHaveProperty('from')
  })
})

describe('parseSubmissionMessageId', () => {
  it("reads the Message-ID from Frogmail's SMTP gateway reply", () => {
    expect(
      parseSubmissionMessageId(
        '250 2.0.0 Ok: queued as email_0123456789abcdefABCDEF01 <reply-1@support.example.test>; delivery is asynchronous'
      )
    ).toBe('reply-1@support.example.test')
  })

  it('reads it without the trailing asynchronous-delivery note', () => {
    expect(parseSubmissionMessageId('250 2.0.0 Ok: queued as email_abc <0100019a-x@email.amazonses.com>')).toBe(
      '0100019a-x@email.amazonses.com'
    )
  })

  it('ignores replies that carry no Message-ID', () => {
    // Postfix-style queue ids and Mailgun's own SMTP reply are not Message-IDs.
    expect(parseSubmissionMessageId('250 2.0.0 Ok: queued as 4F2A1B3C9D')).toBeNull()
    expect(parseSubmissionMessageId('250 Great success')).toBeNull()
    expect(parseSubmissionMessageId('250 2.0.0 Ok: queued as email_abc <not-a-message-id>')).toBeNull()
    expect(parseSubmissionMessageId('')).toBeNull()
    expect(parseSubmissionMessageId(undefined)).toBeNull()
  })
})
