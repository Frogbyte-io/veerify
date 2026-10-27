/**
 * The six universal MCP tools: identity, context switching, API discovery and the
 * generic `call_api`. Every tool acts through `ctx.callApi`, i.e. as the key's owner.
 */
import { z } from 'zod'
import { isBlockedApiPath, normalizeApiPath, BLOCKED_API_PREFIXES } from '../api-bridge'
import { getApiOperation, searchApi } from '../api-search'
import { McpToolError, type ApiRequest, type ApiResult, type McpToolContext, type VeerifyTool } from '../types'

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

export function defineTool<S extends z.ZodRawShape>(tool: VeerifyTool<S>): VeerifyTool {
  return tool as unknown as VeerifyTool
}

/** Throws a tool error carrying `{ status, body }` unless the call succeeded. */
export function assertOk(result: ApiResult): ApiResult {
  if (result.status >= 400) {
    throw new McpToolError(`API request failed with status ${result.status}`, {
      status: result.status,
      body: result.body,
    })
  }
  return result
}

export async function getData<T>(ctx: McpToolContext, req: ApiRequest): Promise<T> {
  const { body } = assertOk(await ctx.callApi(req))
  return (body as { data: T }).data
}

type WorkspaceEntry = { id: string; name: string; slug: string; logo: string | null; role: string }
type ProjectEntry = { id: string; slug: string; name: string; organizationId: string }
type ActiveProjectData = { project: { id: string }; organization: { id: string } } & Record<string, unknown>

async function resolveWorkspace(ctx: McpToolContext, ref: string): Promise<WorkspaceEntry> {
  const workspaces = await getData<WorkspaceEntry[]>(ctx, { method: 'GET', path: '/api/organizations/list' })
  const needle = ref.trim().toLowerCase()
  const match = workspaces.find((w) => w.id === ref.trim()) ?? workspaces.find((w) => w.slug.toLowerCase() === needle)
  if (!match) {
    throw new McpToolError(`Workspace "${ref}" not found among your workspaces. Use list_workspaces to see them.`)
  }
  return match
}

/** Lists projects of `organizationId` (that workspace only), or of the current context when omitted. */
function listProjectsRequest(organizationId?: string): ApiRequest {
  return organizationId
    ? {
        method: 'GET',
        path: '/api/projects',
        headers: { 'x-veerify-organization': organizationId },
        inheritContext: false,
      }
    : { method: 'GET', path: '/api/projects' }
}

async function resolveProject(ctx: McpToolContext, ref: string, workspace?: WorkspaceEntry): Promise<ProjectEntry> {
  const projects = await getData<ProjectEntry[]>(ctx, listProjectsRequest(workspace?.id))
  const needle = ref.trim().toLowerCase()
  const match = projects.find((p) => p.id === ref.trim()) ?? projects.find((p) => p.slug.toLowerCase() === needle)
  if (!match) {
    const where = workspace ? `workspace "${workspace.slug}"` : 'the active workspace'
    throw new McpToolError(`Project "${ref}" not found in ${where}. Use list_projects to see them.`)
  }
  return match
}

/**
 * Builds the whoami payload. `stored: true` reads the context stored on the key, ignoring the
 * MCP request's own `x-veerify-*` override headers (used right after set_context).
 */
async function whoami(ctx: McpToolContext, opts: { stored?: boolean; fallbackOrganizationId?: string | null } = {}) {
  const { user } = ctx.principal
  const result = await ctx.callApi({
    method: 'GET',
    path: '/api/projects/active',
    ...(opts.stored ? { inheritContext: false } : {}),
  })

  const base = {
    user: { id: user.id, name: user.name, email: user.email },
    credential: 'api_key' as const,
    contextPinned: ctx.contextPinned,
  }
  // 409: the caller can open no project in the workspace yet. The principal's stored
  // organization may since have been deleted, so only a workspace set_context just verified
  // is reported; otherwise null.
  if (result.status === 409) {
    return {
      ...base,
      activeOrganizationId: opts.fallbackOrganizationId ?? null,
      activeProjectId: null,
      project: null,
    }
  }
  const data = (assertOk(result).body as { data: ActiveProjectData }).data
  return {
    ...base,
    activeOrganizationId: data.organization.id,
    activeProjectId: data.project.id,
    ...data,
  }
}

export const CONTEXT_PINNED_MESSAGE =
  'This connection fixes its workspace/project with X-Veerify-Organization / X-Veerify-Project headers, so set_context cannot change it. Remove those headers from the MCP configuration to switch with set_context, or pass a different workspace to list_projects.'

const optionalRef = z.string().trim().min(1).optional()

export const universalTools: VeerifyTool[] = [
  defineTool({
    name: 'whoami',
    title: 'Who am I',
    description:
      'Returns the user this API key acts as, the active workspace and project, and the project details (organization, products, enabled modules). Call this first.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
    handler: (ctx) => whoami(ctx),
  }),

  defineTool({
    name: 'list_workspaces',
    title: 'List workspaces',
    description: 'Lists the workspaces (organizations) you belong to, with your role in each.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
    handler: (ctx) => getData(ctx, { method: 'GET', path: '/api/organizations/list' }),
  }),

  defineTool({
    name: 'list_projects',
    title: 'List projects',
    description:
      'Lists the projects you can open in the active workspace, or in `workspace` (id or slug) when given. Does not change the active context.',
    inputSchema: {
      workspace: optionalRef.describe('Workspace id or slug; defaults to the active workspace'),
    },
    annotations: { readOnlyHint: true },
    handler: async (ctx, input) => {
      const workspace = input.workspace ? await resolveWorkspace(ctx, input.workspace) : undefined
      return getData(ctx, listProjectsRequest(workspace?.id))
    },
  }),

  defineTool({
    name: 'set_context',
    title: 'Set workspace and project',
    description:
      'Switches the active workspace and/or project for this API key (stored on the key, so later requests use it). Accepts ids or slugs. Not available when the connection fixes its context with X-Veerify-* headers (see whoami `contextPinned`). With only `workspace`, the first project you can open there becomes active. Returns the new whoami.',
    inputSchema: {
      workspace: optionalRef.describe('Workspace id or slug'),
      project: optionalRef.describe('Project id or slug (within `workspace` when given, else the active workspace)'),
    },
    refine: {
      check: (input) => Boolean(input.workspace || input.project),
      message: 'Provide at least one of `workspace` or `project`',
    },
    annotations: { destructiveHint: false, idempotentHint: true },
    handler: async (ctx, input) => {
      // Connection headers win on every later call, so a stored switch would be invisible
      // and the agent would act in a different workspace than it believes (Review Focus 3).
      if (ctx.contextPinned) throw new McpToolError(CONTEXT_PINNED_MESSAGE)

      const workspace = input.workspace ? await resolveWorkspace(ctx, input.workspace) : undefined
      const project = input.project ? await resolveProject(ctx, input.project, workspace) : undefined

      // Unpinned connections send no context headers; inheritContext: false makes sure the
      // switch persists on the key and the follow-up whoami reads the stored context.
      if (workspace) {
        assertOk(
          await ctx.callApi({
            method: 'POST',
            path: '/api/organizations/active',
            body: project ? { organizationId: workspace.id, projectId: project.id } : { organizationId: workspace.id },
            inheritContext: false,
          })
        )
      }
      if (project) {
        assertOk(
          await ctx.callApi({
            method: 'POST',
            path: '/api/projects/active',
            body: { projectId: project.id },
            inheritContext: false,
          })
        )
      }

      return whoami(ctx, { stored: true, fallbackOrganizationId: workspace?.id ?? null })
    },
  }),

  defineTool({
    name: 'search_api',
    title: 'Search the Veerify API',
    description:
      'Finds Veerify API operations to run with call_api. Search by `query` (keywords) and/or `tag`; pass `operationId` to get the full operation (parameters, request body, responses).',
    inputSchema: {
      query: z.string().optional().describe('Keywords, e.g. "feedback status"'),
      tag: z.string().optional().describe('OpenAPI tag, e.g. "Feedback"'),
      operationId: z.string().trim().min(1).optional().describe('Return the details of this operation'),
      limit: z.number().int().min(1).max(25).optional().describe('Max results (default 10, max 25)'),
    },
    refine: {
      check: (input) => Boolean(input.query?.trim() || input.tag?.trim() || input.operationId),
      message: 'Provide `query`, `tag` or `operationId`',
    },
    annotations: { readOnlyHint: true },
    handler: async (_ctx, input) => {
      if (input.operationId) {
        const operation = getApiOperation(input.operationId)
        if (!operation) {
          throw new McpToolError(`Operation "${input.operationId}" not found. Search with \`query\` first.`)
        }
        return operation
      }
      return searchApi(input.query ?? '', { tag: input.tag, limit: input.limit })
    },
  }),

  defineTool({
    name: 'call_api',
    title: 'Call the Veerify API',
    description:
      'Calls a Veerify API operation (find it with search_api) as your user and returns `{ status, body }`. `path` is the concrete path under /api/ with path parameters filled in. Context headers are applied as for every other tool.',
    inputSchema: {
      method: z.enum(HTTP_METHODS),
      path: z.string().min(1).describe('Concrete path under /api/, e.g. /api/projects/acme/statuses'),
      query: z.record(z.string(), z.unknown()).optional().describe('Query string parameters'),
      body: z.unknown().optional().describe('JSON request body'),
    },
    annotations: { destructiveHint: true },
    handler: async (ctx, input) => {
      const normalized = normalizeApiPath(input.path)
      if (normalized === null) {
        throw new McpToolError(
          `Path refused: "${input.path}" must be a path under /api/ (no URLs, no traversal outside /api/, no double encoding).`
        )
      }
      if (isBlockedApiPath(normalized)) {
        throw new McpToolError(
          `Path refused: "${input.path}" is under a blocked prefix (${BLOCKED_API_PREFIXES.join(', ')}). These routes are not available to API keys.`
        )
      }
      const result = assertOk(
        await ctx.callApi({ method: input.method, path: normalized, query: input.query, body: input.body })
      )
      return { status: result.status, body: result.body }
    },
  }),
]
