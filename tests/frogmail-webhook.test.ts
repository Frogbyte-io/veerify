import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { createMemoryReplayStore, parseWebhookSecrets, verifyFrogmailWebhook } from '../server/utils/frogmail-webhook'

const SECRET = 'whsec_test_secret'
const NOW = Date.UTC(2026, 9, 30, 12, 0, 0)
const BODY = JSON.stringify({ id: 'evt_1', type: 'forward_destination.verified', data: { id: 'fd_1' } })

function sign(body: string, secret: string, timestampSeconds: number) {
  const hex = createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex')
  return `t=${timestampSeconds},v1=${hex}`
}

function verify(headers: Record<string, string>, overrides: Partial<Parameters<typeof verifyFrogmailWebhook>[0]> = {}) {
  return verifyFrogmailWebhook({
    rawBody: BODY,
    headers,
    secrets: [SECRET],
    now: () => NOW,
    replayStore: createMemoryReplayStore(() => NOW),
    ...overrides,
  })
}

describe('verifyFrogmailWebhook', () => {
  const ts = Math.floor(NOW / 1000)

  it('accepts a valid Frogmail-Signature', async () => {
    expect(await verify({ 'frogmail-signature': sign(BODY, SECRET, ts) })).toEqual({ ok: true })
  })

  it('accepts the Larasend-Signature header', async () => {
    expect(await verify({ 'larasend-signature': sign(BODY, SECRET, ts) })).toEqual({ ok: true })
  })

  it('rejects a wrong secret and a tampered body', async () => {
    expect(await verify({ 'frogmail-signature': sign(BODY, 'other', ts) })).toEqual({
      ok: false,
      reason: 'signature_mismatch',
    })
    expect(await verify({ 'frogmail-signature': sign(BODY, SECRET, ts) }, { rawBody: BODY + ' ' })).toEqual({
      ok: false,
      reason: 'signature_mismatch',
    })
  })

  it('rejects missing and malformed headers', async () => {
    expect(await verify({})).toEqual({ ok: false, reason: 'missing_signature' })
    expect(await verify({ 'frogmail-signature': 'garbage' })).toEqual({ ok: false, reason: 'malformed_signature' })
  })

  it('rejects a timestamp outside 300 seconds, in either direction', async () => {
    expect(await verify({ 'frogmail-signature': sign(BODY, SECRET, ts - 301) })).toEqual({
      ok: false,
      reason: 'timestamp_outside_tolerance',
    })
    expect(await verify({ 'frogmail-signature': sign(BODY, SECRET, ts + 301) })).toEqual({
      ok: false,
      reason: 'timestamp_outside_tolerance',
    })
    expect(await verify({ 'frogmail-signature': sign(BODY, SECRET, ts - 299) })).toEqual({ ok: true })
  })

  it('rejects a replay of an accepted request', async () => {
    const replayStore = createMemoryReplayStore(() => NOW)
    const headers = { 'frogmail-signature': sign(BODY, SECRET, ts) }
    expect(await verify(headers, { replayStore })).toEqual({ ok: true })
    expect(await verify(headers, { replayStore })).toEqual({ ok: false, reason: 'replayed' })
  })

  it('supports secret rotation and multiple v1 signatures', async () => {
    const old = sign(BODY, 'old_secret', ts)
    expect(await verify({ 'frogmail-signature': old }, { secrets: ['new_secret', 'old_secret'] })).toEqual({ ok: true })

    const hex = createHmac('sha256', SECRET).update(`${ts}.${BODY}`).digest('hex')
    expect(await verify({ 'frogmail-signature': `t=${ts},v1=${'0'.repeat(64)},v1=${hex}` })).toEqual({ ok: true })
  })

  it('fails closed without secrets', async () => {
    expect(await verify({ 'frogmail-signature': sign(BODY, SECRET, ts) }, { secrets: [] })).toEqual({
      ok: false,
      reason: 'signature_mismatch',
    })
  })

  it('parses comma-separated secrets', () => {
    expect(parseWebhookSecrets(' a, b ,,c')).toEqual(['a', 'b', 'c'])
    expect(parseWebhookSecrets(undefined)).toEqual([])
  })
})
