/**
 * OpenAPI Specification Endpoint
 * Serves the OpenAPI 3.0 specification for all API endpoints
 */

export default defineEventHandler((event) => {
  const spec = {
    openapi: '3.0.0',
    info: {
      title: 'Veerify API',
      version: '1.0.0',
      description: 'API documentation for Veerify - Feedback management and verification platform',
      contact: {
        name: 'Veerify Support',
        email: 'support@veerify.com'
      }
    },
    servers: [
      {
        url: import.meta.dev ? 'http://localhost:3000' : 'https://api.veerify.com',
        description: import.meta.dev ? 'Development server' : 'Production server'
      }
    ],
    tags: [
      { name: 'Authentication', description: 'Authentication and session management' },
      { name: 'Organizations', description: 'Organization management' },
      { name: 'Projects', description: 'Project management' },
      { name: 'Feedback', description: 'Feedback and feature request management' },
      { name: 'GitHub', description: 'GitHub integration endpoints' }
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'better-auth.session_token',
          description: 'Session cookie set by Better-Auth'
        }
      },
      schemas: {
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
        },
        Success: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'object' },
            message: { type: 'string' }
          }
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'usr_123' },
            email: { type: 'string', format: 'email' },
            name: { type: 'string' },
            emailVerified: { type: 'boolean' },
            image: { type: 'string', format: 'uri', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        Session: {
          type: 'object',
          properties: {
            user: { $ref: '#/components/schemas/User' },
            session: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                userId: { type: 'string' },
                expiresAt: { type: 'string', format: 'date-time' },
                activeOrganizationId: { type: 'string', nullable: true }
              }
            }
          }
        },
        Organization: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'org_123' },
            name: { type: 'string', example: 'Acme Inc.' },
            slug: { type: 'string', example: 'acme-inc' },
            logo: { type: 'string', format: 'uri', nullable: true },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        Project: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'prj_123' },
            name: { type: 'string', example: 'My Project' },
            slug: { type: 'string', example: 'my-project' },
            description: { type: 'string', nullable: true },
            organizationId: { type: 'string' },
            githubRepoUrl: { type: 'string', format: 'uri', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        Feedback: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'fb_123' },
            title: { type: 'string' },
            description: { type: 'string' },
            status: { type: 'string', enum: ['open', 'in_progress', 'completed', 'closed'] },
            priority: { type: 'string', enum: ['low', 'medium', 'high'] },
            voteCount: { type: 'integer' },
            projectId: { type: 'string' },
            authorId: { type: 'string' },
            githubIssueNumber: { type: 'integer', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    },
    paths: {} // Paths will be added as routes are implemented
  }

  return spec
})
