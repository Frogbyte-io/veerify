import { describe, expect, it } from 'vitest'
import { decodeContactCursor, encodeContactCursor } from '../server/utils/contact-cursor'

describe('contact cursors', () => {
  it('round-trips the createdAt and id tie-breaker as an opaque value', () => {
    const cursor = encodeContactCursor({ createdAt: new Date('2026-08-13T12:00:00.000Z'), id: 'contact-b' })

    expect(cursor).not.toContain('contact-b')
    expect(decodeContactCursor(cursor)).toEqual({
      createdAt: new Date('2026-08-13T12:00:00.000Z'),
      id: 'contact-b',
    })
  })

  it('rejects malformed and incomplete cursors', () => {
    expect(() => decodeContactCursor('not-a-cursor')).toThrowError(expect.objectContaining({ statusCode: 400 }))
    expect(() =>
      decodeContactCursor(Buffer.from(JSON.stringify({ createdAt: '2026-08-13T12:00:00.000Z' })).toString('base64url'))
    ).toThrowError(expect.objectContaining({ statusCode: 400 }))
  })
})
