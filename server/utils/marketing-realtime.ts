import { publishRealtime, teamChannel } from '~/server/services/realtime'

export const MENTIONS_NEW_EVENT = 'marketing.mentions.new'

/**
 * Tells team members that new mentions arrived for a product.
 *
 * The envelope is deliberately content-free: ids and a count only. Clients
 * refetch through the authorized list endpoint. Published on `team:<teamId>`,
 * which subscribe-time authorization restricts to team members, and which
 * `publishRealtime` checks against the envelope's `teamId`.
 */
export async function publishMentionsNew(input: { teamId: string; projectId: string; count: number }): Promise<void> {
  if (!Number.isInteger(input.count) || input.count <= 0) return
  await publishRealtime(teamChannel(input.teamId), {
    type: MENTIONS_NEW_EVENT,
    teamId: input.teamId,
    projectId: input.projectId,
    count: input.count,
  })
}
