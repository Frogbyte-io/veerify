import { describe, expect, it } from 'vitest'
import {
  IMPORT_FORMAT,
  MAX_BATCH_RECORDS,
  MAX_RUN_RECORDS,
  countRecords,
  importDocumentSchema,
  importExample,
  importJsonSchema,
} from '~/server/services/imports/format'

describe('import format', () => {
  it('exports constants', () => {
    expect(IMPORT_FORMAT).toBe('veerify-import/1')
    expect(MAX_BATCH_RECORDS).toBe(1000)
    expect(MAX_RUN_RECORDS).toBe(50_000)
  })

  it('parses the example', () => {
    expect(importDocumentSchema.safeParse(importExample()).success).toBe(true)
  })

  it('rejects invalid documents', () => {
    const bad = (mutate: (d: any) => void) => {
      const d = structuredClone(importExample()) as any
      mutate(d)
      return importDocumentSchema.safeParse(d).success
    }
    expect(bad((d) => (d.format = 'veerify-import/2'))).toBe(false)
    expect(bad((d) => (d.feedback[0].externalId = ''))).toBe(false)
    expect(bad((d) => (d.feedback[0].title = 'x'.repeat(201)))).toBe(false)
    expect(bad((d) => (d.feedback[0].votes[0].type = 'meh'))).toBe(false)
    expect(bad((d) => (d.feedback[0].voteCount = -1))).toBe(false)
  })

  it('defaults vote type and sections', () => {
    const d = importDocumentSchema.parse({
      format: IMPORT_FORMAT,
      source: 's',
      sourceLabel: 'S',
      target: { project: 'p' },
      feedback: [{ externalId: '1', title: 't', votes: [{ personExternalId: 'a' }] }],
    })
    expect(d.feedback[0]!.votes![0]!.type).toBe('upvote')
    expect(d.comments).toEqual([])
    expect(d.people).toEqual([])
  })

  it('example is internally consistent', () => {
    const d = importDocumentSchema.parse(importExample())
    const people = new Set(d.people.map((p) => p.externalId))
    const fb = new Set(d.feedback.map((f) => f.externalId))
    const cm = new Set(d.comments.map((c) => c.externalId))
    const st = new Set(d.statuses.map((s) => s.externalId))
    for (const f of d.feedback) {
      for (const v of f.votes ?? []) expect(people.has(v.personExternalId)).toBe(true)
      if (f.authorExternalId) expect(people.has(f.authorExternalId)).toBe(true)
      if (f.status) expect(st.has(f.status)).toBe(true)
    }
    for (const c of d.comments) {
      expect(fb.has(c.feedbackExternalId)).toBe(true)
      if (c.parentExternalId) expect(cm.has(c.parentExternalId)).toBe(true)
      if (c.authorExternalId) expect(people.has(c.authorExternalId)).toBe(true)
    }
    for (const c of d.changelog) for (const id of c.feedbackExternalIds ?? []) expect(fb.has(id)).toBe(true)
  })

  it('counts records', () => {
    expect(countRecords(importDocumentSchema.parse(importExample()))).toBe(6)
  })

  it('builds a JSON schema', () => {
    const s = importJsonSchema() as any
    expect(s.properties.feedback).toBeDefined()
    expect(s.required).not.toContain('feedback')
    expect(s.required).not.toContain('statuses')
    for (const k of ['format', 'source', 'sourceLabel', 'target']) expect(s.required).toContain(k)
  })
})
