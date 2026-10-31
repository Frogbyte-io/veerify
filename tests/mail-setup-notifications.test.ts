import { describe, expect, it, vi } from 'vitest'

vi.mock('~/server/database/drizzle', () => ({ db: {} }))
vi.mock('~/lib/email', () => ({
  sendMailDomainMxNeededEmail: vi.fn(),
  sendMailForwardingPausedEmail: vi.fn(),
  sendMailForwardingResumedEmail: vi.fn(),
}))

const { notifyForwardingChange, notifyMxRecordNeeded } = await import('~/server/utils/mail-setup-notifications')
const { getMailDomainMxNeededTemplate, getMailForwardingPausedTemplate } = await import('~/lib/email-templates')

const NOW = new Date('2026-10-31T12:00:00Z')
const admins = {
  projectName: 'Acme',
  recipients: [
    { email: 'owner@acme.com', name: 'Owner' },
    { email: 'admin@acme.com', name: null },
  ],
}
const mx = {
  purpose: 'receiving',
  type: 'MX',
  name: 'acme.com',
  value: 'inbound-smtp.us-east-1.amazonaws.com',
  priority: '10',
  status: 'unknown',
} as const
const domainRow = { id: 'd1', projectId: 'p1', domain: 'acme.com', mxNoticeSentAt: null, dnsRecords: [mx] }

describe('notifyMxRecordNeeded', () => {
  it('emails every project admin once the notice is claimed', async () => {
    const sendMxNeeded = vi.fn(async () => ({}))
    const claimMxNotice = vi.fn(async () => true)
    const sent = await notifyMxRecordNeeded(
      { ...domainRow, existingMxHosts: ['aspmx.l.google.com'] },
      { claimMxNotice, listRecipients: async () => admins, sendMxNeeded, now: NOW }
    )
    expect(sent).toBe(2)
    expect(claimMxNotice).toHaveBeenCalledWith('d1', NOW)
    expect(sendMxNeeded).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@acme.com',
        projectName: 'Acme',
        domain: 'acme.com',
        mx: { host: 'acme.com', value: 'inbound-smtp.us-east-1.amazonaws.com', priority: '10' },
        existingMxHosts: ['aspmx.l.google.com'],
      })
    )
  })

  it('sends nothing when another pass already claimed the notice (idempotent)', async () => {
    const sendMxNeeded = vi.fn(async () => ({}))
    const listRecipients = vi.fn(async () => admins)
    expect(
      await notifyMxRecordNeeded(domainRow, { claimMxNotice: async () => false, listRecipients, sendMxNeeded })
    ).toBe(0)
    expect(listRecipients).not.toHaveBeenCalled()
    expect(sendMxNeeded).not.toHaveBeenCalled()
  })

  it('does not even try to claim when the row says it was sent', async () => {
    const claimMxNotice = vi.fn(async () => true)
    expect(await notifyMxRecordNeeded({ ...domainRow, mxNoticeSentAt: NOW }, { claimMxNotice })).toBe(0)
    expect(claimMxNotice).not.toHaveBeenCalled()
  })

  it('keeps going when one send fails and never throws', async () => {
    const sendMxNeeded = vi.fn().mockRejectedValueOnce(new Error('smtp down')).mockResolvedValueOnce({})
    expect(
      await notifyMxRecordNeeded(domainRow, {
        claimMxNotice: async () => true,
        listRecipients: async () => admins,
        sendMxNeeded,
      })
    ).toBe(1)
    await expect(
      notifyMxRecordNeeded(domainRow, { claimMxNotice: async () => Promise.reject(new Error('db down')) })
    ).resolves.toBe(0)
  })
})

describe('notifyForwardingChange', () => {
  it('emails each changed project once, even when several of its domains changed', async () => {
    const sendPaused = vi.fn(async () => ({}))
    const listRecipients = vi.fn(async () => admins)
    const sent = await notifyForwardingChange(
      'paused',
      ['p1', 'p1', 'p2'],
      { forwardsPerMonth: 5000 },
      {
        listRecipients,
        sendPaused,
      }
    )
    expect(listRecipients).toHaveBeenCalledTimes(2)
    expect(sent).toBe(4)
    expect(sendPaused).toHaveBeenCalledWith(expect.objectContaining({ forwardsPerMonth: 5000, projectName: 'Acme' }))
  })

  it('sends the resumed notice for resumed changes', async () => {
    const sendResumed = vi.fn(async () => ({}))
    const sendPaused = vi.fn(async () => ({}))
    await notifyForwardingChange(
      'resumed',
      ['p1'],
      { forwardsPerMonth: 5000 },
      {
        listRecipients: async () => admins,
        sendResumed,
        sendPaused,
      }
    )
    expect(sendResumed).toHaveBeenCalledTimes(2)
    expect(sendPaused).not.toHaveBeenCalled()
  })
})

describe('notice templates', () => {
  it('the MX notice carries the record and the takeover warning when the domain has mail', () => {
    const template = getMailDomainMxNeededTemplate({
      projectName: 'Acme',
      domain: 'acme.com',
      mx: { host: 'acme.com', value: 'inbound-smtp.us-east-1.amazonaws.com', priority: '10' },
      existingMxHosts: ['aspmx.l.google.com'],
      settingsUrl: 'https://app.test/project/settings?tab=email',
    })
    expect(template.subject).toBe('acme.com is verified: one more DNS record to add')
    expect(template.text).toContain('10 inbound-smtp.us-east-1.amazonaws.com')
    expect(template.text).toContain('acme.com currently receives mail at aspmx.l.google.com')
    expect(template.text).toContain('mail.acme.com')
  })

  it('escapes HTML', () => {
    const template = getMailForwardingPausedTemplate({
      projectName: '<b>Acme</b>',
      forwardsPerMonth: 5000,
      settingsUrl: 'https://app.test/x',
    })
    expect(template.html).not.toContain('<b>Acme</b>')
    expect(template.text).toContain('5,000')
  })
})
