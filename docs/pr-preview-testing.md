# PR Preview Testing Plan

## The Short Answer: No, You Don't Need Full Docker Compose

The `docker-compose-dev.yml` only runs two services:

- **PostgreSQL** — replaceable with a managed/serverless database
- **Mailpit** — a local SMTP trap, irrelevant for cloud previews

The Nuxt app itself runs independently (`yarn build` produces a self-contained output).
PR preview testing reduces to: **deploy the Nuxt app + point it at a database.**

---

## Recommended Stack: Vercel + Neon

Both have generous free tiers and are built for this exact workflow.

| Service | Role | Free Tier |
|---|---|---|
| **Vercel** | Hosts Nuxt app, auto-deploys on every PR | Unlimited preview deployments |
| **Neon** | Serverless PostgreSQL with DB branching | 3 GB storage, 1 project |
| **Resend** *(optional)* | Real SMTP if you need working email links | 100 emails/day |

### Why Not Coolify?

Coolify *can* run Docker Compose and has preview support. It is the right call if you
want a single self-hosted platform for **production and previews together**. But it
requires a VPS ($5–10/month minimum) and significantly more operational setup for what
is essentially just a Nuxt app + Postgres. Overkill at this stage.

### Why Not Railway / Render / Fly?

- **Railway** — supports Docker Compose but the free tier is $5/month in credits;
  preview environments burn through them.
- **Render** — has PR previews but every PostgreSQL add-on costs money per preview.
- **Fly.io** — no built-in PR preview mechanism.

---

## Architecture

```
GitHub PR opened
       │
       ▼
Vercel auto-deploys preview
       │
       ├── yarn install
       ├── yarn build
       └── postbuild: migrate + seed
                  │
                  ▼
         Neon PostgreSQL
         (shared preview DB  —or—  per-branch via Neon branching)
```

---

## Database Strategy: Two Options

### Option A — Shared Preview Database (Simpler)

All PR previews point at the same Neon database. Drizzle migrations are idempotent by
design (already-applied migrations are skipped). Seed data uses `INSERT ... ON CONFLICT DO NOTHING`.

**Use this when:** Most PRs are UI changes or read-only behavior. No PR modifies the schema.

### Option B — Neon Database Branching (Isolated)

Neon supports creating a database branch per PR — copy-on-write snapshots of a base
branch that already has migrations and seed data applied. Each PR preview gets its own
isolated database state.

**Use this when:** PRs add migrations, modify schema, or need isolated test data.
Neon's GitHub integration can automate branch creation from PR events.

---

## Code Changes Required

Three things in the current codebase need to change before this works with a remote database.

### 1. SSL must be configurable (`server/database/drizzle.ts`)

Currently hardcoded to `ssl: false`. Neon (and most managed PostgreSQL) requires SSL.

```typescript
// Change ssl: false  →  ssl driven by env
ssl: process.env.PGSSL === 'true' ? true : false,
```

Set `PGSSL=true` in Vercel's preview environment variables.

### 2. BetterAuth needs an explicit baseURL (`lib/auth.ts`)

BetterAuth uses `baseURL` for auth callbacks and verification email links. Preview
deployments get dynamic URLs. Vercel automatically sets the `VERCEL_URL` env var to
the current deployment's hostname (without protocol).

```typescript
// Add baseURL to the betterAuth() config:
baseURL: process.env.BETTER_AUTH_URL
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'),
```

This makes auth work correctly on preview URLs without any per-PR configuration.

### 3. Add a postbuild script (`package.json`)

Migrations need to run after every build. Add to scripts:

```json
"postbuild": "drizzle-kit migrate && tsx scripts/seed.ts"
```

`drizzle-kit migrate` is safe to run repeatedly — it skips already-applied migrations.
The seed script (see below) is idempotent as well.

---

## Seed Script

Create `scripts/seed.ts` to insert test fixtures on first deploy. It must be idempotent
(safe to run on every deploy).

What to seed:

| Table | What | Why |
|---|---|---|
| `user` | One test user, `email_verified = true` | Lets you log in without email verification |
| `account` | Entry with `provider_id = "credential"` and a bcrypt-hashed password | BetterAuth's email/password auth reads this |
| `organization` | One test org | Exercises the team/org flows |
| `member` | Links the test user to the test org as `owner` | Exercises member/role flows |

BetterAuth uses **bcrypt** for credential passwords. Pre-hash a known password (e.g.,
`password123`) at script-write time and hardcode the hash, or use the `bcryptjs` package
at runtime. Use a well-known test email like `test@preview.local`.

Guard all inserts with an existence check on the test user's email so re-runs are no-ops.

---

## Email in Previews

Three options, in order of simplicity:

1. **Bypass verification entirely (simplest)** — Seed users already have `email_verified = true`.
   For testing the signup flow itself, you can sign up a new account and just not click
   the verification link — the rest of the app still works for already-verified seed users.

2. **Use Resend (free tier)** — Point SMTP at `smtp.resend.com`. Email links will
   correctly point at the preview URL (handled by the `BETTER_AUTH_URL` fix above).
   100 emails/day is plenty for PR testing.

3. **Let emails fail silently** — If the SMTP env vars are missing or wrong, nodemailer
   will throw. Only do this if you add error handling around email sends. Not recommended.

---

## Vercel Environment Variables (Preview Scope)

Set these in Vercel → Settings → Environment Variables, scoped to **Preview** only:

```env
# Database — Neon connection
PGHOST=ep-<your-neon-endpoint>.neon.tech
PGPORT=5432
PGUSER=<neon_user>
PGPASSWORD=<neon_password>
PGDATABASE=<neon_dbname>
PGSSL=true

# BetterAuth
BETTER_AUTH_SECRET=<random secret, generate once>
# BETTER_AUTH_URL is NOT needed — the code falls back to VERCEL_URL automatically

# Email — pick one approach (see above)
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=<resend_api_key>
SMTP_SECURE=true
MAIL_FROM=noreply@yourdomain.com
MAIL_FROM_NAME=Veerify
```

---

## Step-by-Step Setup

1. **Neon** — Create a free project at neon.tech. Note the connection string. Run
   migrations locally against it once (`PGHOST=... PGSSL=true yarn db:migrate`) to
   verify connectivity.

2. **Make the three code changes** above (SSL config, BetterAuth baseURL, postbuild script).
   Write the seed script.

3. **Vercel** — Connect your GitHub repo. Vercel auto-detects Nuxt 3. Set framework
   to Nuxt, install command to `yarn`, build command to `yarn build`. Add the environment
   variables above scoped to Preview.

4. **Open a PR** — Vercel creates a preview deployment automatically. The preview URL
   appears in the PR as a check. Migrations run, seed runs, app is live with test data.

5. **Test** — Log in with the seed credentials. Verify the feature under review works
   against real data in an isolated (or shared, depending on your choice) database.

---

## What This Deliberately Does Not Cover

| Concern | Status |
|---|---|
| Production hosting | Out of scope — Coolify or a VPS with Docker Compose is fine for that |
| Mailpit | Dev-only tool, not needed in previews |
| Full Docker Compose parity | Not needed — Vercel + Neon covers everything the Compose file provides |
| Per-PR database isolation | Optional — use Neon branching (Option B) only if PRs touch the schema |
| Background workers | Not applicable — this app has none |
