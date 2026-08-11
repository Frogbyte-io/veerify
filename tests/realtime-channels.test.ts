import { describe, expect, it, vi } from 'vitest'

import { authorizeChannelWith, type ChannelAuthDeps } from '../server/utils/realtime-channels'

function deps(isMember = false): ChannelAuthDeps {
  return { isTeamMember: vi.fn(async () => isMember) }
}

describe('authorizeChannelWith', () => {
  it('allows a peer to listen to its own user channel', async () => {
    await expect(authorizeChannelWith('user:u1', 'u1', deps())).resolves.toEqual({ allowed: true })
  })

  it("denies a peer another user's channel", async () => {
    // The whole point of subscribe-time authorization: this must fail closed.
    await expect(authorizeChannelWith('user:u2', 'u1', deps())).resolves.toEqual({
      allowed: false,
      reason: 'Forbidden',
    })
  })

  it('allows a team channel when the user is a member', async () => {
    await expect(authorizeChannelWith('team:t1', 'u1', deps(true))).resolves.toEqual({ allowed: true })
  })

  it('denies a team channel when the user is not a member', async () => {
    await expect(authorizeChannelWith('team:t1', 'u1', deps(false))).resolves.toEqual({
      allowed: false,
      reason: 'Forbidden',
    })
  })

  it('checks membership against the requested team, not the user id', async () => {
    const d = deps(true)
    await authorizeChannelWith('team:t42', 'u1', d)
    expect(d.isTeamMember).toHaveBeenCalledWith('t42', 'u1')
  })

  it('denies support channels until Stage 02 introduces the tables', async () => {
    // Fails closed rather than allowing. Stage 02 replaces this branch with
    // requireInboxAccess / requireConversationAccess.
    await expect(authorizeChannelWith('inbox:i1', 'u1', deps(true))).resolves.toEqual({
      allowed: false,
      reason: 'Support channels are not available yet',
    })
    await expect(authorizeChannelWith('conversation:c1', 'u1', deps(true))).resolves.toEqual({
      allowed: false,
      reason: 'Support channels are not available yet',
    })
  })

  it('denies unknown or malformed channels', async () => {
    for (const channel of ['project:p1', 'team', 'team:', ':t1', '', 'nonsense']) {
      await expect(authorizeChannelWith(channel, 'u1', deps(true))).resolves.toMatchObject({ allowed: false })
    }
  })

  it('denies everything when there is no authenticated user', async () => {
    await expect(authorizeChannelWith('user:u1', '', deps(true))).resolves.toEqual({
      allowed: false,
      reason: 'Not authenticated',
    })
  })

  it('does not hit the database for channels it can reject outright', async () => {
    const d = deps(true)
    await authorizeChannelWith('user:u2', 'u1', d)
    await authorizeChannelWith('bogus:x', 'u1', d)
    expect(d.isTeamMember).not.toHaveBeenCalled()
  })
})
