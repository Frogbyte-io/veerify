/**
 * OpenAPI Specification Endpoint
 * Serves the OpenAPI 3.0 specification for all API endpoints
 */

import { openapiPaths } from '~/server/generated/openapi-routes'

export default defineEventHandler(() => {
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
        ContactLink: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            contactId: { type: 'string' },
            entityType: { type: 'string', enum: ['feedback', 'conversation'] },
            entityId: { type: 'string' },
            source: { type: 'string', enum: ['auto', 'agent'] },
            createdByUserId: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
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
            lastReadAt: {
              type: 'string',
              format: 'date-time',
              nullable: true,
              description: "The current agent's per-conversation read cursor",
            },
            isUnread: {
              type: 'boolean',
              description: 'Viewer-specific unread state after the handled-conversation supersede rule',
            },
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
            deliveryStatus: { type: 'string', enum: ['pending', 'sent', 'delivered', 'failed', 'bounced'] },
            createdAt: { type: 'string', format: 'date-time' },
            attachments: {
              type: 'array',
              items: { $ref: '#/components/schemas/ConversationAttachmentMetadata' },
              description: 'Finalized attachments only; storage keys are never returned.',
            },
          },
        },
        ConversationAttachmentMetadata: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            fileName: { type: 'string' },
            contentType: { type: 'string', nullable: true },
            sizeBytes: { type: 'integer', minimum: 1, nullable: true },
            downloadUrl: { type: 'string' },
          },
          required: ['id', 'fileName', 'contentType', 'sizeBytes', 'downloadUrl'],
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
    paths: openapiPaths,
  }

  return spec
})
