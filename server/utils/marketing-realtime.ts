import { publishRealtime, projectChannel } from '~/server/services/realtime'

export const MENTIONS_NEW_EVENT = 'marketing.mentions.new'

/**
 * Tells project members that new mentions arrived for a project.
 *
 * The envelope is deliberately content-free: ids and a count only. Clients
 * refetch through the authorized list endpoint. Published on `project:<projectId>`,
 * which subscribe-time authorization restricts to people with project access, and which
 * `publishRealtime` checks against the envelope's `projectId`.
 */
export async function publishMentionsNew(input: { projectId: string; count: number }): Promise<void> {
  if (!Number.isInteger(input.count) || input.count <= 0) return
  await publishRealtime(projectChannel(input.projectId), {
    type: MENTIONS_NEW_EVENT,
    projectId: input.projectId,
    count: input.count,
  })
}
