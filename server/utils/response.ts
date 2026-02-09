/**
 * Standard API response utilities
 * Provides consistent response formats across all endpoints
 */

export interface ApiSuccessResponse<T = any> {
  success: true
  data: T
  message?: string
}

export interface ApiErrorResponse {
  success: false
  error: {
    code: string
    message: string
    details?: any
  }
}

export type ApiResponse<T = any> = ApiSuccessResponse<T> | ApiErrorResponse

/**
 * Creates a standardized success response
 * @param data - The response data
 * @param message - Optional success message
 */
export function createSuccessResponse<T>(
  data: T,
  message?: string
): ApiSuccessResponse<T> {
  return {
    success: true,
    data,
    ...(message && { message })
  }
}

/**
 * Creates a standardized error response
 * @param code - Error code (e.g., VALIDATION_ERROR, UNAUTHORIZED)
 * @param message - Human-readable error message
 * @param details - Optional additional error details
 */
export function createErrorResponse(
  code: string,
  message: string,
  details?: any
): ApiErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details && { details })
    }
  }
}

/**
 * Common error codes
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED'
} as const
