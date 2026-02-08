/**
 * OpenAPI documentation utilities
 * Provides helpers for documenting API endpoints
 */

export interface OpenAPIOperation {
  summary: string
  description?: string
  tags?: string[]
  operationId?: string
  security?: Array<{ [key: string]: string[] }>
  parameters?: OpenAPIParameter[]
  requestBody?: OpenAPIRequestBody
  responses: {
    [statusCode: string]: OpenAPIResponse
  }
}

export interface OpenAPIParameter {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  description?: string
  required?: boolean
  schema: OpenAPISchema
}

export interface OpenAPIRequestBody {
  description?: string
  required?: boolean
  content: {
    [mediaType: string]: {
      schema: OpenAPISchema
    }
  }
}

export interface OpenAPIResponse {
  description: string
  content?: {
    [mediaType: string]: {
      schema: OpenAPISchema
    }
  }
}

export interface OpenAPISchema {
  type?: string
  properties?: { [key: string]: OpenAPISchema }
  items?: OpenAPISchema
  required?: string[]
  example?: any
  enum?: any[]
  format?: string
  description?: string
  $ref?: string
}

/**
 * Helper to create OpenAPI metadata for route handlers
 * This metadata can be extracted and compiled into the OpenAPI spec
 */
export function defineOpenAPIRoute(operation: OpenAPIOperation) {
  return {
    __openapi: operation
  }
}

/**
 * Common OpenAPI schemas for reuse
 */
export const commonSchemas = {
  Error: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: false },
      error: {
        type: 'object',
        properties: {
          code: { type: 'string', example: 'VALIDATION_ERROR' },
          message: { type: 'string', example: 'Request validation failed' },
          details: { type: 'object' }
        }
      }
    }
  } as OpenAPISchema,

  Success: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      data: { type: 'object' },
      message: { type: 'string' }
    }
  } as OpenAPISchema,

  Pagination: {
    type: 'object',
    properties: {
      page: { type: 'integer', example: 1 },
      limit: { type: 'integer', example: 20 },
      total: { type: 'integer', example: 100 },
      totalPages: { type: 'integer', example: 5 }
    }
  } as OpenAPISchema,

  User: {
    type: 'object',
    properties: {
      id: { type: 'string', example: 'usr_123' },
      email: { type: 'string', format: 'email', example: 'user@example.com' },
      name: { type: 'string', example: 'John Doe' },
      emailVerified: { type: 'boolean', example: true },
      image: { type: 'string', format: 'uri', example: 'https://example.com/avatar.jpg' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' }
    }
  } as OpenAPISchema,

  Session: {
    type: 'object',
    properties: {
      id: { type: 'string', example: 'ses_123' },
      userId: { type: 'string', example: 'usr_123' },
      expiresAt: { type: 'string', format: 'date-time' },
      activeOrganizationId: { type: 'string', example: 'org_123' }
    }
  } as OpenAPISchema,

  Organization: {
    type: 'object',
    properties: {
      id: { type: 'string', example: 'org_123' },
      name: { type: 'string', example: 'Acme Inc.' },
      slug: { type: 'string', example: 'acme-inc' },
      logo: { type: 'string', format: 'uri' },
      createdAt: { type: 'string', format: 'date-time' }
    }
  } as OpenAPISchema,

  Project: {
    type: 'object',
    properties: {
      id: { type: 'string', example: 'prj_123' },
      name: { type: 'string', example: 'My Project' },
      slug: { type: 'string', example: 'my-project' },
      description: { type: 'string', example: 'A great project' },
      organizationId: { type: 'string', example: 'org_123' },
      githubRepoUrl: { type: 'string', format: 'uri', example: 'https://github.com/org/repo' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' }
    }
  } as OpenAPISchema,

  Feedback: {
    type: 'object',
    properties: {
      id: { type: 'string', example: 'fb_123' },
      title: { type: 'string', example: 'Feature request' },
      description: { type: 'string', example: 'Please add dark mode' },
      status: { type: 'string', enum: ['open', 'in_progress', 'completed', 'closed'] },
      priority: { type: 'string', enum: ['low', 'medium', 'high'] },
      voteCount: { type: 'integer', example: 42 },
      projectId: { type: 'string', example: 'prj_123' },
      authorId: { type: 'string', example: 'usr_123' },
      githubIssueNumber: { type: 'integer', example: 123 },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' }
    }
  } as OpenAPISchema
}

/**
 * Common OpenAPI responses
 */
export const commonResponses = {
  unauthorized: {
    description: 'Unauthorized - Authentication required',
    content: {
      'application/json': {
        schema: commonSchemas.Error
      }
    }
  } as OpenAPIResponse,

  forbidden: {
    description: 'Forbidden - Insufficient permissions',
    content: {
      'application/json': {
        schema: commonSchemas.Error
      }
    }
  } as OpenAPIResponse,

  notFound: {
    description: 'Not found',
    content: {
      'application/json': {
        schema: commonSchemas.Error
      }
    }
  } as OpenAPIResponse,

  validationError: {
    description: 'Validation error',
    content: {
      'application/json': {
        schema: commonSchemas.Error
      }
    }
  } as OpenAPIResponse,

  rateLimited: {
    description: 'Rate limit exceeded',
    content: {
      'application/json': {
        schema: commonSchemas.Error
      }
    }
  } as OpenAPIResponse,

  notImplemented: {
    description: 'Not implemented - Endpoint is scaffolded but not yet implemented',
    content: {
      'application/json': {
        schema: commonSchemas.Error
      }
    }
  } as OpenAPIResponse,

  internalError: {
    description: 'Internal server error',
    content: {
      'application/json': {
        schema: commonSchemas.Error
      }
    }
  } as OpenAPIResponse
}
