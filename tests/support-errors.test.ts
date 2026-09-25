import { describe, expect, it } from 'vitest'

import { isForeignKeyViolation, isUniqueViolation } from '../server/utils/support-errors'

describe('isUniqueViolation', () => {
  it('matches a raw pg-style error with code 23505', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
  })

  it('matches when the real error is wrapped in .cause, like DrizzleQueryError', () => {
    // This is the actual shape thrown by drizzle-orm's node-postgres driver:
    // DrizzleQueryError wraps the underlying pg error (the one carrying
    // .code) in .cause rather than exposing it on itself. A version of this
    // check that only looked at the top-level error matched nothing here,
    // and every unique-constraint conflict across the support platform
    // leaked as a raw 500 until a live request against a duplicate company
    // name caught it.
    const pgError = { code: '23505', constraint: 'support_company_team_name_idx' }
    const drizzleQueryError = { message: 'Failed query: insert into "support_company" ...', cause: pgError }

    expect(isUniqueViolation(drizzleQueryError)).toBe(true)
  })

  it('matches a specific constraint name through the wrapper', () => {
    const wrapped = { cause: { code: '23505', constraint: 'contact_team_email_idx' } }

    expect(isUniqueViolation(wrapped, 'contact_team_email_idx')).toBe(true)
    expect(isUniqueViolation(wrapped, 'some_other_idx')).toBe(false)
  })

  it('does not match a different error code, wrapped or not', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false)
    expect(isUniqueViolation({ cause: { code: '23503' } })).toBe(false)
  })

  it('does not match a deeply nested cause beyond the safety bound', () => {
    // Real chains are one level deep. This just confirms the bound actually
    // stops the walk rather than looping forever on something pathological.
    let error: Record<string, unknown> = { code: '23505' }
    for (let i = 0; i < 10; i++) {
      error = { cause: error }
    }

    expect(isUniqueViolation(error)).toBe(false)
  })

  it('does not match non-error inputs', () => {
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation(undefined)).toBe(false)
    expect(isUniqueViolation('not an error')).toBe(false)
    expect(isUniqueViolation(new Error('plain error, no code'))).toBe(false)
  })
})

describe('isForeignKeyViolation', () => {
  it('matches a raw pg-style error with code 23503', () => {
    expect(isForeignKeyViolation({ code: '23503' })).toBe(true)
  })

  it('matches when the real error is wrapped in .cause, like DrizzleQueryError', () => {
    const pgError = { code: '23503', constraint: 'conversation_inbox_id_support_inbox_id_fk' }
    const drizzleQueryError = { message: 'Failed query: delete from "support_inbox" ...', cause: pgError }

    expect(isForeignKeyViolation(drizzleQueryError)).toBe(true)
  })

  it('matches a specific constraint name through the wrapper', () => {
    const wrapped = { cause: { code: '23503', constraint: 'conversation_inbox_id_support_inbox_id_fk' } }

    expect(isForeignKeyViolation(wrapped, 'conversation_inbox_id_support_inbox_id_fk')).toBe(true)
    expect(isForeignKeyViolation(wrapped, 'some_other_fk')).toBe(false)
  })

  it('does not match a different error code, wrapped or not', () => {
    expect(isForeignKeyViolation({ code: '23505' })).toBe(false)
    expect(isForeignKeyViolation({ cause: { code: '23505' } })).toBe(false)
  })

  it('does not match non-error inputs', () => {
    expect(isForeignKeyViolation(null)).toBe(false)
    expect(isForeignKeyViolation(undefined)).toBe(false)
    expect(isForeignKeyViolation('not an error')).toBe(false)
  })
})
