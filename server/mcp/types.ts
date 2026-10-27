/**
 * Shared types for the Veerify MCP server (see docs/plans for the MCP design).
 * Tools never touch the database: they act through `callApi`, which runs the normal
 * dashboard route stack as the API key's owner.
 */
import type { z } from 'zod'
import type { AuthSession } from '~/server/utils/auth-middleware'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface ApiResult {
  status: number
  body: unknown
}

export interface ApiRequest {
  method: HttpMethod
  path: string
  query?: Record<string, unknown>
  body?: unknown
  /** Extra `x-veerify-*` headers for this call only; merged over the inherited context headers. */
  headers?: Record<string, string>
  /** false: send none of the MCP request's own `x-veerify-*` headers (default true). */
  inheritContext?: boolean
}

export type ApiCaller = (req: ApiRequest) => Promise<ApiResult>

export interface McpToolContext {
  principal: AuthSession
  callApi: ApiCaller
  /**
   * True when the MCP connection itself sends `x-veerify-*` headers. Those headers fix the
   * workspace/project for every call on the connection, so `set_context` must refuse.
   */
  contextPinned: boolean
}

export interface VeerifyTool<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string
  title: string
  description: string
  inputSchema: S
  /** Cross-field rule checked during input validation (raw shapes cannot express it). */
  refine?: { check: (input: z.infer<z.ZodObject<S>>) => boolean; message: string }
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean }
  handler(ctx: McpToolContext, input: z.infer<z.ZodObject<S>>): Promise<unknown>
}

/**
 * Thrown by tool handlers for an expected failure. The server returns `payload`
 * (or `{ error: message }`) as the tool result with `isError: true`.
 */
export class McpToolError extends Error {
  readonly payload: unknown

  constructor(message: string, payload?: unknown) {
    super(message)
    this.name = 'McpToolError'
    this.payload = payload
  }
}
