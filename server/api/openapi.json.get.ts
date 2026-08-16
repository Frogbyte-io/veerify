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
      {
        name: 'Support',
        description: 'Support platform: contacts, companies, inboxes, conversations, tags, and team settings',
      },
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
        SupportInbox: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'ibx_123' },
            teamId: { type: 'string' },
            projectId: { type: 'string', nullable: true, description: 'Optional single-product link' },
            name: { type: 'string' },
            slug: { type: 'string' },
            type: { type: 'string', example: 'email' },
            channelConfig: { type: 'object', nullable: true },
            emailAddress: {
              type: 'string',
              nullable: true,
              description: 'Primary sending identity; receiving addresses live in SupportInboxAddress',
            },
            forwardAddress: { type: 'string', nullable: true },
            fromName: { type: 'string', nullable: true },
            signature: { type: 'string', nullable: true },
            autoReplyEnabled: { type: 'boolean' },
            autoReplyTemplate: { type: 'string', nullable: true },
            defaultAssigneeUserId: { type: 'string', nullable: true },
            isEnabled: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        SupportInboxAddress: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            inboxId: { type: 'string' },
            address: { type: 'string' },
            projectId: { type: 'string', nullable: true, description: 'Null means unattributed' },
            isPrimary: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        SupportInboxMember: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            inboxId: { type: 'string' },
            userId: { type: 'string' },
            role: { type: 'string', enum: ['agent', 'supervisor', 'admin'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Conversation: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'cnv_123' },
            inboxId: { type: 'string' },
            teamId: { type: 'string' },
            contactId: { type: 'string' },
            projectId: { type: 'string', nullable: true },
            displayId: { type: 'integer', description: 'Per-team ticket number' },
            subject: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['open', 'pending', 'resolved', 'snoozed', 'closed'] },
            priority: { type: 'string', nullable: true, enum: ['low', 'normal', 'high', 'urgent'] },
            assigneeUserId: { type: 'string', nullable: true },
            linkedFeedbackId: { type: 'string', nullable: true },
            channelThreadKey: { type: 'string', nullable: true },
            firstResponseAt: { type: 'string', format: 'date-time', nullable: true },
            resolvedAt: { type: 'string', format: 'date-time', nullable: true },
            snoozedUntil: { type: 'string', format: 'date-time', nullable: true },
            lastActivityAt: { type: 'string', format: 'date-time', nullable: true },
            lastCustomerReplyAt: { type: 'string', format: 'date-time', nullable: true },
            lastAgentReplyAt: { type: 'string', format: 'date-time', nullable: true },
            metadata: { type: 'object', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        ConversationMessage: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            conversationId: { type: 'string' },
            kind: { type: 'string', enum: ['incoming', 'outgoing', 'note', 'activity'] },
            body: { type: 'string', nullable: true },
            bodyHtml: { type: 'string', nullable: true },
            senderKind: { type: 'string', enum: ['contact', 'agent', 'system'] },
            senderContactId: { type: 'string', nullable: true },
            senderUserId: { type: 'string', nullable: true },
            isPrivate: { type: 'boolean', description: 'Derived from kind; notes and activity are private' },
            channelMessageId: { type: 'string', nullable: true },
            inReplyTo: { type: 'string', nullable: true },
            channelHeaders: { type: 'object', nullable: true },
            deliveryStatus: { type: 'string', enum: ['pending', 'sent', 'delivered', 'failed', 'bounced'] },
            deliveryError: { type: 'string', nullable: true },
            metadata: { type: 'object', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        ConversationParticipant: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            conversationId: { type: 'string' },
            contactId: { type: 'string', nullable: true, description: 'Set for a CC-d customer' },
            userId: { type: 'string', nullable: true, description: 'Set for an internal follower' },
            role: { type: 'string', enum: ['cc', 'follower'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        SupportTag: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            teamId: { type: 'string' },
            name: { type: 'string' },
            color: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
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
      '/api/support/inboxes': {
        get: {
          tags: ['Support'],
          summary: 'List inboxes for a team',
          operationId: 'listSupportInboxes',
          parameters: [{ in: 'query', name: 'teamId', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Inbox list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          inboxes: { type: 'array', items: { $ref: '#/components/schemas/SupportInbox' } },
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
          summary: 'Create an inbox',
          description: 'The creator is added as a supportInboxMember with role admin in the same transaction.',
          operationId: 'createSupportInbox',
          responses: {
            '200': { description: 'Inbox created' },
            '400': { description: 'projectId does not belong to this team' },
            '403': { description: 'Not a member of the team' },
            '409': { description: 'An inbox with this slug already exists in the team' },
          },
        },
      },
      '/api/support/inboxes/{id}': {
        get: {
          tags: ['Support'],
          summary: 'Get an inbox',
          operationId: 'getSupportInbox',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Inbox detail' },
            '403': { description: 'Not a member of this inbox or a team admin' },
            '404': { description: 'Inbox not found' },
          },
        },
        put: {
          tags: ['Support'],
          summary: 'Update inbox settings',
          description: 'Channel and provider configuration is Stage 03 and is not settable here.',
          operationId: 'updateSupportInbox',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Inbox updated' },
            '400': { description: 'projectId or defaultAssigneeUserId does not belong to this team' },
            '403': { description: 'Not a member of this inbox or a team admin' },
            '404': { description: 'Inbox not found' },
            '409': { description: 'Another inbox in the team already uses this slug' },
          },
        },
        delete: {
          tags: ['Support'],
          summary: 'Delete an inbox',
          description: 'conversation.inboxId is a restrict FK, so an inbox with conversations cannot be deleted.',
          operationId: 'deleteSupportInbox',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Inbox deleted' },
            '403': { description: 'Not a member of this inbox or a team admin' },
            '404': { description: 'Inbox not found' },
            '409': { description: 'Inbox still has conversations' },
          },
        },
      },
      '/api/support/inboxes/{id}/addresses': {
        get: {
          tags: ['Support'],
          summary: "List an inbox's receiving addresses",
          operationId: 'listSupportInboxAddresses',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Address list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          addresses: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/SupportInboxAddress' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '403': { description: 'Not a member of this inbox or a team admin' },
            '404': { description: 'Inbox not found' },
          },
        },
        post: {
          tags: ['Support'],
          summary: 'Add a receiving address to an inbox',
          description: 'Addresses are lowercased on write. Setting isPrimary clears it on the inbox other addresses.',
          operationId: 'createSupportInboxAddress',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Address created' },
            '400': { description: 'projectId does not belong to this team' },
            '403': { description: 'Not a member of this inbox or a team admin' },
            '404': { description: 'Inbox not found' },
            '409': { description: 'This address is already in use' },
          },
        },
      },
      '/api/support/inboxes/{id}/addresses/{addressId}': {
        delete: {
          tags: ['Support'],
          summary: 'Remove a receiving address from an inbox',
          operationId: 'deleteSupportInboxAddress',
          parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
            { in: 'path', name: 'addressId', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Address deleted' },
            '403': { description: 'Not a member of this inbox or a team admin' },
            '404': { description: 'Inbox or address not found' },
          },
        },
      },
      '/api/support/inboxes/{id}/members': {
        get: {
          tags: ['Support'],
          summary: "List an inbox's agent members",
          operationId: 'listSupportInboxMembers',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Member list' },
            '403': { description: 'Not a member of this inbox or a team admin' },
            '404': { description: 'Inbox not found' },
          },
        },
        post: {
          tags: ['Support'],
          summary: 'Add an agent to an inbox',
          description: "The target user must already be a member of the inbox's team.",
          operationId: 'addSupportInboxMember',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Member added' },
            '400': { description: 'userId is not a member of this team' },
            '403': { description: 'Not a member of this inbox or a team admin' },
            '404': { description: 'Inbox not found' },
            '409': { description: 'User is already a member of this inbox' },
          },
        },
      },
      '/api/support/inboxes/{id}/members/{memberId}': {
        delete: {
          tags: ['Support'],
          summary: 'Remove an agent from an inbox',
          operationId: 'removeSupportInboxMember',
          parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
            { in: 'path', name: 'memberId', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Member removed' },
            '403': { description: 'Not a member of this inbox or a team admin' },
            '404': { description: 'Inbox or member not found' },
          },
        },
      },
      '/api/support/conversations': {
        get: {
          tags: ['Support'],
          summary: 'List conversations in an inbox',
          operationId: 'listSupportConversations',
          parameters: [
            { in: 'query', name: 'inboxId', required: true, schema: { type: 'string' } },
            {
              in: 'query',
              name: 'status',
              schema: { type: 'string', enum: ['open', 'pending', 'resolved', 'snoozed', 'closed'] },
            },
            { in: 'query', name: 'assigneeUserId', schema: { type: 'string' } },
            { in: 'query', name: 'contactId', schema: { type: 'string' } },
            { in: 'query', name: 'tagId', schema: { type: 'string' } },
            { in: 'query', name: 'projectId', schema: { type: 'string' } },
            { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
            { in: 'query', name: 'cursor', schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Conversation page',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          conversations: { type: 'array', items: { $ref: '#/components/schemas/Conversation' } },
                          hasMore: { type: 'boolean' },
                          nextCursor: { type: 'string', nullable: true },
                        },
                      },
                    },
                  },
                },
              },
            },
            '403': { description: 'Not a member of this inbox or a team admin' },
            '404': { description: 'Inbox not found' },
          },
        },
        post: {
          tags: ['Support'],
          summary: 'Create a conversation',
          description: 'The Stage 02 manual entry point - creates the ticket shell only, with no messages.',
          operationId: 'createSupportConversation',
          responses: {
            '200': { description: 'Conversation created' },
            '400': { description: 'contactId or projectId does not belong to this team' },
            '403': { description: 'Not a member of this inbox or a team admin' },
            '404': { description: 'Inbox not found' },
          },
        },
      },
      '/api/support/conversations/{id}': {
        get: {
          tags: ['Support'],
          summary: 'Get a conversation with its contact and participants',
          operationId: 'getSupportConversation',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Conversation detail' },
            '403': { description: 'Not a member of this inbox or a team admin' },
            '404': { description: 'Conversation not found' },
          },
        },
        patch: {
          tags: ['Support'],
          summary: "Update a conversation's status, priority, assignee, subject, or product",
          description:
            'Status, priority, assignee, and product changes also write an activity message into the thread, in the same transaction. Subject changes deliberately do not.',
          operationId: 'updateSupportConversation',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Conversation updated' },
            '400': { description: 'assigneeUserId or projectId does not belong to this team' },
            '403': { description: 'Not a member of this inbox or a team admin' },
            '404': { description: 'Conversation not found' },
          },
        },
      },
      '/api/support/conversations/{id}/messages': {
        get: {
          tags: ['Support'],
          summary: "Get a conversation's message thread",
          description:
            'Returns the most recent window in ascending (oldest-first) order. hasMore means older history exists above the window. All kinds are included, private notes too, since this is the agent-facing thread.',
          operationId: 'listSupportConversationMessages',
          parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
            { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 500, default: 200 } },
          ],
          responses: {
            '200': {
              description: 'Message thread, oldest first',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          messages: { type: 'array', items: { $ref: '#/components/schemas/ConversationMessage' } },
                          hasMore: { type: 'boolean' },
                        },
                      },
                    },
                  },
                },
              },
            },
            '403': { description: 'Not a member of this inbox or a team admin' },
            '404': { description: 'Conversation not found' },
          },
        },
        post: {
          tags: ['Support'],
          summary: 'Write an agent reply or an internal note to a conversation',
          description:
            'Only outgoing and note kinds may be created here. isPrivate is derived from kind server-side and is never read from the request body. Stage 02 stores the message; Stage 04 sends it, so deliveryStatus starts at pending.',
          operationId: 'createSupportConversationMessage',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Message created' },
            '400': { description: 'Validation failed' },
            '403': { description: 'Not a member of this inbox or a team admin' },
            '404': { description: 'Conversation not found' },
          },
        },
      },
      '/api/support/conversations/{id}/participants': {
        post: {
          tags: ['Support'],
          summary: 'Add a CC or follower to a conversation',
          description: "Exactly one of contactId (a CC'd customer) or userId (an internal follower) must be set.",
          operationId: 'addSupportConversationParticipant',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Participant added' },
            '400': {
              description: 'Neither or both of contactId/userId set, or the target does not belong to this team',
            },
            '403': { description: 'Not a member of this inbox or a team admin' },
            '404': { description: 'Conversation not found' },
            '409': { description: 'This participant is already on the conversation' },
          },
        },
      },
      '/api/support/conversations/{id}/participants/{participantId}': {
        delete: {
          tags: ['Support'],
          summary: 'Remove a CC or follower from a conversation',
          operationId: 'removeSupportConversationParticipant',
          parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
            { in: 'path', name: 'participantId', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Participant removed' },
            '403': { description: 'Not a member of this inbox or a team admin' },
            '404': { description: 'Conversation or participant not found' },
          },
        },
      },
      '/api/support/conversations/{id}/tags': {
        get: {
          tags: ['Support'],
          summary: "List a conversation's tags",
          operationId: 'listSupportConversationTags',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Tag list' },
            '403': { description: 'Not a member of this inbox or a team admin' },
            '404': { description: 'Conversation not found' },
          },
        },
        post: {
          tags: ['Support'],
          summary: 'Add a tag to a conversation',
          operationId: 'addSupportConversationTag',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Tag added' },
            '400': { description: 'Tag is not part of this team' },
            '403': { description: 'Not a member of this inbox or a team admin' },
            '404': { description: 'Conversation not found' },
            '409': { description: 'This tag is already on the conversation' },
          },
        },
      },
      '/api/support/conversations/{id}/tags/{tagId}': {
        delete: {
          tags: ['Support'],
          summary: 'Remove a tag from a conversation',
          operationId: 'removeSupportConversationTag',
          parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
            { in: 'path', name: 'tagId', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Tag removed' },
            '403': { description: 'Not a member of this inbox or a team admin' },
            '404': { description: 'Conversation not found, or tag is not on the conversation' },
          },
        },
      },
      '/api/support/tags': {
        get: {
          tags: ['Support'],
          summary: 'List tags for a team',
          operationId: 'listSupportTags',
          parameters: [{ in: 'query', name: 'teamId', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Tag list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          tags: { type: 'array', items: { $ref: '#/components/schemas/SupportTag' } },
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
          summary: 'Create a tag',
          operationId: 'createSupportTag',
          responses: {
            '200': { description: 'Tag created' },
            '403': { description: 'Not a member of the team' },
            '409': { description: 'A tag with this name already exists in this team' },
          },
        },
      },
      '/api/support/tags/{id}': {
        delete: {
          tags: ['Support'],
          summary: 'Delete a tag',
          description: 'conversationTag rows cascade, so deleting a tag unassigns it from every conversation.',
          operationId: 'deleteSupportTag',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Tag deleted' },
            '403': { description: "Not a member of the tag's team" },
            '404': { description: 'Tag not found' },
          },
        },
      },
    },
  }

  return spec
})
