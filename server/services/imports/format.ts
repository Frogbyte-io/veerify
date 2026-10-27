import { z } from 'zod'

export const IMPORT_FORMAT = 'veerify-import/1'
export const MAX_BATCH_RECORDS = 1000
export const MAX_RUN_RECORDS = 50_000

const externalId = z.string().min(1).max(200)
const optionalExternalId = externalId.optional()
const isoDate = z.iso.datetime({ offset: true })
const metadata = z.record(z.string(), z.unknown())

export const importStatusSchema = z.object({
  externalId,
  name: z.string().min(1).max(100),
  color: z.string().max(50).optional(),
  mapTo: z.string().max(100).optional(),
})

export const importCategorySchema = z.object({
  externalId,
  name: z.string().min(1).max(100),
  color: z.string().max(50).optional(),
  mapTo: z.string().max(100).optional(),
})

export const importPersonSchema = z.object({
  externalId,
  name: z.string().max(200).optional(),
  email: z.email().max(320).optional(),
  avatarUrl: z.url().max(2000).optional(),
})

export const importVoteSchema = z.object({
  personExternalId: externalId,
  type: z.enum(['upvote', 'downvote']).default('upvote'),
  createdAt: isoDate.optional(),
})

export const importFeedbackSchema = z.object({
  externalId,
  title: z.string().min(1).max(200),
  body: z.string().max(20_000).optional(),
  url: z.url().max(2000).optional(),
  status: z.string().max(200).optional(),
  category: z.string().max(200).optional(),
  authorExternalId: optionalExternalId,
  createdAt: isoDate.optional(),
  updatedAt: isoDate.optional(),
  votes: z.array(importVoteSchema).optional(),
  voteCount: z.number().int().min(0).optional(),
  isPinned: z.boolean().optional(),
  isLocked: z.boolean().optional(),
  isHidden: z.boolean().optional(),
  metadata: metadata.optional(),
})

export const importCommentSchema = z.object({
  externalId,
  feedbackExternalId: externalId,
  parentExternalId: optionalExternalId,
  body: z.string().min(1).max(20_000),
  authorExternalId: optionalExternalId,
  isInternal: z.boolean().optional(),
  createdAt: isoDate.optional(),
})

export const importChangelogSchema = z.object({
  externalId,
  title: z.string().min(1).max(200),
  body: z.string().max(20_000),
  labels: z.array(z.string().max(100)).optional(),
  publishedAt: isoDate.optional(),
  status: z.enum(['draft', 'published']).optional(),
  feedbackExternalIds: z.array(externalId).optional(),
  products: z.array(z.string().max(200)).optional(),
})

export const importBatchSchema = z.object({
  statuses: z.array(importStatusSchema).default([]),
  categories: z.array(importCategorySchema).default([]),
  people: z.array(importPersonSchema).default([]),
  feedback: z.array(importFeedbackSchema).default([]),
  comments: z.array(importCommentSchema).default([]),
  changelog: z.array(importChangelogSchema).default([]),
})

export const importDocumentSchema = importBatchSchema.extend({
  format: z.literal(IMPORT_FORMAT),
  source: z.string().min(1).max(100),
  sourceLabel: z.string().min(1).max(100),
  target: z.object({
    project: z.string().min(1).max(200),
    product: z.string().min(1).max(200).optional(),
  }),
})

export type ImportStatus = z.infer<typeof importStatusSchema>
export type ImportCategory = z.infer<typeof importCategorySchema>
export type ImportPerson = z.infer<typeof importPersonSchema>
export type ImportVote = z.infer<typeof importVoteSchema>
export type ImportFeedback = z.infer<typeof importFeedbackSchema>
export type ImportComment = z.infer<typeof importCommentSchema>
export type ImportChangelog = z.infer<typeof importChangelogSchema>
export type ImportBatch = z.infer<typeof importBatchSchema>
export type ImportDocument = z.infer<typeof importDocumentSchema>

export type IssueInput = {
  severity: 'warning' | 'error' | 'skipped'
  entityType: string
  externalId?: string
  message: string
}

export function countRecords(batch: ImportBatch): number {
  return (
    batch.statuses.length +
    batch.categories.length +
    batch.people.length +
    batch.feedback.length +
    batch.comments.length +
    batch.changelog.length
  )
}

export function importJsonSchema(): object {
  return z.toJSONSchema(importDocumentSchema, { io: 'input' })
}

export function importExample(): ImportDocument {
  return {
    format: IMPORT_FORMAT,
    source: 'canny',
    sourceLabel: 'Canny',
    target: { project: 'my-project', product: 'my-product' },
    statuses: [{ externalId: 'st-1', name: 'Under review', color: '#f59e0b' }],
    categories: [],
    people: [
      { externalId: 'p-1', name: 'Ada Lovelace', email: 'ada@example.com' },
      { externalId: 'p-2', name: 'Grace Hopper', email: 'grace@example.com' },
    ],
    feedback: [
      {
        externalId: 'f-1',
        title: 'Dark mode',
        body: 'Please add a dark theme.',
        url: 'https://example.canny.io/posts/dark-mode',
        status: 'st-1',
        authorExternalId: 'p-1',
        createdAt: '2025-01-15T10:00:00Z',
        votes: [
          { personExternalId: 'p-1', type: 'upvote', createdAt: '2025-01-15T10:00:00Z' },
          { personExternalId: 'p-2', type: 'upvote' },
        ],
      },
    ],
    comments: [
      {
        externalId: 'c-1',
        feedbackExternalId: 'f-1',
        body: 'We are looking into this.',
        authorExternalId: 'p-1',
        createdAt: '2025-01-16T09:00:00Z',
      },
    ],
    changelog: [
      {
        externalId: 'cl-1',
        title: 'Dark mode is live',
        body: 'Dark mode shipped.',
        status: 'published',
        publishedAt: '2025-02-01T12:00:00Z',
        feedbackExternalIds: ['f-1'],
      },
    ],
  }
}
