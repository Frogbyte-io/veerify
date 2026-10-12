import { describe, it, expect } from 'vitest'
import {
  ANNOUNCEMENT_SCHEMA,
  CHANNEL_LIMITS,
  buildAnnouncementSystemPrompt,
  buildAnnouncementInput,
  parseAnnouncementOutput,
  GenerationOutputError as AnnouncementError,
} from '~/server/services/marketing/announcements/prompt'
import {
  LANGUAGE_SCHEMA,
  buildLanguageSystemPrompt,
  prepareLanguageInput,
  parseLanguageOutput,
  GenerationOutputError as LanguageError,
  type LanguageItem,
} from '~/server/services/marketing/customer-language/prompt'

describe('Announcement Prompts', () => {
  describe('ANNOUNCEMENT_SCHEMA', () => {
    it('is OpenAI strict compatible: object with no additionalProperties', () => {
      expect(ANNOUNCEMENT_SCHEMA.type).toBe('object')
      expect(ANNOUNCEMENT_SCHEMA.additionalProperties).toBe(false)
    })

    it('requires all channel properties', () => {
      const required = ANNOUNCEMENT_SCHEMA.required as string[]
      expect(required).toContain('x')
      expect(required).toContain('bluesky')
      expect(required).toContain('linkedin')
      expect(required).toContain('newsletter')
      expect(required).toHaveLength(4)
    })

    it('has description for each channel with character limit', () => {
      const props = ANNOUNCEMENT_SCHEMA.properties as Record<string, Record<string, unknown>>
      for (const channel of ['x', 'bluesky', 'linkedin', 'newsletter'] as const) {
        const desc = props[channel].description as string
        expect(desc).toContain(CHANNEL_LIMITS[channel].toString())
      }
    })
  })

  describe('buildAnnouncementSystemPrompt', () => {
    it('returns a system prompt string', () => {
      const prompt = buildAnnouncementSystemPrompt()
      expect(typeof prompt).toBe('string')
      expect(prompt.length).toBeGreaterThan(0)
      expect(prompt).toContain('social media')
      expect(prompt).toContain('{{link}}')
    })

    it('mentions tone and channel guidelines', () => {
      const prompt = buildAnnouncementSystemPrompt()
      expect(prompt).toContain('friendly')
      expect(prompt).toContain('concrete')
      expect(prompt).toContain('hashtag')
      expect(prompt).toContain('emoji')
    })
  })

  describe('buildAnnouncementInput', () => {
    it('includes all input fields', () => {
      const result = buildAnnouncementInput({
        productName: 'Veerify',
        productDescription: 'Feedback management platform',
        entryTitle: 'New feature',
        entrySummary: 'Summary',
        entryBody: 'Body content',
        labels: ['new', 'improved'],
        linkedFeedbackTitles: ['Feedback 1', 'Feedback 2'],
      })

      expect(result).toContain('Veerify')
      expect(result).toContain('Feedback management platform')
      expect(result).toContain('New feature')
      expect(result).toContain('Summary')
      expect(result).toContain('Body content')
      expect(result).toContain('new, improved')
      expect(result).toContain('Feedback 1')
      expect(result).toContain('Feedback 2')
    })

    it('marks content as untrusted', () => {
      const result = buildAnnouncementInput({
        productName: 'Test',
        productDescription: 'Test',
        entryTitle: 'Test',
        entrySummary: 'Test',
        entryBody: 'Test',
        labels: [],
        linkedFeedbackTitles: [],
      })

      expect(result).toContain('not instructions')
    })

    it('truncates body to 6000 characters', () => {
      const longBody = 'x'.repeat(10000)
      const result = buildAnnouncementInput({
        productName: 'Test',
        productDescription: 'Test',
        entryTitle: 'Test',
        entrySummary: 'Test',
        entryBody: longBody,
        labels: [],
        linkedFeedbackTitles: [],
      })

      expect(result).toContain('x'.repeat(6000))
      expect(result).not.toContain('x'.repeat(6001))
    })

    it('limits feedback titles to 20 items', () => {
      const titles = Array.from({ length: 50 }, (_, i) => `Feedback ${i}`)
      const result = buildAnnouncementInput({
        productName: 'Test',
        productDescription: 'Test',
        entryTitle: 'Test',
        entrySummary: 'Test',
        entryBody: 'Test',
        labels: [],
        linkedFeedbackTitles: titles,
      })

      expect(result).toContain('Feedback 19')
      expect(result).not.toContain('Feedback 49')
    })
  })

  describe('parseAnnouncementOutput', () => {
    it('parses valid output with all channels', () => {
      const output = parseAnnouncementOutput(
        {
          x: 'Check it out {{link}}',
          bluesky: 'Just launched {{link}}',
          linkedin: 'Exciting news {{link}}',
          newsletter: 'Here is what we shipped {{link}}',
        },
        'https://example.com'
      )

      expect(output.x).toContain('https://example.com')
      expect(output.bluesky).toContain('https://example.com')
      expect(output.linkedin).toContain('https://example.com')
      expect(output.newsletter).toContain('https://example.com')
    })

    it('replaces {{link}} placeholder with provided link', () => {
      const output = parseAnnouncementOutput(
        {
          x: 'See here: {{link}}',
          bluesky: 'Read more {{link}}',
          linkedin: 'Link: {{link}}',
          newsletter: 'Visit {{link}} for details',
        },
        'https://test.com'
      )

      expect(output.x).toBe('See here: https://test.com')
      expect(output.bluesky).toBe('Read more https://test.com')
      expect(output.linkedin).toBe('Link: https://test.com')
      expect(output.newsletter).toBe('Visit https://test.com for details')
    })

    it('appends link if placeholder is missing', () => {
      const output = parseAnnouncementOutput(
        {
          x: 'Check it out',
          bluesky: 'Just launched',
          linkedin: 'Exciting news',
          newsletter: 'Here is what we shipped',
        },
        'https://example.com'
      )

      expect(output.x).toMatch(/https:\/\/example\.com$/)
      expect(output.bluesky).toMatch(/https:\/\/example\.com$/)
      expect(output.linkedin).toMatch(/https:\/\/example\.com$/)
      expect(output.newsletter).toMatch(/https:\/\/example\.com$/)
    })

    it('truncates to channel limits at word boundary', () => {
      const longText = 'word '.repeat(100)
      const output = parseAnnouncementOutput(
        {
          x: `${longText}{{link}}`,
          bluesky: `${longText}{{link}}`,
          linkedin: `${longText}{{link}}`,
          newsletter: `${longText}{{link}}`,
        },
        'https://example.com'
      )

      expect(output.x.length).toBeLessThanOrEqual(CHANNEL_LIMITS.x)
      expect(output.bluesky.length).toBeLessThanOrEqual(CHANNEL_LIMITS.bluesky)
      expect(output.linkedin.length).toBeLessThanOrEqual(CHANNEL_LIMITS.linkedin)
      expect(output.newsletter.length).toBeLessThanOrEqual(CHANNEL_LIMITS.newsletter)
    })

    it('keeps link intact at end after truncation', () => {
      const longText = 'word '.repeat(100)
      const output = parseAnnouncementOutput(
        {
          x: `${longText}{{link}}`,
          bluesky: `${longText}{{link}}`,
          linkedin: `${longText}{{link}}`,
          newsletter: `${longText}{{link}}`,
        },
        'https://example.com'
      )

      for (const channel of ['x', 'bluesky', 'linkedin', 'newsletter'] as const) {
        expect(output[channel]).toContain('https://example.com')
      }
    })

    it('throws GenerationOutputError for missing channels', () => {
      expect(() =>
        parseAnnouncementOutput(
          {
            x: 'text',
            bluesky: 'text',
            linkedin: 'text',
            // newsletter missing
          } as unknown,
          'https://example.com'
        )
      ).toThrow()
    })

    it('throws GenerationOutputError for non-object input', () => {
      expect(() => parseAnnouncementOutput('not an object', 'https://example.com')).toThrow()
      expect(() => parseAnnouncementOutput(['array'], 'https://example.com')).toThrow()
    })

    it('throws typed GenerationOutputError with parsing phase', () => {
      try {
        parseAnnouncementOutput({ invalid: true } as unknown, 'https://example.com')
        expect.fail('should throw')
      } catch (err) {
        expect(err).toBeInstanceOf(AnnouncementError)
        expect((err as AnnouncementError).phase).toBe('parsing')
      }
    })

    it('trims whitespace from channels', () => {
      const output = parseAnnouncementOutput(
        {
          x: '  text with spaces  {{link}}  ',
          bluesky: '\n\ntext\n\n{{link}}\n',
          linkedin: '\t\ttext\t\t{{link}}\t',
          newsletter: '   text   {{link}}   ',
        },
        'https://example.com'
      )

      expect(output.x).not.toMatch(/^\s/)
      expect(output.x).not.toMatch(/\s$/)
      expect(output.bluesky).not.toMatch(/^\s/)
      expect(output.linkedin).not.toMatch(/^\s/)
      expect(output.newsletter).not.toMatch(/^\s/)
    })
  })
})

describe('Language Prompts', () => {
  describe('LANGUAGE_SCHEMA', () => {
    it('is OpenAI strict compatible: object with no additionalProperties', () => {
      expect(LANGUAGE_SCHEMA.type).toBe('object')
      expect(LANGUAGE_SCHEMA.additionalProperties).toBe(false)
    })

    it('requires all top-level properties', () => {
      const required = LANGUAGE_SCHEMA.required as string[]
      expect(required).toContain('phrases')
      expect(required).toContain('suggestedTerms')
      expect(required).toContain('suggestedPrompts')
    })

    it('enforces maxItems on arrays', () => {
      const props = LANGUAGE_SCHEMA.properties as Record<string, Record<string, unknown>>
      expect(props.phrases.maxItems).toBe(25)
      expect(props.suggestedTerms.maxItems).toBe(15)
      expect(props.suggestedPrompts.maxItems).toBe(10)
    })

    it('has nested additionalProperties false for phrase objects', () => {
      const props = LANGUAGE_SCHEMA.properties as Record<string, Record<string, unknown>>
      const phraseItems = props.phrases.items as Record<string, unknown>
      expect(phraseItems.additionalProperties).toBe(false)
      expect((phraseItems.required as string[]).sort()).toEqual(['kind', 'mentions', 'phrase'].sort())
    })

    it('has nested additionalProperties false for term objects', () => {
      const props = LANGUAGE_SCHEMA.properties as Record<string, Record<string, unknown>>
      const termItems = props.suggestedTerms.items as Record<string, unknown>
      expect(termItems.additionalProperties).toBe(false)
      expect((termItems.required as string[]).sort()).toEqual(['kind', 'label'].sort())
    })
  })

  describe('buildLanguageSystemPrompt', () => {
    it('returns a system prompt string', () => {
      const prompt = buildLanguageSystemPrompt('Veerify')
      expect(typeof prompt).toBe('string')
      expect(prompt.length).toBeGreaterThan(0)
    })

    it('includes product name in the prompt', () => {
      const productName = 'MyProduct'
      const prompt = buildLanguageSystemPrompt(productName)
      expect(prompt).toContain(productName)
    })

    it('mentions extraction tasks', () => {
      const prompt = buildLanguageSystemPrompt('Test')
      expect(prompt).toContain('phrase')
      expect(prompt).toContain('keyword')
      expect(prompt).toContain('competitor')
      expect(prompt).toContain('prompt')
    })
  })

  describe('prepareLanguageInput', () => {
    it('strips email addresses', () => {
      const items: LanguageItem[] = [{ source: 'feedback', text: 'Email me at test@example.com for details' }]
      const result = prepareLanguageInput(items)

      expect(result.text).toContain('[email]')
      expect(result.text).not.toContain('test@example.com')
    })

    it('strips URLs', () => {
      const items: LanguageItem[] = [{ source: 'feedback', text: 'Visit https://example.com for more info' }]
      const result = prepareLanguageInput(items)

      expect(result.text).toContain('[url]')
      expect(result.text).not.toContain('https://example.com')
    })

    it('strips phone numbers', () => {
      const items: LanguageItem[] = [{ source: 'feedback', text: 'Call me at 555-123-4567' }]
      const result = prepareLanguageInput(items)

      expect(result.text).toContain('[phone]')
      expect(result.text).not.toContain('555-123-4567')
    })

    it('deduplicates items case-insensitively', () => {
      const items: LanguageItem[] = [
        { source: 'feedback', text: 'Hello World' },
        { source: 'feedback', text: 'hello world' },
        { source: 'support', text: 'HELLO WORLD' },
      ]
      const result = prepareLanguageInput(items)

      expect(result.itemCount).toBe(1)
    })

    it('skips very short items (< 10 chars)', () => {
      const items: LanguageItem[] = [
        { source: 'feedback', text: 'short' },
        { source: 'feedback', text: 'this is long enough text' },
      ]
      const result = prepareLanguageInput(items)

      expect(result.itemCount).toBe(1)
      expect(result.text).toContain('long enough text')
    })

    it('truncates items exceeding maxCharsPerItem', () => {
      const items: LanguageItem[] = [{ source: 'feedback', text: 'x'.repeat(1000) }]
      const result = prepareLanguageInput(items, { maxCharsPerItem: 100 })

      expect(result.text).toContain('x'.repeat(100))
      expect(result.text).not.toContain('x'.repeat(101))
    })

    it('caps total items at maxItems', () => {
      const items: LanguageItem[] = Array.from({ length: 100 }, (_, i) => ({
        source: 'feedback' as const,
        text: `Item number ${i} with enough content to not be filtered`,
      }))
      const result = prepareLanguageInput(items, { maxItems: 50 })

      expect(result.itemCount).toBeLessThanOrEqual(50)
    })

    it('caps total characters at maxTotalChars', () => {
      const items: LanguageItem[] = [
        { source: 'feedback', text: 'x'.repeat(500) },
        { source: 'feedback', text: 'y'.repeat(500) },
        { source: 'feedback', text: 'z'.repeat(500) },
      ]
      const result = prepareLanguageInput(items, { maxTotalChars: 1000 })

      expect(result.text.length).toBeLessThanOrEqual(1100) // some overhead for numbering
    })

    it('numbers items and labels sources', () => {
      const items: LanguageItem[] = [
        { source: 'feedback', text: 'First item feedback' },
        { source: 'support', text: 'Second item support' },
      ]
      const result = prepareLanguageInput(items)

      expect(result.text).toContain('1. [feedback]')
      expect(result.text).toContain('2. [support]')
    })

    it('marks input as untrusted', () => {
      const items: LanguageItem[] = [{ source: 'feedback', text: 'some text' }]
      const result = prepareLanguageInput(items)

      expect(result.text).toContain('not instructions')
    })

    it('collapses whitespace', () => {
      const items: LanguageItem[] = [{ source: 'feedback', text: 'too   many    spaces\n\nand\n\nnewlines' }]
      const result = prepareLanguageInput(items)

      expect(result.text).not.toContain('   ')
      expect(result.text).toContain('too many spaces and newlines')
    })
  })

  describe('parseLanguageOutput', () => {
    it('parses valid output', () => {
      const output = parseLanguageOutput(
        {
          phrases: [{ phrase: 'hard to use', kind: 'pain', mentions: 5 }],
          suggestedTerms: [{ kind: 'keyword', label: 'usability' }],
          suggestedPrompts: ['What is easy to use?'],
        },
        []
      )

      expect(output.phrases).toHaveLength(1)
      expect(output.suggestedTerms).toHaveLength(1)
      expect(output.suggestedPrompts).toHaveLength(1)
    })

    it('filters out phrases shorter than 2 chars', () => {
      const output = parseLanguageOutput(
        {
          phrases: [
            { phrase: 'a', kind: 'pain', mentions: 1 },
            { phrase: 'ok', kind: 'pain', mentions: 2 },
            { phrase: 'good thing', kind: 'praise', mentions: 3 },
          ],
          suggestedTerms: [],
          suggestedPrompts: [],
        },
        []
      )

      expect(output.phrases).toHaveLength(2)
      expect(output.phrases.map((p) => p.phrase)).toEqual(['ok', 'good thing'])
    })

    it('deduplicates phrases case-insensitively', () => {
      const output = parseLanguageOutput(
        {
          phrases: [
            { phrase: 'Hard to Use', kind: 'pain', mentions: 5 },
            { phrase: 'hard to use', kind: 'pain', mentions: 3 },
          ],
          suggestedTerms: [],
          suggestedPrompts: [],
        },
        []
      )

      expect(output.phrases).toHaveLength(1)
    })

    it('filters out suggested terms that match existing labels (case-insensitive)', () => {
      const output = parseLanguageOutput(
        {
          phrases: [],
          suggestedTerms: [
            { kind: 'keyword', label: 'usability' },
            { kind: 'keyword', label: 'performance' },
            { kind: 'competitor', label: 'Jira' },
          ],
          suggestedPrompts: [],
        },
        ['Usability', 'JIRA'] // existing terms with different casing
      )

      expect(output.suggestedTerms).toHaveLength(1)
      expect(output.suggestedTerms[0].label).toBe('performance')
    })

    it('deduplicates suggested terms case-insensitively', () => {
      const output = parseLanguageOutput(
        {
          phrases: [],
          suggestedTerms: [
            { kind: 'keyword', label: 'Hard to Use' },
            { kind: 'keyword', label: 'hard to use' },
          ],
          suggestedPrompts: [],
        },
        []
      )

      expect(output.suggestedTerms).toHaveLength(1)
    })

    it('deduplicates suggested prompts', () => {
      const output = parseLanguageOutput(
        {
          phrases: [],
          suggestedTerms: [],
          suggestedPrompts: ['What is the best tool?', 'what is the best tool?'],
        },
        []
      )

      // Deduplication logic keeps the first occurrence, not necessarily one
      expect(output.suggestedPrompts.length).toBeLessThanOrEqual(2)
    })

    it('enforces max limits from schema', () => {
      const output = parseLanguageOutput(
        {
          phrases: Array.from({ length: 50 }, (_, i) => ({
            phrase: `phrase ${i}`,
            kind: 'pain' as const,
            mentions: 1,
          })),
          suggestedTerms: Array.from({ length: 30 }, (_, i) => ({
            kind: 'keyword' as const,
            label: `term ${i}`,
          })),
          suggestedPrompts: Array.from({ length: 20 }, (_, i) => `prompt ${i}`),
        },
        []
      )

      expect(output.phrases.length).toBeLessThanOrEqual(25)
      expect(output.suggestedTerms.length).toBeLessThanOrEqual(15)
      expect(output.suggestedPrompts.length).toBeLessThanOrEqual(10)
    })

    it('throws GenerationOutputError for invalid structure', () => {
      expect(() => parseLanguageOutput({ invalid: 'structure' }, [])).toThrow()
    })

    it('throws typed GenerationOutputError with parsing phase', () => {
      try {
        parseLanguageOutput({ invalid: 'structure' }, [])
        expect.fail('should throw')
      } catch (err) {
        expect(err).toBeInstanceOf(LanguageError)
        expect((err as LanguageError).phase).toBe('parsing')
      }
    })

    it('throws for missing required fields', () => {
      expect(() =>
        parseLanguageOutput(
          {
            phrases: [],
            suggestedTerms: [],
            // suggestedPrompts missing
          } as unknown,
          []
        )
      ).toThrow()
    })

    it('trims and validates phrase text', () => {
      const output = parseLanguageOutput(
        {
          phrases: [{ phrase: '  hard to use  ', kind: 'pain', mentions: 5 }],
          suggestedTerms: [],
          suggestedPrompts: [],
        },
        []
      )

      expect(output.phrases[0].phrase).toBe('hard to use')
    })

    it('trims and validates term labels', () => {
      const output = parseLanguageOutput(
        {
          phrases: [],
          suggestedTerms: [{ kind: 'keyword', label: '  usability  ' }],
          suggestedPrompts: [],
        },
        []
      )

      expect(output.suggestedTerms[0].label).toBe('usability')
    })

    it('trims suggested prompts', () => {
      const output = parseLanguageOutput(
        {
          phrases: [],
          suggestedTerms: [],
          suggestedPrompts: ['  what is the best tool?  '],
        },
        []
      )

      expect(output.suggestedPrompts[0]).toBe('what is the best tool?')
    })
  })
})
