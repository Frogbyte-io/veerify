/**
 * Builds the Veerify MCP server for one authenticated principal. The transport (Task 11)
 * creates one per `/mcp` request with an API caller bound to that request's credentials.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { universalTools } from './tools/universal'
import { McpToolError, type McpToolContext, type VeerifyTool } from './types'

export const MCP_SERVER_NAME = 'veerify'
export const MCP_SERVER_VERSION = '1.0.0'

export const MCP_INSTRUCTIONS = [
  "Veerify is a feedback, roadmap, changelog, support and marketing platform. This server acts as the owner of the personal API key: every call has exactly that user's permissions.",
  '1. Start with `whoami` to see who you are and which workspace and project are active.',
  '2. Use `list_workspaces` / `list_projects` and pick a workspace and project with `set_context` (ids or slugs). Most API routes work inside the active project.',
  '3. Find operations with `search_api` (keywords or tag; pass `operationId` for parameters and request body), then run them with `call_api` using the concrete path under /api/.',
  'If the MCP connection sends X-Veerify-Organization / X-Veerify-Project headers, those headers fix the workspace/project for every call (`whoami` shows `contextPinned: true`) and `set_context` is unavailable; `list_projects` still accepts another workspace.',
  'Results are JSON. API failures come back as a tool error whose content is `{ status, body }`, where body is `{ success: false, error: { code, message } }`.',
].join('\n')

function jsonResult(value: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value ?? null) }],
    ...(isError ? { isError: true } : {}),
  }
}

function inputSchemaFor(tool: VeerifyTool) {
  if (!tool.refine) return tool.inputSchema
  const { check, message } = tool.refine
  return z.object(tool.inputSchema).refine(check, { message })
}

export function createVeerifyMcpServer(ctx: McpToolContext): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { instructions: MCP_INSTRUCTIONS, capabilities: { tools: {} } }
  )

  for (const tool of universalTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: inputSchemaFor(tool),
        annotations: { title: tool.title, ...tool.annotations },
      },
      async (args: unknown): Promise<CallToolResult> => {
        try {
          return jsonResult(await tool.handler(ctx, (args ?? {}) as Parameters<VeerifyTool['handler']>[1]))
        } catch (error) {
          if (error instanceof McpToolError) return jsonResult(error.payload ?? { error: error.message }, true)
          const message = error instanceof Error ? error.message : String(error)
          return jsonResult({ error: `Tool ${tool.name} failed: ${message}` }, true)
        }
      }
    )
  }

  return server
}
