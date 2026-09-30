import { describe, expect, it, vi } from 'vitest'

import { createMemoryDriver } from '../server/services/realtime/drivers/memory'
import {
  REALTIME_ENVELOPE_VERSION,
  conversationChannel,
  createEnvelope,
  envelopeMatchesChannel,
  inboxChannel,
  parseChannel,
  parseEnvelope,
  sanitizeEnvelope,
  teamChannel,
  userChannel,
} from '../server/services/realtime/types'

describe('realtime channels', () => {
  it('builds namespaced channel names', () => {
    expect(teamChannel('t1')).toBe('team:t1')
    expect(inboxChannel('i1')).toBe('inbox:i1')
    expect(conversationChannel('c1')).toBe('conversation:c1')
    expect(userChannel('u1')).toBe('user:u1')
  })

  it('parses well-formed channels', () => {
    expect(parseChannel('team:t1')).toEqual({ scope: 'team', id: 't1' })
    expect(parseChannel('conversation:abc-123')).toEqual({ scope: 'conversation', id: 'abc-123' })
  })

  it('rejects channels that are not well formed', () => {
    // Rejecting rather than guessing matters: parseChannel is what
    // subscribe-time authorization keys off.
    expect(parseChannel('team')).toBeNull()
    expect(parseChannel('team:')).toBeNull()
    expect(parseChannel(':t1')).toBeNull()
    expect(parseChannel('project:p1')).toBeNull()
    expect(parseChannel('')).toBeNull()
  })

  it('keeps ids containing a colon intact', () => {
    expect(parseChannel('conversation:a:b')).toEqual({ scope: 'conversation', id: 'a:b' })
  })
})

describe('realtime envelopes', () => {
  it('accepts a minimal valid envelope', () => {
    expect(sanitizeEnvelope({ v: 1, type: 'conversation.updated', teamId: 't1' })).toEqual({
      v: 1,
      type: 'conversation.updated',
      teamId: 't1',
    })
  })

  it('strips unknown fields so no record contents can ride along', () => {
    // This is the enforcement point for "envelopes carry identifiers only".
    const result = sanitizeEnvelope({
      v: 1,
      type: 'message.created',
      teamId: 't1',
      messageId: 'm1',
      body: 'customer credit card is 4111 1111 1111 1111',
      subject: 'Refund please',
    })

    expect(result).toEqual({ v: 1, type: 'message.created', teamId: 't1', messageId: 'm1' })
    expect(result).not.toHaveProperty('body')
    expect(result).not.toHaveProperty('subject')
  })

  it('rejects envelopes missing required identity', () => {
    expect(sanitizeEnvelope({ v: 1, teamId: 't1' })).toBeNull()
    expect(sanitizeEnvelope({ type: 'x', teamId: 't1' })).toBeNull()
    expect(sanitizeEnvelope({ v: 0, type: 'x', teamId: 't1' })).toBeNull()
    expect(sanitizeEnvelope({ v: 1.5, type: 'x', teamId: 't1' })).toBeNull()
    expect(sanitizeEnvelope({ v: 1, type: '', teamId: 't1' })).toBeNull()
  })

  it('rejects an envelope with no scope at all', () => {
    // Nothing to authorize against and nothing to route by.
    expect(sanitizeEnvelope({ v: 1, type: 'x' })).toBeNull()
    expect(sanitizeEnvelope({ v: 1, type: 'x', messageId: 'm1' })).toBeNull()
  })

  it('accepts a user-scoped envelope with no teamId', () => {
    // A notification belongs to a user who may be in several teams, so
    // requiring a teamId here would be meaningless. See delta D-01.
    expect(sanitizeEnvelope({ v: 1, type: 'notification.created', userId: 'u1' })).toEqual({
      v: 1,
      type: 'notification.created',
      userId: 'u1',
    })
  })

  it('rejects non-objects', () => {
    expect(sanitizeEnvelope(null)).toBeNull()
    expect(sanitizeEnvelope('string')).toBeNull()
    expect(sanitizeEnvelope([{ v: 1, type: 'x', teamId: 't1' }])).toBeNull()
  })

  it('delivers envelopes from a newer instance during a rolling deploy', () => {
    // A deploy leaves old and new instances running side by side, so a v2
    // publisher must not silently go undelivered to a v1 subscriber.
    const result = sanitizeEnvelope({ v: 2, type: 'conversation.updated', teamId: 't1', futureField: 'x' })

    expect(result).toEqual({ v: 2, type: 'conversation.updated', teamId: 't1' })
  })

  it('returns null for malformed JSON rather than throwing', () => {
    expect(parseEnvelope('not json')).toBeNull()
    expect(parseEnvelope('{"v":1}')).toBeNull()
  })

  it('stamps the current version by default', () => {
    expect(createEnvelope({ type: 'conversation.created', teamId: 't1' }).v).toBe(REALTIME_ENVELOPE_VERSION)
  })

  it('throws when building an envelope without required identity', () => {
    expect(() => createEnvelope({ type: 'x', teamId: '' })).toThrow()
    expect(() => createEnvelope({ type: 'x' })).toThrow()
  })
})

describe('envelopeMatchesChannel', () => {
  it('accepts an envelope whose scope matches its channel', () => {
    expect(envelopeMatchesChannel(createEnvelope({ type: 'x', teamId: 't1' }), 'team:t1')).toBe(true)
    expect(envelopeMatchesChannel(createEnvelope({ type: 'x', userId: 'u1' }), 'user:u1')).toBe(true)
    expect(envelopeMatchesChannel(createEnvelope({ type: 'x', inboxId: 'i1' }), 'inbox:i1')).toBe(true)
    expect(envelopeMatchesChannel(createEnvelope({ type: 'x', conversationId: 'c1' }), 'conversation:c1')).toBe(true)
  })

  it('rejects a cross-tenant publish', () => {
    // The case subscribe-time authorization cannot catch: every listener on
    // team:t2 is legitimately subscribed, so without this check they would all
    // receive another tenant's event.
    expect(envelopeMatchesChannel(createEnvelope({ type: 'x', teamId: 't1' }), 'team:t2')).toBe(false)
    expect(envelopeMatchesChannel(createEnvelope({ type: 'x', userId: 'u1' }), 'user:u2')).toBe(false)
  })

  it('rejects an envelope scoped on a different axis than the channel', () => {
    // A team-scoped envelope must not ride a user channel even if both ids exist.
    const envelope = createEnvelope({ type: 'x', teamId: 't1', userId: 'u1' })
    expect(envelopeMatchesChannel(envelope, 'team:t1')).toBe(true)
    expect(envelopeMatchesChannel(envelope, 'user:u1')).toBe(true)
    expect(envelopeMatchesChannel(createEnvelope({ type: 'x', teamId: 't1' }), 'user:t1')).toBe(false)
  })

  it('rejects malformed channels', () => {
    expect(envelopeMatchesChannel(createEnvelope({ type: 'x', teamId: 't1' }), 'nonsense')).toBe(false)
    expect(envelopeMatchesChannel(createEnvelope({ type: 'x', teamId: 't1' }), '')).toBe(false)
  })
})

describe('memory driver', () => {
  it('delivers to every handler on a channel', async () => {
    const driver = createMemoryDriver()
    const first = vi.fn()
    const second = vi.fn()

    await driver.subscribe('team:t1', first)
    await driver.subscribe('team:t1', second)
    await driver.publish('team:t1', createEnvelope({ type: 'conversation.created', teamId: 't1' }))

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first.mock.calls[0][0]).toEqual({ v: 1, type: 'conversation.created', teamId: 't1' })
    expect(first.mock.calls[0][1]).toBe('team:t1')
  })

  it('does not deliver across channels', async () => {
    const driver = createMemoryDriver()
    const handler = vi.fn()

    await driver.subscribe('team:t1', handler)
    await driver.publish('team:t2', createEnvelope({ type: 'conversation.created', teamId: 't2' }))

    expect(handler).not.toHaveBeenCalled()
  })

  it('stops delivering after unsubscribe', async () => {
    const driver = createMemoryDriver()
    const handler = vi.fn()

    await driver.subscribe('team:t1', handler)
    await driver.unsubscribe('team:t1', handler)
    await driver.publish('team:t1', createEnvelope({ type: 'conversation.created', teamId: 't1' }))

    expect(handler).not.toHaveBeenCalled()
  })

  it('tolerates a handler unsubscribing itself mid-dispatch', async () => {
    const driver = createMemoryDriver()
    const second = vi.fn()
    const first = vi.fn(() => {
      void driver.unsubscribe('team:t1', second)
    })

    await driver.subscribe('team:t1', first)
    await driver.subscribe('team:t1', second)
    await driver.publish('team:t1', createEnvelope({ type: 'conversation.created', teamId: 't1' }))

    expect(first).toHaveBeenCalledTimes(1)
  })

  it('hands each handler an independent object, matching wire semantics', async () => {
    const driver = createMemoryDriver()
    const received: unknown[] = []
    const envelope = createEnvelope({ type: 'message.created', teamId: 't1', messageId: 'm1' })

    await driver.subscribe('team:t1', (e) => received.push(e))
    await driver.publish('team:t1', envelope)

    expect(received[0]).toEqual(envelope)
    expect(received[0]).not.toBe(envelope)
  })

  it('drops all subscriptions on close', async () => {
    const driver = createMemoryDriver()
    const handler = vi.fn()

    await driver.subscribe('team:t1', handler)
    await driver.close()
    await driver.publish('team:t1', createEnvelope({ type: 'conversation.created', teamId: 't1' }))

    expect(handler).not.toHaveBeenCalled()
  })
})
