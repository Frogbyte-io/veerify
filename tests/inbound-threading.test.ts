import { describe, expect, it } from 'vitest'

import { normalizeSubject, SUBJECT_FALLBACK_WINDOW_DAYS } from '../server/utils/inbound-threading'

/**
 * Subject normalization is where the threading fallback most easily goes wrong,
 * so it is exported and tested on its own. The three resolution strategies need
 * real rows and are covered in `tests/integration/inbound-threading.test.ts`.
 */
describe('normalizeSubject', () => {
  it('returns empty for null or blank', () => {
    expect(normalizeSubject(null)).toBe('')
    expect(normalizeSubject('   ')).toBe('')
  })

  it('lowercases and collapses whitespace so formatting drift still matches', () => {
    expect(normalizeSubject('  Invoice   Question  ')).toBe('invoice question')
  })

  it('strips a single reply prefix', () => {
    expect(normalizeSubject('Re: Invoice question')).toBe('invoice question')
  })

  it('strips stacked prefixes', () => {
    expect(normalizeSubject('Re: Fwd: Re: Invoice question')).toBe('invoice question')
  })

  it('strips numbered prefixes some clients emit', () => {
    expect(normalizeSubject('Re[2]: Invoice question')).toBe('invoice question')
  })

  it('is case-insensitive about the prefix', () => {
    expect(normalizeSubject('RE: Invoice')).toBe('invoice')
    expect(normalizeSubject('fwd: Invoice')).toBe('invoice')
  })

  it('strips localised prefixes', () => {
    expect(normalizeSubject('AW: Rechnung')).toBe('rechnung')
    expect(normalizeSubject('WG: Rechnung')).toBe('rechnung')
    expect(normalizeSubject('SV: Faktura')).toBe('faktura')
    expect(normalizeSubject('RES: Fatura')).toBe('fatura')
  })

  it('tolerates spacing variants around the prefix', () => {
    expect(normalizeSubject('Re : Invoice')).toBe('invoice')
    expect(normalizeSubject('Re:Invoice')).toBe('invoice')
  })

  it('does not eat a subject that merely starts with those letters', () => {
    // "Refund" starts with "Re" but has no colon - it is the whole subject.
    expect(normalizeSubject('Refund request')).toBe('refund request')
    expect(normalizeSubject('Review of our plan')).toBe('review of our plan')
  })

  it('leaves a colon that is not a reply prefix alone', () => {
    expect(normalizeSubject('Bug: cannot sign in')).toBe('bug: cannot sign in')
  })

  it('treats differently-prefixed versions of one subject as equal', () => {
    expect(normalizeSubject('Re: Cannot sign in')).toBe(normalizeSubject('Cannot sign in'))
    expect(normalizeSubject('FWD: cannot sign IN')).toBe(normalizeSubject('Cannot sign in'))
  })

  it('keeps distinct subjects distinct', () => {
    expect(normalizeSubject('Re: Invoice')).not.toBe(normalizeSubject('Re: Refund'))
  })

  it('bounds the fallback window', () => {
    // A wide window turns unrelated same-subject mail into a false match.
    expect(SUBJECT_FALLBACK_WINDOW_DAYS).toBeGreaterThan(0)
    expect(SUBJECT_FALLBACK_WINDOW_DAYS).toBeLessThanOrEqual(30)
  })
})
