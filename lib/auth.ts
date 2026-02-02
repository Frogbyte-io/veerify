import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization, twoFactor } from "better-auth/plugins";
import { db } from "../server/database/drizzle";
import * as schema from "../server/database/schema/index";
import { sendEmailVerificationEmail, sendPasswordResetEmail } from "./email";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'),
  database: drizzleAdapter(db, {
    provider: "pg",
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
  emailAndPassword: {
    enabled: true,
    sendVerificationEmail: sendEmailVerificationEmail,
    sendResetPassword: async ({ user, url, token }, request) => {
      console.log(user, url, token)
      await sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetUrl: url
      })
    },
  },
  socialProviders: {
    // Uncomment and configure when you have OAuth credentials
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
    }),
    twoFactor({
      issuer: "Veerify",
    }),
  ],
}); 