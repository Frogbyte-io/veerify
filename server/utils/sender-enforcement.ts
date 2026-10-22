import type { TeamSenderVerdict } from '~/lib/support-sending-domains'
import { getSendingDomainProvider } from '~/server/services/sending-domains'
import { recordSupportMetric } from '~/server/utils/support-observability'
import { resolveSenderPolicy, resolveTeamSenderAuthorization } from '~/server/utils/sending-domains'

/**
 * Shared enforcement helper for the `team` sender policy (design §4.4-4.5).
 *
 * Every enforcement point asks the same question - may this team use this
 * address as From? - so the provider options and the legacy short-circuit live
 * here once. Under `legacy` policy it answers `null` ("not enforced") and the
 * caller keeps today's behaviour exactly.
 */

type AuthorizationOptions = NonNullable<Parameters<typeof resolveTeamSenderAuthorization>[2]>

/** The verdict for `address` under the team policy, or null when the policy is `legacy`. */
export async function evaluateTeamSender(
  teamId: string,
  address: string,
  opts: Partial<Pick<AuthorizationOptions, 'executor'>> = {}
): Promise<TeamSenderVerdict | null> {
  if (resolveSenderPolicy() !== 'team') return null

  const sendingProvider = getSendingDomainProvider()
  return resolveTeamSenderAuthorization(teamId, address, {
    ...opts,
    ...(sendingProvider
      ? {
          provider: {
            name: sendingProvider.name,
            accountKey: sendingProvider.accountKey,
            authorizesSubdomains: sendingProvider.capabilities.authorizesSubdomains,
          },
        }
      : {}),
  })
}

/** True when the address may be used as From. Always true under `legacy` policy. */
export async function isSenderAllowedForTeam(teamId: string, address: string): Promise<boolean> {
  const verdict = await evaluateTeamSender(teamId, address)
  return verdict === null || verdict.status === 'authorized'
}

/**
 * Like `isSenderAllowedForTeam`, for background paths (auto-reply, CSAT) that
 * skip rather than fail: records the `blocked` metric when the sender is not
 * authorized. The caller logs.
 */
export async function isSenderAllowedOrRecordBlock(
  teamId: string,
  address: string,
  reason: 'auto_reply' | 'csat'
): Promise<boolean> {
  const allowed = await isSenderAllowedForTeam(teamId, address)
  if (!allowed) recordSupportMetric('support.sending_domain.blocked', { reason })
  return allowed
}
