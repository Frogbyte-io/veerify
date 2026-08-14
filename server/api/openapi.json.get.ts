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
        email: 'support@veerify.io',
      },
    },
    servers: [
      {
        url: import.meta.dev ? 'http://localhost:3000' : 'https://api.veerify.io',
        description: import.meta.dev ? 'Development server' : 'Production server',
      },
    ],
    tags: [
      { name: 'Authentication', description: 'Authentication and session management' },
      { name: 'Organizations', description: 'Organization management' },
      { name: 'Teams', description: 'Team workspace management' },
      { name: 'Projects', description: 'Project management' },
      { name: 'Feedback', description: 'Feedback and feature request management' },
      { name: 'GitHub', description: 'GitHub integration endpoints' },
      { name: 'Support', description: 'Support platform: contacts, companies, and team settings' },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'better-auth.session_token',
          description: 'Session cookie set by Better-Auth',
        },
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
                details: { type: 'object' },
              },
            },
          },
        },
        Success: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'object' },
            message: { type: 'string' },
          },
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
            updatedAt: { type: 'string', format: 'date-time' },
          },
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
                activeOrganizationId: { type: 'string', nullable: true },
                activeTeamId: { type: 'string', nullable: true },
              },
            },
          },
        },
        Organization: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'org_123' },
            name: { type: 'string', example: 'Acme Inc.' },
            slug: { type: 'string', example: 'acme-inc' },
            logo: { type: 'string', format: 'uri', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Project: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'prj_123' },
            name: { type: 'string', example: 'My Project' },
            slug: { type: 'string', example: 'my-project' },
            description: { type: 'string', nullable: true },
            organizationId: { type: 'string' },
            teamId: { type: 'string' },
            githubRepoUrl: { type: 'string', format: 'uri', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
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
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Contact: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'ctc_123' },
            teamId: { type: 'string' },
            name: { type: 'string', nullable: true },
            email: { type: 'string', format: 'email', nullable: true },
            phone: { type: 'string', nullable: true },
            avatarUrl: { type: 'string', format: 'uri', nullable: true },
            companyId: { type: 'string', nullable: true },
            userId: { type: 'string', nullable: true, description: 'Set when the contact has a Veerify account' },
            attributes: { type: 'object', nullable: true },
            blockedAt: { type: 'string', format: 'date-time', nullable: true },
            mergedIntoContactId: {
              type: 'string',
              nullable: true,
              description: 'Set on a tombstone left behind after a merge',
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        SupportCompany: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'co_123' },
            teamId: { type: 'string' },
            name: { type: 'string' },
            domain: { type: 'string', nullable: true },
            attributes: { type: 'object', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    paths: {
      '/api/support/contacts': {
        get: {
          tags: ['Support'],
          summary: 'List contacts for a team',
          operationId: 'listSupportContacts',
          parameters: [
            { in: 'query', name: 'teamId', required: true, schema: { type: 'string' } },
            { in: 'query', name: 'search', schema: { type: 'string' } },
            { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
            { in: 'query', name: 'cursor', schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Contacts page',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          contacts: { type: 'array', items: { $ref: '#/components/schemas/Contact' } },
                          hasMore: { type: 'boolean' },
                          nextCursor: { type: 'string', nullable: true },
                        },
                      },
                    },
                  },
                },
              },
            },
            '403': { description: 'Not a member of the team' },
          },
        },
        post: {
          tags: ['Support'],
          summary: 'Create a contact',
          operationId: 'createSupportContact',
          responses: {
            '200': { description: 'Contact created' },
            '403': { description: 'Not a member of the team' },
            '409': { description: 'A contact with this email already exists in the team' },
          },
        },
      },
      '/api/support/contacts/{id}': {
        get: {
          tags: ['Support'],
          summary: 'Get a contact with its identities and company',
          operationId: 'getSupportContact',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Contact detail' },
            '403': { description: "Not a member of the contact's team" },
            '404': { description: 'Contact not found' },
          },
        },
        put: {
          tags: ['Support'],
          summary: 'Update a contact',
          operationId: 'updateSupportContact',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Contact updated' },
            '403': { description: "Not a member of the contact's team" },
            '404': { description: 'Contact not found' },
            '409': { description: 'Another contact in the team already uses this email' },
          },
        },
        delete: {
          tags: ['Support'],
          summary: 'Delete a contact',
          description:
            "Hard delete. Cascades the contact's identities and links. Feedback is never touched — contacts and feedback are deliberately not coupled.",
          operationId: 'deleteSupportContact',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Contact deleted' },
            '403': { description: "Not a member of the contact's team" },
            '404': { description: 'Contact not found' },
          },
        },
      },
      '/api/support/contacts/{id}/merge': {
        post: {
          tags: ['Support'],
          summary: 'Merge another contact into this one',
          description:
            'The path contact survives. The source contact is retained as a tombstone with mergedIntoContactId set, so stale references still resolve.',
          operationId: 'mergeSupportContact',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Merged' },
            '400': { description: 'Contacts cannot be merged' },
            '403': { description: "Not a member of the contact's team" },
            '404': { description: 'Contact not found' },
          },
        },
      },
      '/api/support/contacts/{id}/timeline': {
        get: {
          tags: ['Support'],
          summary: "Get a contact's linked and probable feedback timeline",
          operationId: 'getSupportContactTimeline',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Linked entities and probable feedback suggestions, kept in separate sections',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          linked: {
                            type: 'array',
                            description: 'Explicit, agent-confirmed links',
                            items: { type: 'object' },
                          },
                          probableFeedback: {
                            type: 'array',
                            description:
                              'Heuristic matches by email or account — suggestions only, never a confirmed identity',
                            items: { $ref: '#/components/schemas/Feedback' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '403': { description: "Not a member of the contact's team" },
            '404': { description: 'Contact not found' },
          },
        },
      },
      '/api/support/contacts/{id}/links': {
        post: {
          tags: ['Support'],
          summary: 'Explicitly link a feedback item to a contact',
          operationId: 'createSupportContactLink',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Link created' },
            '400': { description: "Target is not in the contact's team" },
            '403': { description: "Not a member of the contact's team" },
            '404': { description: 'Contact not found' },
            '409': { description: 'Link already exists' },
          },
        },
      },
      '/api/support/contacts/{id}/links/{linkId}': {
        delete: {
          tags: ['Support'],
          summary: 'Remove an explicit contact link',
          operationId: 'deleteSupportContactLink',
          parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
            { in: 'path', name: 'linkId', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Link removed' },
            '403': { description: "Not a member of the contact's team" },
            '404': { description: 'Contact or link not found' },
          },
        },
      },
      '/api/support/companies': {
        get: {
          tags: ['Support'],
          summary: 'List companies for a team',
          operationId: 'listSupportCompanies',
          parameters: [
            { in: 'query', name: 'teamId', required: true, schema: { type: 'string' } },
            { in: 'query', name: 'search', schema: { type: 'string' } },
            { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
            { in: 'query', name: 'cursor', schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Companies page',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          companies: { type: 'array', items: { $ref: '#/components/schemas/SupportCompany' } },
                          hasMore: { type: 'boolean' },
                          nextCursor: { type: 'string', nullable: true },
                        },
                      },
                    },
                  },
                },
              },
            },
            '403': { description: 'Not a member of the team' },
          },
        },
        post: {
          tags: ['Support'],
          summary: 'Create a company',
          operationId: 'createSupportCompany',
          responses: {
            '200': { description: 'Company created' },
            '403': { description: 'Not a member of the team' },
            '409': { description: 'A company with this name or domain already exists in the team' },
          },
        },
      },
      '/api/support/companies/{id}': {
        get: {
          tags: ['Support'],
          summary: 'Get a company',
          operationId: 'getSupportCompany',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Company detail' },
            '403': { description: "Not a member of the company's team" },
            '404': { description: 'Company not found' },
          },
        },
        put: {
          tags: ['Support'],
          summary: 'Update a company',
          operationId: 'updateSupportCompany',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Company updated' },
            '403': { description: "Not a member of the company's team" },
            '404': { description: 'Company not found' },
            '409': { description: 'Another company in the team already uses this name or domain' },
          },
        },
        delete: {
          tags: ['Support'],
          summary: 'Delete a company',
          description:
            'Hard delete. Contacts referencing this company have their companyId cleared (onDelete set null) rather than being deleted themselves.',
          operationId: 'deleteSupportCompany',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Company deleted' },
            '403': { description: "Not a member of the company's team" },
            '404': { description: 'Company not found' },
          },
        },
      },
      '/api/support/teams/{teamId}/settings': {
        get: {
          tags: ['Support'],
          summary: 'Get support team settings',
          operationId: 'getSupportTeamSettings',
          parameters: [{ in: 'path', name: 'teamId', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Support team settings' },
            '403': { description: 'Not a member of the team' },
          },
        },
        put: {
          tags: ['Support'],
          summary: 'Change support team settings',
          operationId: 'updateSupportTeamSettings',
          parameters: [{ in: 'path', name: 'teamId', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Support team settings updated' },
            '403': { description: 'Not a member of the team' },
          },
        },
      },
    },
  }

  return spec
})
