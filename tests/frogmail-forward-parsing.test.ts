import { describe, expect, it } from 'vitest'

import { MailgunChannelDriver } from '../server/services/support-channels/webhook/mailgun'

const driver = new MailgunChannelDriver({ signingKey: 'k', accountKey: 'a' })

// Frogmail contract fixtures (tests/Fixtures/Contract/veerify/inbound-callback-ses.json and forward-events.json).
const CLEAN = {
  recipient: 'support@mail.example.com',
  sender: 'maya@customer.test',
  from: 'Maya Lund <maya@customer.test>',
  subject: 'Where is my order?',
  'X-Mailgun-Sflag': 'No',
  'frogmail-verdicts': '{"spam":"PASS","virus":"PASS","spf":"PASS","dkim":"PASS","dmarc":"PASS","dmarc_policy":"none"}',
  'frogmail-forwards':
    '[{"destination":"owner@example.org","destination_id":"fd_1","status":"queued","reason":null,"forward_id":"fw_1"}]',
}

const VIRUS = {
  ...CLEAN,
  'frogmail-verdicts': '{"spam":"GRAY","virus":"FAIL"}',
  'frogmail-forwards':
    '[{"destination":"owner@example.org","destination_id":"fd_1","status":"skipped","reason":"virus","forward_id":"fw_1"}]',
  'frogmail-attachments-removed': 'true',
}

describe('Mailgun inbound: Frogmail forward fields', () => {
  it('keeps the forwards of a clean message and no attachmentsRemoved', () => {
    const message = driver.parse(CLEAN)
    expect(message.frogmailForwards).toEqual([
      { destination: 'owner@example.org', destination_id: 'fd_1', status: 'queued', reason: null, forward_id: 'fw_1' },
    ])
    expect(message.attachmentsRemoved).toBeUndefined()
    expect(message.isSpam).toBe(false)
  })

  it('keeps skipped forwards and removed attachments of a virus message', () => {
    const message = driver.parse(VIRUS)
    expect(message.frogmailForwards?.[0]).toMatchObject({ status: 'skipped', reason: 'virus' })
    expect(message.attachmentsRemoved).toBe(true)
    expect(message.isSpam).toBe(true)
  })

  it('does not trust the fields from sender headers', () => {
    const message = driver.parse({
      ...CLEAN,
      'frogmail-forwards': undefined,
      'message-headers': JSON.stringify([
        ['frogmail-forwards', CLEAN['frogmail-forwards']],
        ['frogmail-attachments-removed', 'true'],
      ]),
    })
    expect(message.frogmailForwards).toBeUndefined()
    expect(message.attachmentsRemoved).toBeUndefined()
  })

  it('drops invalid JSON and invalid entries, limits the list and field sizes', () => {
    expect(driver.parse({ ...CLEAN, 'frogmail-forwards': '{not json' }).frogmailForwards).toBeUndefined()
    expect(driver.parse({ ...CLEAN, 'frogmail-forwards': '{"a":1}' }).frogmailForwards).toBeUndefined()

    const many = Array.from({ length: 50 }, (_, i) => ({ destination: `d${i}@example.org`, status: 'queued' }))
    many.unshift({ destination: '', status: 'queued' }, 'nope' as never)
    const message = driver.parse({ ...CLEAN, 'frogmail-forwards': JSON.stringify(many) })
    expect(message.frogmailForwards).toHaveLength(20)
    expect(message.frogmailForwards?.[0].destination).toBe('d0@example.org')

    const long = driver.parse({
      ...CLEAN,
      'frogmail-forwards': JSON.stringify([{ destination: 'a@b.test', status: 'x'.repeat(500), extra: 'dropped' }]),
    })
    expect(long.frogmailForwards?.[0].status).toHaveLength(32)
    expect(long.frogmailForwards?.[0]).not.toHaveProperty('extra')
  })
})

describe('Mailgun delivery webhook: forward events', () => {
  const forwardTags = ['frogmail-forward']
  const variables = {
    'frogmail-forward-id': 'fw_1',
    'frogmail-forward-destination-id': 'fd_1',
    'frogmail-inbound-id': 'in_1',
  }

  it('marks tagged events as forwards with the destination id', () => {
    for (const data of [
      { event: 'delivered', recipient: 'owner@example.org' },
      { event: 'failed', severity: 'permanent', recipient: 'owner@example.org' },
    ]) {
      const event = driver.parseDeliveryEvent({
        'event-data': { id: 'ev_1', ...data, tags: forwardTags, 'user-variables': variables },
      })
      expect(event.isForward).toBe(true)
      expect(event.forwardDestinationId).toBe('fd_1')
    }
  })

  it('leaves untagged events alone', () => {
    const event = driver.parseDeliveryEvent({
      'event-data': { id: 'ev_2', event: 'delivered', recipient: 'a@b.test', tags: ['other'] },
    })
    expect(event.isForward).toBeUndefined()
  })
})
