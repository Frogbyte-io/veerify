import { decodeListCursor, encodeListCursor, type ListCursor } from './list-cursor'

export type ContactCursor = ListCursor

export function encodeContactCursor(cursor: ContactCursor): string {
  return encodeListCursor(cursor)
}

export function decodeContactCursor(value: string): ContactCursor {
  return decodeListCursor(value, 'contact')
}
