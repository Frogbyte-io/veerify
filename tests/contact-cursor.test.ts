import { describe, expect, it } from 'vitest'
import { decodeContactCursor, encodeContactCursor } from '../server/utils/contact-cursor'
import { decodeListCursor, encodeListCursor } from '../server/utils/list-cursor'

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

  it('uses a versioned opaque list cursor while preserving the decoded Date shape', () => {
    const cursor = encodeListCursor({ createdAt: new Date('2026-08-13T12:00:00.123Z'), id: 'row-b' })

    expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toEqual({
      v: 1,
      createdAt: '2026-08-13T12:00:00.123Z',
      id: 'row-b',
    })
    expect(decodeListCursor(cursor, 'row')).toEqual({
      createdAt: new Date('2026-08-13T12:00:00.123Z'),
      id: 'row-b',
    })
  })

  it('rejects unsupported cursor versions', () => {
    const cursor = Buffer.from(
      JSON.stringify({ v: 2, createdAt: '2026-08-13T12:00:00.000Z', id: 'row-b' })
    ).toString('base64url')

    expect(() => decodeListCursor(cursor, 'row')).toThrowError(expect.objectContaining({ statusCode: 400 }))
  })
})
