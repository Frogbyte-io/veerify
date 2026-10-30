/**
 * Mail tools: thin wrappers over the project email routes (Project settings → Email). Domains
 * live under `/api/support/projects/{projectId}/sending-domains`, addresses under
 * `/api/support/inboxes/{inboxId}/addresses`, the project overview and forward destinations
 * under `/api/projects/{slug}/mail`. Managing domains and addresses needs a project admin (or
 * inbox admin for addresses); reading needs project access.
 * See docs/plans/2026-10-28-email-addresses/design.md.
 */
import { z } from 'zod'
import { McpToolError, type McpToolContext, type VeerifyTool } from '../types'
import { defineTool, getData } from './universal'

/** One safe URL path segment: callApi decodes once and resolves `..`, so `/` and dot segments must never reach a path. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/
const isSafeSegment = (value: string) => SAFE_SEGMENT.test(value) && value !== '.' && value !== '..'
const safeSegment = () =>
  z.string().trim().refine(isSafeSegment, {
    message: 'Must contain only letters, digits, ".", "_" or "-" (no "/" and not "." or "..")',
  })

const projectField = safeSegment().optional().describe('Project slug; defaults to the active project (see whoami)')
const inboxIdField = safeSegment().describe('Inbox id (`inboxId` in mail_list_addresses)')
const addressIdField = safeSegment().describe('Address id from mail_list_addresses')
const domainIdField = safeSegment().describe('Domain id from mail_list_domains')
const destinationIdField = safeSegment().describe('Forward id (`forwards[].id`) from mail_list_addresses')
const forwardToField = z
  .array(z.string().trim().email())
  .max(5)
  .describe(
    'External mailboxes to forward to, at most 5. Each must confirm once per domain (an email from Frogmail) before mail is forwarded. Needs forwarding on (mail_list_addresses → forwarding) and a verified domain'
  )

interface ProjectRef {
  id: string
  slug: string
}

/** `project`, or the active project when omitted, with its id (domain routes are keyed by id). */
async function resolveProject(ctx: McpToolContext, project?: string): Promise<ProjectRef> {
  const data = project
    ? await getData<{ id?: string; slug?: string }>(ctx, {
        method: 'GET',
        path: `/api/projects/${encodeURIComponent(project)}`,
      })
    : (
        await getData<{ project?: { id?: string; slug?: string } }>(ctx, {
          method: 'GET',
          path: '/api/projects/active',
        })
      )?.project
  if (!data?.id || !data.slug) {
    throw new McpToolError('No active project. Pass `project` (slug) or pick one with set_context.')
  }
  if (!isSafeSegment(data.id) || !isSafeSegment(data.slug)) {
    throw new McpToolError('The project id or slug is not a valid path segment.')
  }
  return { id: data.id, slug: data.slug }
}

async function domainsBase(ctx: McpToolContext, project?: string): Promise<string> {
  const { id } = await resolveProject(ctx, project)
  return `/api/support/projects/${encodeURIComponent(id)}/sending-domains`
}

async function mailBase(ctx: McpToolContext, project?: string): Promise<string> {
  const { slug } = await resolveProject(ctx, project)
  return `/api/projects/${encodeURIComponent(slug)}/mail`
}

function addressPath(inboxId: string, addressId?: string): string {
  const base = `/api/support/inboxes/${encodeURIComponent(inboxId)}/addresses`
  return addressId ? `${base}/${encodeURIComponent(addressId)}` : base
}

export const mailTools: VeerifyTool[] = [
  defineTool({
    name: 'mail_list_domains',
    title: 'List email domains',
    description:
      "Lists the project's email domains with status (provisioning, pending, verified, suspended, failed, deleting), receiving status and every DNS record to publish (ownership TXT, DKIM, SPF, MX for receiving, optional DMARC) with a live status. Also returns the workspace limits.",
    inputSchema: { project: projectField },
    annotations: { readOnlyHint: true },
    handler: async (ctx, input) => getData(ctx, { method: 'GET', path: await domainsBase(ctx, input.project) }),
  }),

  defineTool({
    name: 'mail_add_domain',
    title: 'Connect an email domain',
    description:
      'Connects a domain (or subdomain, e.g. mail.example.com) to the project (project admin). Returns the DNS records the user must add at their DNS host; then call mail_verify_domain. A subdomain keeps an existing mail system on the apex untouched. Counts toward the workspace domain limit (409 MAIL_DOMAIN_LIMIT_REACHED / MAIL_PENDING_LIMIT_REACHED).',
    inputSchema: {
      project: projectField,
      domain: z.string().trim().min(1).max(253).describe('The domain, e.g. "newsite.com" or "mail.newsite.com"'),
    },
    handler: async (ctx, input) =>
      getData(ctx, { method: 'POST', path: await domainsBase(ctx, input.project), body: { domain: input.domain } }),
  }),

  defineTool({
    name: 'mail_verify_domain',
    title: 'Check an email domain now',
    description:
      "Re-checks the DNS records of a domain immediately instead of waiting for the background check (project admin). Returns the domain with each record's status.",
    inputSchema: { project: projectField, domainId: domainIdField },
    handler: async (ctx, input) =>
      getData(ctx, {
        method: 'POST',
        path: `${await domainsBase(ctx, input.project)}/${encodeURIComponent(input.domainId)}/verify`,
      }),
  }),

  defineTool({
    name: 'mail_remove_domain',
    title: 'Remove an email domain',
    description:
      'Removes a domain from the project (project admin): stops sending and receiving on it and revokes its forward destinations. Fails with 409 DOMAIN_IN_USE (listing the inboxes) while inboxes still send from it; `force: true` removes it anyway. Confirm with the user first.',
    inputSchema: {
      project: projectField,
      domainId: domainIdField,
      force: z.boolean().optional().describe('Remove even while inboxes still send from it'),
    },
    annotations: { destructiveHint: true },
    handler: async (ctx, input) =>
      getData(ctx, {
        method: 'DELETE',
        path: `${await domainsBase(ctx, input.project)}/${encodeURIComponent(input.domainId)}`,
        ...(input.force ? { query: { force: 'true' } } : {}),
      }),
  }),

  defineTool({
    name: 'mail_list_addresses',
    title: 'List email addresses',
    description:
      "Lists the project's email addresses: the inbox each delivers to, whether it delivers to the inbox, its forwards with confirmation status (pending, verified, revoked, suspended), behaviour (helpdesk or mail), product, and route status. Also returns the domains with receiving status, whether forwarding is available (`forwarding`), and workspace usage against the limits (addresses, domains, forwards this month).",
    inputSchema: { project: projectField },
    annotations: { readOnlyHint: true },
    handler: async (ctx, input) =>
      getData(ctx, { method: 'GET', path: `${await mailBase(ctx, input.project)}/addresses` }),
  }),

  defineTool({
    name: 'mail_list_inboxes',
    title: 'List inboxes',
    description: "Lists the project's inboxes (id, name). Use an id as `inboxId` when creating an address.",
    inputSchema: { project: projectField },
    annotations: { readOnlyHint: true },
    handler: async (ctx, input) => {
      const { id } = await resolveProject(ctx, input.project)
      return getData(ctx, { method: 'GET', path: '/api/support/inboxes', query: { projectId: id } })
    },
  }),

  defineTool({
    name: 'mail_create_address',
    title: 'Create an email address',
    description:
      'Creates an address on one of the project\'s domains, e.g. hello@newsite.com, or a catch-all `*@newsite.com` for every address on the domain no other address takes. Mail goes to the inbox, to `forwardTo` mailboxes, or both (`deliverToInbox: false` makes it forward-only). `behaviour`: "helpdesk" (default; auto-reply, SLA, CSAT and automation apply) or "mail" (plain mail). Counts toward the workspace address limit (409 MAIL_ADDRESS_LIMIT_REACHED).',
    inputSchema: {
      inboxId: inboxIdField,
      address: z.string().trim().min(3).max(320).describe('The address, or *@domain for a catch-all'),
      deliverToInbox: z.boolean().optional().describe('Default true. False needs at least one forward'),
      forwardTo: forwardToField.optional(),
      behaviour: z.enum(['helpdesk', 'mail']).optional(),
      productId: z.string().trim().min(1).optional().describe('Tag the address with a product of the project'),
      isPrimary: z.boolean().optional().describe("Make it the inbox's primary address (its default sender)"),
    },
    handler: async (ctx, input) => {
      const { inboxId, ...body } = input
      return getData(ctx, { method: 'POST', path: addressPath(inboxId), body })
    },
  }),

  defineTool({
    name: 'mail_update_address',
    title: 'Update an email address',
    description:
      "Changes an address: delivery (`deliverToInbox`, `forwardTo` replaces its forwards, [] removes them), behaviour, product, primary flag, or moves it to another inbox of the project (`moveToInboxId`). Removing a forward keeps the mailbox's confirmation for the domain.",
    inputSchema: {
      inboxId: inboxIdField,
      addressId: addressIdField,
      deliverToInbox: z.boolean().optional(),
      forwardTo: forwardToField.optional(),
      behaviour: z.enum(['helpdesk', 'mail']).optional(),
      productId: z.string().trim().min(1).nullable().optional().describe('A product of the project, or null to clear'),
      isPrimary: z.boolean().optional(),
      moveToInboxId: safeSegment().optional().describe('Another inbox of the same project'),
    },
    handler: async (ctx, input) => {
      const { inboxId, addressId, moveToInboxId, ...body } = input
      return getData(ctx, {
        method: 'PATCH',
        path: addressPath(inboxId, addressId),
        body: moveToInboxId ? { ...body, inboxId: moveToInboxId } : body,
      })
    },
  }),

  defineTool({
    name: 'mail_delete_address',
    title: 'Delete an email address',
    description:
      'Deletes an address and its provider route. Mail to it stops arriving (a catch-all on the domain takes it, if there is one). Existing conversations stay. Confirm with the user first.',
    inputSchema: { inboxId: inboxIdField, addressId: addressIdField },
    annotations: { destructiveHint: true },
    handler: async (ctx, input) =>
      getData(ctx, { method: 'DELETE', path: addressPath(input.inboxId, input.addressId) }),
  }),

  defineTool({
    name: 'mail_resend_forward_confirmation',
    title: 'Resend a forward confirmation',
    description:
      "Sends a new confirmation email to a forward mailbox that has not confirmed, bounced (suspended) or was stopped (revoked); it becomes pending again (project admin). 429 when Frogmail's rate limit holds it back (the error says when to retry); 409 when already confirmed.",
    inputSchema: { project: projectField, destinationId: destinationIdField },
    handler: async (ctx, input) =>
      getData(ctx, {
        method: 'POST',
        path: `${await mailBase(ctx, input.project)}/destinations/${encodeURIComponent(input.destinationId)}/resend`,
      }),
  }),

  defineTool({
    name: 'mail_stop_forwarding',
    title: 'Stop forwarding to a mailbox',
    description:
      'Revokes a forward mailbox for its domain (project admin): every address on the domain stops forwarding to it. It can be re-enabled later with mail_resend_forward_confirmation. Confirm with the user first.',
    inputSchema: { project: projectField, destinationId: destinationIdField },
    annotations: { destructiveHint: true },
    handler: async (ctx, input) =>
      getData(ctx, {
        method: 'DELETE',
        path: `${await mailBase(ctx, input.project)}/destinations/${encodeURIComponent(input.destinationId)}`,
      }),
  }),
]
