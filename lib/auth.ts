import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { bearer } from 'better-auth/plugins/bearer'
import { magicLink, multiSession, organization, testUtils, twoFactor } from 'better-auth/plugins'
import { and, eq } from 'drizzle-orm'
import { db } from '../server/database/drizzle'
import * as schema from '../server/database/schema/index'
import {
  sendEmailVerificationEmail,
  sendMagicLinkEmail,
  sendOrganizationInvitationEmail,
  sendPasswordResetEmail,
} from './email'
import { createConsola } from 'consola'

const logger = createConsola().withTag('veerify').withTag('auth')

const appDomain = process.env.APP_DOMAIN || 'localhost'
const defaultAppBaseUrl = process.env.BETTER_AUTH_URL || 'http://localhost:3000'
// Pinned rather than left to Better Auth's per-request protocol sniffing. Route-issued
// cookies see the proxied request protocol while programmatic `auth.api.getSession()`
// calls have no request to sniff, so the two disagree on the `__Secure-` prefix whenever
// local development is fronted by an HTTPS reverse proxy (for example, Tailscale Serve).
// Production stays fail-safe: secure cookies are forced regardless of how the base URL
// is configured, matching the default this replaces.
const useSecureCookies = defaultAppBaseUrl.startsWith('https://') || process.env.NODE_ENV === 'production'
const betterAuthSecret =
  process.env.BETTER_AUTH_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'veerify-dev-auth-secret-v1')

if (!betterAuthSecret) {
  throw new Error('BETTER_AUTH_SECRET is required in production')
}

function resolveInvitationBaseUrl(request?: Request) {
  if (request?.url) {
    try {
      return new URL(request.url).origin
    } catch {
      // Ignore malformed request URLs and fall back to configured app URL.
    }
  }

  return defaultAppBaseUrl
}

export const auth = betterAuth({
  // Dynamic base URL: resolves from incoming request headers (x-forwarded-host / x-forwarded-proto)
  // so the same config works across local dev, staging, preview deployments, and production.
  baseURL: {
    allowedHosts: [appDomain, `*.${appDomain}`],
    fallback: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
    protocol: 'auto',
  },
  trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS
    ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(',')
    : (req?: Request) => {
        if (!req) return []
        const origin = req.headers.get('origin') || ''
        if (!origin) return []
        try {
          const { hostname } = new URL(origin)
          if (hostname === appDomain || hostname.endsWith('.' + appDomain)) {
            return [origin]
          }
        } catch {
          // invalid URL — not a trusted origin
        }
        return []
      },
  advanced: {
    useSecureCookies,
    crossSubDomainCookies: {
      enabled: true,
      domain: '.' + appDomain,
    },
  },
  // `secret` is kept as legacy fallback for decrypting bare-hex payloads created before 1.5.
  // New data is encrypted using the envelope format defined by `secrets` below.
  secret: betterAuthSecret,
  // Versioned secrets for non-destructive rotation.
  // First entry = current key (encrypts all new data).
  // Remaining entries = decryption-only (previous key versions).
  // To rotate: generate a new secret, set it as BETTER_AUTH_SECRET, move the old one to
  // BETTER_AUTH_SECRET_PREV, then bump the version numbers here.
  secrets: [
    { version: 1, value: betterAuthSecret },
    ...(process.env.BETTER_AUTH_SECRET_PREV ? [{ version: 0, value: process.env.BETTER_AUTH_SECRET_PREV }] : []),
  ],
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      organization: schema.organization,
      member: schema.member,
      invitation: schema.invitation,
      team: schema.team,
      teamMember: schema.teamMember,
      twoFactor: schema.twoFactor,
    },
  }),
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url, token }, _request) => {
      await sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetUrl: url,
      })
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url, token }, _request) => {
      void sendEmailVerificationEmail({
        to: user.email,
        name: user.name || user.email.split('@')[0],
        verificationUrl: url,
      }).catch((error) => {
        logger.error('Failed to send verification email', {
          userId: user.id,
          error: error instanceof Error ? error.message : error,
        })
      })
    },
    sendOnSignUp: true,
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
    },
  },
  plugins: [
    // The WebSocket transport cannot send HttpOnly cookies reliably across
    // every runtime, so `server/routes/_ws.ts` authenticates with the opaque
    // Better Auth session token in an Authorization header.
    bearer(),
    organization({
      allowUserToCreateOrganization: true,
      organizationLimit: 5,
      membershipLimit: 50,
      sendInvitationEmail: async (data, request) => {
        let teamName = null

        if (data.invitation.teamId) {
          const [teamRecord] = await db
            .select()
            .from(schema.team)
            .where(eq(schema.team.id, data.invitation.teamId))
            .limit(1)
          teamName = teamRecord?.name || null
        }

        const invitationUrl = new URL(
          `/accept-invitation?id=${encodeURIComponent(data.id)}`,
          resolveInvitationBaseUrl(request)
        ).toString()

        await sendOrganizationInvitationEmail({
          to: data.email,
          organizationName: data.organization.name,
          inviterName: data.inviter.user.name || data.inviter.user.email,
          inviteUrl: invitationUrl,
          role: data.role,
          teamName,
        })
      },
      teams: {
        enabled: true,
        defaultTeam: {
          enabled: true,
          customCreateDefaultTeam: async (org) => {
            const now = new Date()

            // Derive a slug from the org slug
            const baseSlug = (org.slug || org.id.slice(0, 8))
              .toLowerCase()
              .replace(/[^a-z0-9-]/g, '-')
              .replace(/-+/g, '-')
              .replace(/^-|-$/g, '')

            // Ensure uniqueness — append random suffix on conflict
            let slug = baseSlug
            let attempt = 0
            while (attempt < 5) {
              const [existing] = await db.select().from(schema.team).where(eq(schema.team.slug, slug)).limit(1)
              if (!existing) break
              slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`
              attempt++
            }

            const [created] = await db
              .insert(schema.team)
              .values({
                id: crypto.randomUUID(),
                name: 'Default',
                slug,
                organizationId: org.id,
                createdAt: now,
                updatedAt: now,
              })
              .returning()

            return created as any
          },
        },
      },
      organizationHooks: {
        // NOTE (BetterAuth 1.5): "after" hooks now run post-transaction. If this hook
        // fails, the invitation acceptance is already committed — wrap in try/catch so
        // the error is logged without surfacing a 500 to the user.
        async afterAcceptInvitation({ invitation, user, organization }) {
          // Organization-only invitations should place users in the default team.
          if (invitation.teamId) {
            return
          }

          try {
            const [defaultTeam] = await db
              .select()
              .from(schema.team)
              .where(and(eq(schema.team.organizationId, organization.id), eq(schema.team.name, 'Default')))
              .limit(1)

            if (!defaultTeam) {
              return
            }

            const [existing] = await db
              .select()
              .from(schema.teamMember)
              .where(and(eq(schema.teamMember.teamId, defaultTeam.id), eq(schema.teamMember.userId, user.id)))
              .limit(1)

            if (!existing) {
              await db.insert(schema.teamMember).values({
                id: crypto.randomUUID(),
                teamId: defaultTeam.id,
                userId: user.id,
                createdAt: new Date(),
              })
            }
          } catch (error) {
            logger.error('afterAcceptInvitation: failed to add user to default team', {
              userId: user.id,
              error: error instanceof Error ? error.message : error,
            })
          }
        },
      },
    }),
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLinkEmail({ to: email, magicLinkUrl: url })
      },
    }),
    twoFactor({
      issuer: 'Veerify',
    }),
    multiSession(),
    // Test utilities: exposes `ctx.test` helpers for programmatic user/session creation.
    // Only active outside production to avoid exposing an unauthenticated test surface.
    ...(process.env.NODE_ENV !== 'production' ? [testUtils()] : []),
  ],
})
