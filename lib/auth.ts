import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization, twoFactor } from 'better-auth/plugins'
import { and, eq } from 'drizzle-orm'
import { db } from '../server/database/drizzle'
import * as schema from '../server/database/schema/index'
import { sendEmailVerificationEmail, sendPasswordResetEmail } from './email'

export const auth = betterAuth({
  baseURL:
    process.env.BETTER_AUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'),
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
    sendVerificationEmail: sendEmailVerificationEmail,
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
        console.error('Failed to send verification email:', error)
      })
    },
    sendOnSignUp: true,
  },
  socialProviders: {
    // TODO: uncomment and add OAuth credentials
    // github: {
    //   clientId: process.env.GITHUB_CLIENT_ID as string,
    //   clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
    // },
  },
  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      organizationLimit: 5,
      membershipLimit: 50,
      teams: {
        enabled: true,
        defaultTeam: {
          enabled: true,
          customCreateDefaultTeam: async (org) => {
            const now = new Date()
            const [created] = await db
              .insert(schema.team)
              .values({
                id: crypto.randomUUID(),
                name: 'Default',
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
        async afterAcceptInvitation({ invitation, user, organization }) {
          // Organization-only invitations should place users in the default team.
          if (invitation.teamId) {
            return
          }

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
        },
      },
    }),
    twoFactor({
      issuer: 'Veerify',
    }),
  ],
})
