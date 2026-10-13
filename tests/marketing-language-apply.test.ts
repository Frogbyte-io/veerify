import { describe, expect, it, vi } from 'vitest'

vi.mock('~/server/database/drizzle', () => ({ db: {} }))

const { planLanguageApply } = await import('~/server/services/marketing/customer-language/apply')

const empty = { termLabels: [] as string[], promptTexts: [] as string[], activePromptCount: 0 }

describe('planLanguageApply', () => {
  it('adds valid terms and prompts', () => {
    const plan = planLanguageApply(
      { terms: [{ kind: 'keyword', label: 'slow exports' }], prompts: ['How do I speed up exporting reports?'] },
      empty
    )
    expect(plan.termsToAdd).toHaveLength(1)
    expect(plan.promptsToAdd).toHaveLength(1)
  })

  it('skips duplicates against existing and within the batch, case-insensitively', () => {
    const plan = planLanguageApply(
      {
        terms: [
          { kind: 'keyword', label: 'Slow Exports' },
          { kind: 'competitor', label: 'rival' },
          { kind: 'competitor', label: 'Rival' },
        ],
        prompts: ['how do i speed up exporting reports?', 'How do I speed up exporting reports?'],
      },
      { termLabels: ['slow exports'], promptTexts: [], activePromptCount: 0 }
    )
    expect(plan.termsToAdd.map((t) => t.label)).toEqual(['rival'])
    expect(plan.skippedTerms.map((s) => s.reason)).toEqual(['duplicate', 'duplicate'])
    expect(plan.promptsToAdd).toHaveLength(1)
    expect(plan.skippedPrompts[0].reason).toBe('duplicate')
  })

  it('skips invalid terms and prompts', () => {
    const plan = planLanguageApply({ terms: [{ kind: 'keyword', label: 'a' }], prompts: ['too short'] }, empty)
    expect(plan.skippedTerms[0].reason).toBe('invalid')
    expect(plan.skippedPrompts[0].reason).toBe('invalid')
  })

  it('respects the 50 term cap', () => {
    const plan = planLanguageApply(
      {
        terms: [
          { kind: 'keyword', label: 'one more' },
          { kind: 'keyword', label: 'and another' },
        ],
      },
      { ...empty, termLabels: Array.from({ length: 49 }, (_, i) => `term ${i}`) }
    )
    expect(plan.termsToAdd).toHaveLength(1)
    expect(plan.skippedTerms).toEqual([{ value: 'and another', reason: 'cap' }])
  })

  it('respects the 25 active prompt cap', () => {
    const plan = planLanguageApply(
      { prompts: ['What is the best export tool for teams?', 'Which tool exports reports fastest?'] },
      { ...empty, activePromptCount: 24 }
    )
    expect(plan.promptsToAdd).toHaveLength(1)
    expect(plan.skippedPrompts[0].reason).toBe('cap')
  })

  it('respects the 100 total prompt cap', () => {
    const plan = planLanguageApply(
      { prompts: ['What is the best export tool for teams?'] },
      {
        termLabels: [],
        promptTexts: Array.from({ length: 100 }, (_, i) => `existing prompt ${i}`),
        activePromptCount: 0,
      }
    )
    expect(plan.promptsToAdd).toHaveLength(0)
    expect(plan.skippedPrompts[0].reason).toBe('cap')
  })
})
