import { describe, expect, it } from 'vitest'

import { cn } from '../lib/utils'

describe('cn', () => {
  it('joins class names', () => {
    expect(cn('px-2', 'py-3')).toBe('px-2 py-3')
  })

  it('ignores falsy values', () => {
    expect(cn('px-2', false, undefined, null, 'py-3')).toBe('px-2 py-3')
  })

  it('merges conflicting Tailwind classes (last wins)', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })
})
