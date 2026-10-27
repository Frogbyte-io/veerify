import { describe, expect, it } from 'vitest'
import { importDocumentSchema } from '../server/services/imports/format'
import { convertCsvToImport } from '../server/services/imports/converters/csv'
import { convertSleekplanApiToImport } from '../server/services/imports/converters/sleekplan'

const schema = importDocumentSchema.omit({ target: true })

describe('import converters', () => {
  it('converts a generic csv into a veerify-import/1 document', () => {
    const text = [
      'record_type,external_id,title,body,category,status,feedback_external_id,email',
      'feedback,fb_1,Need better search,Users cannot filter by label,Feature Request,Open,,',
      'roadmap,rm_1,Q3 search revamp,Improve relevance,Search,Planned,,',
      'changelog,ch_1,Search launch,We shipped search v2,Release,,,',
      'comment,c_1,,Following this thread,,,fb_1,',
      'subscription,sub_1,,,,,,watcher@example.com',
      'subscription,sub_2,,,,,fb_1,notify@example.com',
      'feedback,fb_bad,,Missing title row,Feature Request,Open,,',
    ].join('\n')

    const { document, warnings } = convertCsvToImport([{ name: 'in.csv', text }], {})
    expect(schema.parse(document)).toBeTruthy()
    expect(document).toMatchObject({ format: 'veerify-import/1', source: 'csv', sourceLabel: 'CSV' })
    expect(document.feedback.map((f) => f.externalId)).toEqual(['fb_1', 'rm_1'])
    expect(document.feedback[0]).toMatchObject({
      title: 'Need better search',
      status: 'open',
      category: 'feature-request',
    })
    expect(document.feedback[1]).toMatchObject({ status: 'planned' })
    expect(document.changelog).toHaveLength(1)
    expect(document.changelog[0]).toMatchObject({ externalId: 'ch_1', title: 'Search launch' })
    expect(document.comments[0]).toMatchObject({ externalId: 'c_1', feedbackExternalId: 'fb_1' })
    expect(document.categories.map((c) => c.name)).toEqual(
      expect.arrayContaining(['Feature Request', 'Search', 'Release'])
    )
    expect(document.statuses.map((s) => s.externalId)).toEqual(expect.arrayContaining(['open', 'planned']))
    expect(warnings.some((w) => /subscription/i.test(w))).toBe(true)
    expect(warnings.some((w) => /title is missing/.test(w))).toBe(true)
  })

  it('honours source overrides and turns authors into people', () => {
    const text = [
      'title,author_name,author_email,created_at,votes',
      'A,Ada,ADA@Example.com,2025-01-02,3',
      'B,Bob,not-an-email,not a date,',
    ].join('\n')
    const { document, warnings } = convertCsvToImport([{ name: 'a.csv', text }], { source: 'x', sourceLabel: 'X' })
    expect(schema.parse(document)).toBeTruthy()
    expect(document.source).toBe('x')
    expect(document.people[0]).toMatchObject({ externalId: 'ada@example.com', email: 'ada@example.com', name: 'Ada' })
    expect(document.feedback[0]).toMatchObject({ authorExternalId: 'ada@example.com', voteCount: 3 })
    expect(document.feedback[0].createdAt).toBe('2025-01-02T00:00:00.000Z')
    expect(document.people[1].email).toBeUndefined()
    expect(document.people[1].name).toBe('Bob')
    expect(document.feedback[1].createdAt).toBeUndefined()
    expect(warnings.some((w) => /invalid email/.test(w))).toBe(true)
    expect(warnings.some((w) => /unparseable date/.test(w))).toBe(true)
  })

  it('truncates over-long titles with a warning', () => {
    const { document, warnings } = convertCsvToImport([{ name: 'a.csv', text: `title\n${'x'.repeat(250)}` }], {})
    expect(document.feedback[0].title).toHaveLength(200)
    expect(schema.safeParse(document).success).toBe(true)
    expect(warnings.some((w) => /truncated/.test(w))).toBe(true)
  })

  it('detects the Sleekplan multi-file csv export', () => {
    const feedback =
      'feedback_id,title,description,status_name,type_name,created,total_up\nf1,Dark mode,Please,Under review,Idea,2025-03-01 10:00:00,5'
    const comments = 'comment_id,feedback_id,comment,user_full_name,user_mail,public\nc1,f1,Nice,Ann,ann@x.io,0'
    const votes = 'feedback_id,vote\nf1,1\nf1,1'
    const users = 'user_id,data_mail,product_id\nu1,a@b.io,1\nu2,x@anonymous.dummy,1'
    const { document, warnings } = convertCsvToImport(
      [
        { name: 'feedback.csv', text: feedback },
        { name: 'comments.csv', text: comments },
        { name: 'votes.csv', text: votes },
        { name: 'users.csv', text: users },
        { name: 'other.csv', text: 'a,b\n1,2' },
      ],
      {}
    )
    expect(schema.parse(document)).toBeTruthy()
    expect(document.feedback[0]).toMatchObject({ externalId: 'f1', status: 'under_review', voteCount: 2 })
    expect(document.comments[0]).toMatchObject({ isInternal: true, authorExternalId: 'ann@x.io' })
    expect(warnings.some((w) => /1 subscription/.test(w))).toBe(true)
    expect(warnings.some((w) => /other\.csv/.test(w))).toBe(true)
  })

  it('converts sleekplan api payloads and warns when sections are missing', () => {
    const { document, warnings } = convertSleekplanApiToImport({
      items: [
        {
          id: 'item_1',
          title: 'Need changelog filters',
          description: 'Customers want filtering by release type.',
          status: 'open',
          category_name: 'Feature Request',
          votes: 7,
        },
      ],
      changelog: [{ id: 'change_1', title: 'Release 1.2', body: 'Added import history.', category: 'Release' }],
      categories: [{ id: 'cat_1', name: 'Feature Request', color: '#22c55e' }],
      statuses: [{ id: 'status_1', name: 'Open', value: 'open', color: '#3b82f6' }],
      roadmap: [{ id: 'road_1', title: 'Import dashboard', status: 'planned' }],
    })
    expect(schema.parse(document)).toBeTruthy()
    expect(document).toMatchObject({ source: 'sleekplan', sourceLabel: 'Sleekplan' })
    expect(document.feedback).toHaveLength(2)
    expect(document.feedback[0]).toMatchObject({ externalId: 'item_1', voteCount: 7, status: 'open' })
    expect(document.feedback[1]).toMatchObject({ externalId: 'road_1', status: 'planned' })
    expect(document.changelog).toHaveLength(1)
    expect(document.categories[0]).toMatchObject({ name: 'Feature Request', color: '#22c55e' })
    expect(document.statuses[0]).toMatchObject({ name: 'Open', color: '#3b82f6' })
    expect(warnings.some((w) => /comments/i.test(w))).toBe(true)
    expect(warnings.some((w) => /subscribers/i.test(w))).toBe(true)
  })

  it('keeps id-less items and comments distinct and warns on dropped rows', () => {
    const { document, warnings } = convertSleekplanApiToImport({
      items: [{ title: 'Same' }, { title: 'Same' }, { description: 'no title' }],
      comments: [
        { item_id: 'x', body: 'ok' },
        { item_id: 'x', body: 'ok' },
        { item_id: 'x' },
        { item_id: 'gone', body: 'orphan', id: 'o1' },
      ],
      changelog: [{ title: 'only title' }],
      subscriptions: [],
    })
    // item_id 'x' matches no feedback, so give feedback ids via a second run below
    expect(document.feedback).toHaveLength(2)
    expect(new Set(document.feedback.map((f) => f.externalId)).size).toBe(2)
    expect(warnings.some((w) => /title is missing/.test(w))).toBe(true)
    expect(warnings.some((w) => /feedback id or body is missing/.test(w))).toBe(true)
    expect(warnings.some((w) => /changelog 1: skipped/.test(w))).toBe(true)
    expect(document.comments).toHaveLength(0)
    expect(warnings.some((w) => /not in the import/.test(w))).toBe(true)

    const second = convertSleekplanApiToImport({
      items: [{ id: 'x', title: 'T' }],
      comments: [
        { item_id: 'x', body: 'ok' },
        { item_id: 'x', body: 'ok' },
      ],
    })
    expect(second.document.comments).toHaveLength(2)
    expect(new Set(second.document.comments.map((c) => c.externalId)).size).toBe(2)
    expect(schema.safeParse(second.document).success).toBe(true)
  })

  it('caps over-long status and category names', () => {
    const { document, warnings } = convertCsvToImport(
      [
        {
          name: 'a.csv',
          text: `title,status,category
A,${'s'.repeat(300)},${'c'.repeat(300)}`,
        },
      ],
      {}
    )
    expect(schema.safeParse(document).success).toBe(true)
    expect(warnings.some((w) => /truncated/.test(w))).toBe(true)
  })
})
