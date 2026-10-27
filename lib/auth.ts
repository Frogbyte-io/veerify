import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink, multiSession, organization, testUtils, twoFactor } from 'better-auth/plugins'
import { db } from '../server/database/drizzle'
import * as schema from '../server/database/schema/index'
import { isReservedSlug } from '../server/utils/reserved-slugs'
import { claimImportedActivityInBackground } from '../server/services/imports/claim'
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
const supportsCrossSubdomainCookies = appDomain !== 'localhost' && appDomain !== '127.0.0.1' && appDomain !== '[::1]'
// Pinned rather than left to Better Auth's per-request protocol sniffing. Route-issued
// cookies see the proxied request protocol while programmatic `auth.api.getSession()`
// calls have no request to sniff, so the two disagree on the `__Secure-` prefix whenever
// local development is fronted by an HTTPS reverse proxy (for example, Tailscale Serve).
// Production stays fail-safe: secure cookies are forced regardless of how the base URL
// is configured, matching the default this replaces.
const useSecureCookies = defaultAppBaseUrl.startsWith('https://') || process.env.NODE_ENV === 'production'
const betterAuthSecret =
  process.env.BETTER_AUTH_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'veerify-dev-auth-secret-v1')

// Pinning `useSecureCookies` removed Better Auth's per-request protocol sniff,
// which would previously have noticed HTTPS on its own. A deployment served over
// TLS but started without `NODE_ENV=production` and without an HTTPS
// BETTER_AUTH_URL now issues cookies with no `Secure` attribute, so a single
// downgraded request would expose the session. That combination is always a
// misconfiguration; say so loudly at startup rather than failing silently.
// (The shipped Dockerfile sets NODE_ENV=production, so this targets the
// hand-rolled `node .output/server/index.mjs` shape.)
if (!useSecureCookies && process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
  logger.warn(
    'Session cookies will be issued without the Secure attribute. Set BETTER_AUTH_URL to your public https:// origin (or NODE_ENV=production) before serving over TLS.',
    { betterAuthUrl: defaultAppBaseUrl, nodeEnv: process.env.NODE_ENV ?? 'unset' }
  )
}

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
      // Browsers reject a Domain=.localhost cookie for sibling localhost hosts.
      // Local public boards use the auth handoff flow instead of a shared cookie.
      enabled: supportsCrossSubdomainCookies,
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
      twoFactor: schema.twoFactor,
    },
  }),
  // Claim imported posts, comments and votes for the user's email whenever the stored user row says it is verified.
  // `create.after` covers sign-ups that arrive verified (social providers asserting a verified email, magic links).
  // `update.after` fires on EVERY Better-Auth user update (verification link, magic link, 2FA toggle, update-user),
  // not only on verification, so it relies on `emailVerified` being true only for an email the user proved: any
  // other path that changes the email must reset `emailVerified` to false (server/api/user/profile.put.ts does).
  // Fire-and-forget: a failed claim is logged and never blocks sign-up or verification. The claim is idempotent.
  // See server/services/imports/claim.ts.
  databaseHooks: {
    user: {
      create: {
        after: async (user) => claimImportedActivityInBackground(user),
      },
      update: {
        after: async (user) => claimImportedActivityInBackground(user),
      },
    },
  },
  session: {
    // The project the user is working in; resolved and repaired server-side by
    // server/utils/project-context.ts. Never set from client input.
    additionalFields: {
      activeProjectId: { type: 'string', required: false, input: false },
    },
  },
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
    organization({
      allowUserToCreateOrganization: true,
      organizationLimit: 5,
      membershipLimit: 50,
      sendInvitationEmail: async (data, request) => {
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
        })
      },
      organizationHooks: {
        // The organization slug is the workspace's public subdomain
        // (<slug>.APP_DOMAIN): refuse reserved names, then register the hostname.
        async beforeCreateOrganization({ organization: org }) {
          if (org.slug && isReservedSlug(org.slug)) {
            throw new APIError('BAD_REQUEST', { message: 'This workspace URL is reserved. Choose another one.' })
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
