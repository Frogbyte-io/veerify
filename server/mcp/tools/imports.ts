/**
 * Import tools: thin wrappers over the `/api/projects/{slug}/imports` routes (project admin
 * only). The agent converts the source to the `veerify-import/1` format, adds records in
 * batches, shows the preview to the user, then commits.
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
const runIdField = safeSegment().describe('Import run id returned by import_create_run')

/** The slug of `project`, or of the active project when omitted. */
async function resolveSlug(ctx: McpToolContext, project?: string): Promise<string> {
  if (project) return project
  const data = await getData<{ project?: { slug?: string } }>(ctx, { method: 'GET', path: '/api/projects/active' })
  const slug = data?.project?.slug
  if (slug && !isSafeSegment(slug)) throw new McpToolError('The active project slug is not a valid path segment.')
  if (!slug) throw new McpToolError('No active project. Pass `project` (slug) or pick one with set_context.')
  return slug
}

async function importsBase(ctx: McpToolContext, project?: string): Promise<string> {
  return `/api/projects/${encodeURIComponent(await resolveSlug(ctx, project))}/imports`
}

async function runBase(ctx: McpToolContext, project: string | undefined, runId: string): Promise<string> {
  return `${await importsBase(ctx, project)}/${encodeURIComponent(runId)}`
}

export const IMPORT_SCHEMA_RESOURCE_URI = 'veerify://imports/schema'

export function fetchImportFormat(ctx: McpToolContext): Promise<unknown> {
  return getData(ctx, { method: 'GET', path: '/api/imports/schema' })
}

export const importTools: VeerifyTool[] = [
  defineTool({
    name: 'import_get_format',
    title: 'Get the import format',
    description:
      'Returns the `veerify-import/1` format: a JSON Schema plus an example batch. Call this first, convert the source data to this format, then create a run.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
    handler: (ctx) => fetchImportFormat(ctx),
  }),

  defineTool({
    name: 'import_create_run',
    title: 'Create an import run',
    description:
      'Creates a draft import run in a project (project admin required). Add records with import_add_records, then import_preview and import_commit. `onExisting`: "sync" (default; update records seen before unless edited in Veerify) or "skip" (only create new records).',
    inputSchema: {
      project: projectField,
      product: z.string().trim().min(1).optional().describe('Product slug or id for the imported feedback'),
      source: z.string().trim().min(1).describe('Source system, e.g. "canny"'),
      sourceLabel: z.string().trim().min(1).describe('Human-readable label for this run'),
      onExisting: z.enum(['sync', 'skip']).optional(),
    },
    handler: async (ctx, input) => {
      const body: Record<string, unknown> = { source: input.source, sourceLabel: input.sourceLabel }
      if (input.product) body.product = input.product
      if (input.onExisting) body.onExisting = input.onExisting
      return getData(ctx, { method: 'POST', path: await importsBase(ctx, input.project), body })
    },
  }),

  defineTool({
    name: 'import_add_records',
    title: 'Add records to an import run',
    description:
      'Stages one batch of records (statuses, categories, people, feedback, comments, changelog) on a draft run. `records` must follow the import_get_format schema. Limits: at most 1,000 records per call and the request must fit 4 MiB; send larger sources in several calls. The server validates and returns per-record issues.',
    inputSchema: {
      project: projectField,
      runId: runIdField,
      records: z.record(z.string(), z.unknown()).describe('An ImportBatch object in the veerify-import/1 format'),
    },
    handler: async (ctx, input) =>
      getData(ctx, {
        method: 'POST',
        path: `${await runBase(ctx, input.project, input.runId)}/records`,
        body: input.records,
      }),
  }),

  defineTool({
    name: 'import_preview',
    title: 'Preview an import run',
    description:
      'Returns the plan for a draft run: what would be created, updated, kept (edited in Veerify) or skipped. Show this to the user and get their confirmation before import_commit. Fails with 409 when the run is not a draft.',
    inputSchema: { project: projectField, runId: runIdField },
    annotations: { readOnlyHint: true },
    handler: async (ctx, input) =>
      getData(ctx, { method: 'GET', path: `${await runBase(ctx, input.project, input.runId)}/preview` }),
  }),

  defineTool({
    name: 'import_commit',
    title: 'Commit an import run',
    description:
      'Writes the staged records into the project. Only call after import_preview was shown to the user and they agreed. Small runs complete immediately; large runs (over 500 records) keep committing in the background, so poll import_status.',
    inputSchema: { project: projectField, runId: runIdField },
    annotations: { destructiveHint: true },
    handler: async (ctx, input) => {
      const run = await getData<{ status?: string }>(ctx, {
        method: 'POST',
        path: `${await runBase(ctx, input.project, input.runId)}/commit`,
      })
      return run?.status === 'committing'
        ? { run, note: 'Large run continues in the background; poll import_status' }
        : { run }
    },
  }),

  defineTool({
    name: 'import_status',
    title: 'Import run status',
    description: 'Returns the run (status, counts, summary) and its issues.',
    inputSchema: { project: projectField, runId: runIdField },
    annotations: { readOnlyHint: true },
    handler: async (ctx, input) =>
      getData(ctx, { method: 'GET', path: await runBase(ctx, input.project, input.runId) }),
  }),

  defineTool({
    name: 'import_cancel',
    title: 'Cancel an import run',
    description: 'Cancels a run that has not finished and drops its staged records.',
    inputSchema: { project: projectField, runId: runIdField },
    annotations: { destructiveHint: true },
    handler: async (ctx, input) =>
      getData(ctx, { method: 'POST', path: `${await runBase(ctx, input.project, input.runId)}/cancel` }),
  }),
]
