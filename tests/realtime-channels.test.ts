import { describe, expect, it, vi } from 'vitest'

import { authorizeChannelWith, type ChannelAuthDeps } from '../server/utils/realtime-channels'

function deps(isMember = false, canAccessInbox = false, canAccessConversation = false): ChannelAuthDeps {
  return {
    isTeamMember: vi.fn(async () => isMember),
    canAccessInbox: vi.fn(async () => canAccessInbox),
    canAccessConversation: vi.fn(async () => canAccessConversation),
  }
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

  it('allows an inbox channel when the peer has inbox access', async () => {
    await expect(authorizeChannelWith('inbox:i1', 'u1', deps(false, true))).resolves.toEqual({ allowed: true })
  })

  it('denies an inbox channel when the peer has no inbox access', async () => {
    // Fails closed. Collapses requireInboxAccess's 404/403 split into one
    // "Forbidden" — that distinction is API-facing detail, not useful here.
    await expect(authorizeChannelWith('inbox:i1', 'u1', deps(false, false))).resolves.toEqual({
      allowed: false,
      reason: 'Forbidden',
    })
  })

  it('checks inbox access against the requested inbox, not the user id', async () => {
    const d = deps(false, true)
    await authorizeChannelWith('inbox:i42', 'u1', d)
    expect(d.canAccessInbox).toHaveBeenCalledWith('i42', 'u1')
  })

  it('allows a conversation channel when the peer has conversation access', async () => {
    await expect(authorizeChannelWith('conversation:c1', 'u1', deps(false, false, true))).resolves.toEqual({
      allowed: true,
    })
  })

  it('denies a conversation channel when the peer has no conversation access', async () => {
    await expect(authorizeChannelWith('conversation:c1', 'u1', deps(false, false, false))).resolves.toEqual({
      allowed: false,
      reason: 'Forbidden',
    })
  })

  it('checks conversation access against the requested conversation, not the user id', async () => {
    const d = deps(false, false, true)
    await authorizeChannelWith('conversation:c42', 'u1', d)
    expect(d.canAccessConversation).toHaveBeenCalledWith('c42', 'u1')
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
