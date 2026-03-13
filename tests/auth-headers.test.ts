import type { H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'

const getRequestHeadersMock = vi.fn()

vi.mock('h3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('h3')>()
  return {
    ...actual,
    getRequestHeaders: getRequestHeadersMock,
  }
})

describe('auth header helper', () => {
  afterEach(() => {
    getRequestHeadersMock.mockReset()
  })

  it('delegates auth header resolution to h3 request headers', async () => {
    const event = {} as H3Event
    const headers = {
      cookie: 'session=abc123',
      host: 'app.veerify.io',
    }

    getRequestHeadersMock.mockReturnValue(headers)

    const { getAuthHeaders } = await import('../server/utils/auth-headers')

    expect(getAuthHeaders(event)).toBe(headers)
    expect(getRequestHeadersMock).toHaveBeenCalledWith(event)
  })
})
