/**
 * @openapi
 * /api/dashboard/overview:
 *   get:
 *     tags: [Projects]
 *     summary: Overview of what needs attention and the last 7 days
 *     description: >
 *       The Overview page's data, for the active project, or for every project the caller can open in All projects
 *       (see POST /api/projects/active). `projects` narrows All projects to some projects.
 *       Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *       A tool that is off in a project contributes nothing, and conversation numbers only cover inboxes the caller
 *       can work in. Nothing here is per person: "needs you" is everything unanswered or untriaged in view.
 *
 *       `needsYou` holds `slaAtRisk` (open or pending conversations with a response or resolution due within the
 *       hour; `items` are the most urgent, `total` counts all), `waiting` (open or pending conversations where the
 *       customer wrote last or nobody replied yet, not counting the SLA ones; `byProject`, and the `oldest`),
 *       `untriaged` (feedback posts still on the project's default status, per project) and `drafts` (unpublished
 *       changelog entries, newest first).
 *
 *       `week` covers the last 7 days (`from` to `to`) against the 7 days before (`previousFrom`), for the same
 *       projects: `received` (conversations created), `firstReply` (median minutes from the first message to the first
 *       agent reply, over conversations created in the period and answered), `posts` (new feedback posts) and `votes`
 *       (upvotes cast). Each has `current`, `previous`, `byProject` and `available` (false when no project in view has
 *       the tool on). `projects` has one row per project in view for the Projects table.
 *     operationId: getDashboardOverview
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: projects
 *         description: Comma-separated project ids to narrow All projects to. An id outside the caller's scope is 403.
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "Overview: needsYou (slaAtRisk, waiting, untriaged, drafts), week (received, firstReply, posts, votes) and projects (one row per project in view)"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     needsYou: { type: object }
 *                     week: { type: object }
 *                     projects: { type: array, items: { type: object } }
 *       401: { description: "Not authenticated" }
 *       403: { description: "A requested project is not in the caller's scope" }
 *       409: { description: "The caller can open no project; create one first" }
 */
import { requireScopedProjects } from '~/server/utils/project-context'
import { createSuccessResponse } from '~/server/utils/response'
import { getOverview } from '~/server/services/overview/overview'

export default defineEventHandler(async (event) => {
  const { session, projects } = await requireScopedProjects(event)
  return createSuccessResponse(await getOverview(session.user.id, projects))
})
