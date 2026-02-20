/**
 * Input validation utilities using Zod
 * Provides schema validation and standardized error handling
 */

import { z } from 'zod'
import type { H3Event } from 'h3'
import { ErrorCode, createErrorResponse } from './response'

/**
 * Validates request body against a Zod schema
 * @param event - H3 event
 * @param schema - Zod schema to validate against
 * @returns Validated and typed data
 * @throws 400 Validation error if schema validation fails
 */
export async function validateBody<T extends z.ZodType>(event: H3Event, schema: T): Promise<z.infer<T>> {
  try {
    const body = await readBody(event)
    const result = schema.safeParse(body)

    if (!result.success) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Validation failed',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Request validation failed', result.error.issues),
      })
    }

    return result.data
  } catch (error) {
    // If it's already a validation error, re-throw
    if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 400) {
      throw error
    }

    // Otherwise, it's a parsing error
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Failed to parse request body'),
    })
  }
}

/**
 * Validates query parameters against a Zod schema
 * @param event - H3 event
 * @param schema - Zod schema to validate against
 * @returns Validated and typed query parameters
 * @throws 400 Validation error if schema validation fails
 */
export function validateQuery<T extends z.ZodType>(event: H3Event, schema: T): z.infer<T> {
  const query = getQuery(event)
  const result = schema.safeParse(query)

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid query parameters',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Query parameter validation failed', result.error.issues),
    })
  }

  return result.data
}

/**
 * Common validation schemas
 */
export const commonSchemas = {
  // Pagination
  pagination: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),

  // Sorting
  sort: z.object({
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  }),

  // ID validation
  id: z.string().min(1, 'ID is required'),
  uuid: z.string().uuid('Invalid UUID format'),

  // Text fields
  slug: z
    .string()
    .min(1, 'Slug is required')
    .max(100, 'Slug too long')
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens'),

  // Email
  email: z.string().email('Invalid email format'),

  // URLs
  url: z.string().url('Invalid URL format'),
}
