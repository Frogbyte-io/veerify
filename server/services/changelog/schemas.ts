import { z } from 'zod'
import { CHANGELOG_LABELS, MAX_BODY_LENGTH, MAX_LINKED_FEEDBACK, MAX_SUMMARY_LENGTH } from './entries'

const labels = z
  .array(z.enum(CHANGELOG_LABELS))
  .max(CHANGELOG_LABELS.length)
  .transform((value) => [...new Set(value)])

const feedbackIds = z.array(z.string().trim().min(1).max(200)).max(MAX_LINKED_FEEDBACK)

const productIds = z.array(z.string().trim().min(1).max(200)).max(50)

export const createEntrySchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  summary: z.string().trim().max(MAX_SUMMARY_LENGTH).nullish(),
  body: z.string().max(MAX_BODY_LENGTH).optional(),
  labels: labels.optional(),
  feedbackIds: feedbackIds.optional(),
  productIds: productIds.optional(),
})

export const updateEntrySchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200).optional(),
  summary: z.string().trim().max(MAX_SUMMARY_LENGTH).nullable().optional(),
  body: z.string().max(MAX_BODY_LENGTH).optional(),
  labels: labels.optional(),
  feedbackIds: feedbackIds.optional(),
  productIds: productIds.optional(),
})

export const previewSchema = z.object({ body: z.string().max(MAX_BODY_LENGTH) })

export const listQuerySchema = z.object({
  status: z.enum(['draft', 'published']).optional(),
  productId: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

export const searchQuerySchema = z.object({ q: z.string().trim().max(200).optional() })

export const publicListQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  product: z.string().trim().min(1).max(200).optional(),
})
