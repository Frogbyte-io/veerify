import { describe, expect, it } from 'vitest'
import { apiErrorDetails, apiErrorMessage, apiErrorStatus } from '../lib/api-error'

describe('api-error', () => {
  it('reads the nested Nitro shape', () => {
    const err = {
      statusCode: 403,
      data: { data: { error: { message: 'Nope', details: [{ message: 'x' }] } } },
    }
    expect(apiErrorMessage(err, 'f')).toBe('Nope')
    expect(apiErrorDetails(err)).toEqual([{ message: 'x' }])
    expect(apiErrorStatus(err)).toBe(403)
  })
  it('reads the flat shape', () => {
    expect(apiErrorMessage({ data: { error: { message: 'Flat' } } }, 'f')).toBe('Flat')
  })
  it('falls back to statusMessage then fallback', () => {
    expect(apiErrorMessage({ statusMessage: 'Bad' }, 'f')).toBe('Bad')
    expect(apiErrorMessage(null, 'f')).toBe('f')
    expect(apiErrorStatus(undefined)).toBeUndefined()
  })
})
