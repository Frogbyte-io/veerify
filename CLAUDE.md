# CLAUDE.md — Veerify

This file is the single source of truth for AI assistants working on this codebase. Read it in full before making any changes.

---

## Project Overview

Veerify is a feedback management and verification platform built with **Nuxt 3**. It provides features for collecting user feedback, voting on feature requests, managing team workflows, and presenting public roadmaps. The application ships a full authentication system (email/password + OAuth-ready), organization management, two-factor authentication, and a transactional email layer.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Framework | Nuxt 3 (Vue 3) |
| Language | TypeScript |
| UI Components | shadcn-vue (New York style) |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`) |
| Icons | Nuxt Icon — Lucide icon set |
| Authentication | Better-Auth v1.2+ |
| ORM | Drizzle ORM |
| Database | PostgreSQL 17.5 |
| Email | Nodemailer via `nuxt-nodemailer` |
| Dark Mode | `@nuxtjs/color-mode` (system preference, dark fallback) |
| Package Manager | Yarn |

---

## Directory Structure

```
/
├── assets/css/main.css          # Tailwind entry + CSS custom properties (light/dark)
├── components/
│   ├── settings/                # Settings tab components (Profile, Security, etc.)
│   ├── sidebar/                 # AppSidebar, NavUser, TeamSwitcher
│   └── ui/                      # shadcn-vue auto-generated components — do NOT edit by hand
├── layouts/
│   ├── clean.vue                # Minimal layout for auth pages
│   └── dashboard.vue            # Full layout: sidebar + header + slot
├── lib/
│   ├── auth.ts                  # Better-Auth SERVER config (plugins, email hooks)
│   ├── auth-client.ts           # Better-Auth CLIENT config (Vue client, exports)
│   ├── email.ts                 # sendEmail / sendEmailVerificationEmail / sendPasswordResetEmail
│   ├── email-templates.ts       # HTML+text templates for verification & password reset
│   └── utils.ts                 # cn() helper (clsx + twMerge)
├── middleware/
│   └── auth.global.ts           # Client-side route guard (protected vs auth routes)
├── pages/                       # File-based routing (Nuxt convention)
│   ├── index.vue                # Redirect: /dashboard if authed, /login otherwise
│   ├── login/index.vue
│   ├── signup/index.vue
│   ├── forgot-password/index.vue
│   ├── dashboard/index.vue
│   ├── feedback/index.vue
│   ├── reports/index.vue
│   ├── settings/index.vue
│   └── help/index.vue
├── server/
│   ├── api/
│   │   ├── auth/[...all].ts     # Catch-all Better-Auth handler
│   │   ├── mail/send-mail.post.ts
│   │   └── user/profile.put.ts
│   └── database/
│       ├── drizzle.ts           # pg Client + drizzle() instance export
│       ├── schema/
│       │   ├── auth.ts          # All table definitions (user, session, account, etc.)
│       │   └── index.ts         # Re-exports everything from auth.ts
│       └── migrations/          # Drizzle-kit generated SQL migrations
├── auth-schema.ts               # Mirror of server/database/schema/auth.ts (BetterAuth reference)
├── components.json              # shadcn-vue CLI config
├── docker-compose.yml           # Production: PostgreSQL only
├── docker-compose-dev.yml       # Development: PostgreSQL + Mailpit
├── drizzle.config.ts            # Drizzle-kit config (schema path, dialect, credentials)
├── nuxt.config.ts               # Nuxt modules, runtime config, shadcn config
├── tsconfig.json                # Extends Nuxt-generated tsconfig
├── .env.example                 # All required environment variables
└── .cursor/                     # Cursor IDE rules (MDC format) — see below
```

---

## Development Setup

### Prerequisites
- Node.js 18+
- Yarn
- Docker (for local PostgreSQL + Mailpit)

### Initial Bootstrap

```bash
yarn install
docker compose -f docker-compose-dev.yml up -d   # starts postgres + mailpit
cp .env.example .env                              # fill in values (see below)
yarn db:migrate                                   # apply all migrations
yarn dev                                          # start dev server on :3000
```

### Environment Variables

All variables live in `.env`. Development defaults (from `docker-compose-dev.yml`):

```
POSTGRES_USER=veerify
POSTGRES_PASSWORD=veerifypassword
POSTGRES_DB=veerifydb

BETTER_AUTH_SECRET=<generate a random secret>
BETTER_AUTH_URL=http://localhost:3000

SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
MAIL_FROM=noreply@veerify.com
MAIL_FROM_NAME=Veerify
```

The database connection in `server/database/drizzle.ts` and `drizzle.config.ts` reads `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGPORT` with hardcoded dev defaults matching the compose file.

### Local Email (Mailpit)

During development, emails are captured by Mailpit — they are never sent to real addresses.

- SMTP endpoint: `localhost:1025`
- Web UI to inspect sent mail: `http://localhost:8025`

---

## NPM Scripts

| Script | Purpose |
|---|---|
| `yarn dev` | Start Nuxt dev server |
| `yarn build` | Production build |
| `yarn preview` | Preview production build locally |
| `yarn db:generate` | Generate a new Drizzle migration from schema changes |
| `yarn db:migrate` | Run pending migrations against the database |
| `yarn db:push` | Push schema directly (no migration file — dev use only) |
| `yarn db:studio` | Open Drizzle Studio UI |

---

## Architecture & Data Flow

```
Browser
  │
  ├─ pages/*          (file-based routes, Options API components)
  ├─ middleware/auth.global.ts   (client-side route guard)
  ├─ lib/auth-client.ts         (Better-Auth Vue client)
  │
  ▼
Nuxt Server
  ├─ server/api/auth/[...all].ts   → Better-Auth handles all /api/auth/* requests
  ├─ server/api/user/profile.put.ts → session check → Drizzle query
  ├─ server/api/mail/send-mail.post.ts → nodemailer
  │
  ▼
Better-Auth (lib/auth.ts)
  ├─ Drizzle adapter → PostgreSQL
  ├─ Organization plugin  (max 5 orgs, 50 members each)
  ├─ TwoFactor plugin      (TOTP, issuer "Veerify")
  └─ Email hooks → lib/email.ts → lib/email-templates.ts
```

### Request Lifecycle (protected API route)

1. Client sends request to `/api/user/profile` (PUT)
2. Server handler calls `auth.api.getSession({ headers })` to validate session
3. If no valid session → `createError({ statusCode: 401 })`
4. Otherwise, read body, validate inputs, run Drizzle query, return result

---

## Authentication System

### Server Side — `lib/auth.ts`

- Initialised with `betterAuth()` using the Drizzle adapter
- Tables mapped: `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, `twoFactor`
- `emailAndPassword` enabled with hooks for `sendVerificationEmail` and `sendResetPassword`
- OAuth (GitHub) is stubbed but commented out — uncomment and add `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` env vars to enable
- Plugins: `organization` and `twoFactor`

### Client Side — `lib/auth-client.ts`

```typescript
import { authClient, signIn, signUp, signOut, useSession } from '~/lib/auth-client'
```

- `authClient` — full client with `.organization` and `.twoFactor` namespaces
- `useSession(useFetch)` — returns `{ data: session, isPending }` (reactive refs)
- `signIn`, `signUp`, `signOut` — convenience re-exports

### Route Guard — `middleware/auth.global.ts`

Runs on the **client only** (`process.server` check skips SSR/build). Categorises routes:

| Category | Routes | Behaviour |
|---|---|---|
| Protected | `/dashboard`, `/settings`, `/team`, `/reports`, `/feedback`, `/help` | Redirect to `/login` if no session |
| Auth | `/login`, `/signup`, `/auth` | Redirect to `/dashboard` if session exists |
| Public | everything else | No redirect |

---

## Database Layer

### ORM Setup — `server/database/drizzle.ts`

Uses `drizzle-orm/node-postgres` with a raw `pg` `Client`. Connection parameters read from `PG*` env vars with dev defaults. The exported `db` instance is used everywhere in server code.

### Schema — `server/database/schema/auth.ts`

Eight tables, all defined with `pgTable` from `drizzle-orm/pg-core`:

| Table | Key Columns | Notes |
|---|---|---|
| `user` | id, name, email (unique), emailVerified, twoFactorEnabled | Core identity |
| `session` | id, token (unique), userId (FK→user), expiresAt, activeOrganizationId | Auth sessions |
| `account` | id, accountId, providerId, userId (FK→user), password | Stores credential per provider |
| `verification` | id, identifier, value, expiresAt | Email verification & password reset tokens |
| `organization` | id, name, slug (unique), logo | Multi-tenant orgs |
| `member` | id, organizationId (FK→organization), userId (FK→user), role | Org membership |
| `invitation` | id, organizationId, email, role, status, inviterId, expiresAt | Pending invites |
| `twoFactor` | id, userId (FK→user), secret, backupCodes | TOTP 2FA |

### Migration Workflow

1. Edit `server/database/schema/auth.ts`
2. Run `yarn db:generate` — creates a new SQL file in `server/database/migrations/`
3. Review the generated SQL
4. Run `yarn db:migrate` to apply

Never edit migration files manually. Never use `db:push` in production.

---

## Email System

### Architecture

```
lib/email.ts
  ├── sendEmail()           ← detects server vs client
  │     ├── Server:  useNodeMailer().sendMail()     (direct nodemailer)
  │     └── Client:  POST /api/mail/send-mail       (HTTP to server)
  ├── sendEmailVerificationEmail()  ← wraps sendEmail with verification template
  └── sendPasswordResetEmail()      ← wraps sendEmail with reset template
```

Templates live in `lib/email-templates.ts`. Each template function returns `{ subject, html, text }`.

- Verification link expires in **24 hours**
- Password reset link expires in **1 hour**

### Adding a New Email Type

1. Add a template function to `lib/email-templates.ts` returning `{ subject, html, text }`
2. Add a wrapper in `lib/email.ts` that calls `sendEmail` with the template output
3. Call your wrapper wherever needed (server hooks or client code)

---

## Frontend Conventions

### Vue Component Style — OPTIONS API ONLY

The project **migrated away from Composition API**. All components must use the Options API.

```vue
<template>
  <!-- template first -->
</template>

<script>
export default {
  name: 'ComponentName',
  data() {
    return { /* reactive state */ }
  },
  computed: { /* derived state */ },
  methods: { /* actions */ },
  async mounted() { /* lifecycle */ }
}
</script>
```

**Do not use `<script setup>`, `ref()`, `reactive()`, `computed()` from `vue`, or any Composition API patterns.**

### Auto-Imports

Nuxt auto-imports components from `components/` and `components/ui/`. You do **not** need to manually import:
- Any shadcn-vue UI component (`Button`, `Input`, `Card`, `Skeleton`, `Avatar`, etc.)
- Any component inside `components/` (e.g. `AppSidebar`, `SettingsProfile`)
- Nuxt built-ins (`NuxtLink`, `navigateTo`)

Only import explicitly when using external libraries (e.g. `authClient` from `~/lib/auth-client`).

### Icons

Always use the Nuxt Icon component with Lucide:

```vue
<Icon name="lucide:icon-name" class="h-4 w-4" />
```

### Loading & Error States

- Use `<Skeleton>` components for loading (never fallback/placeholder data)
- Error states must include a retry mechanism
- Pattern: `v-if="isLoading"` → skeleton, `v-else-if="error"` → error with retry, `v-else` → content

### Client Detection

Use `import.meta.client` (not the deprecated `process.client`):

```js
if (import.meta.client) { /* browser-only code */ }
if (import.meta.server) { /* server-only code */ }
```

### Tailwind & Theming

- CSS variables for all theme colours are in `assets/css/main.css` using Oklch
- Dark mode is handled automatically by `@nuxtjs/color-mode` + shadcn CSS variables
- Use the `cn()` utility (`lib/utils.ts`) to merge Tailwind classes conditionally

---

## Server API Conventions

### File-Based Routing

Nuxt maps files under `server/api/` directly to routes. Method-specific files use suffixes:

| File | Route | Method |
|---|---|---|
| `server/api/auth/[...all].ts` | `/api/auth/*` | All (Better-Auth catch-all) |
| `server/api/mail/send-mail.post.ts` | `/api/mail/send-mail` | POST |
| `server/api/user/profile.put.ts` | `/api/user/profile` | PUT |

### Protected Route Template

```typescript
import { auth } from '~/lib/auth'
import { db } from '~/server/database/drizzle'
import { user } from '~/server/database/schema/auth'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  // 1. Validate session
  const session = await auth.api.getSession({
    headers: event.node.req.headers as any,
  })
  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  // 2. Read & validate input
  const body = await readBody(event)

  // 3. Query / mutate with Drizzle
  const result = await db.select().from(user).where(eq(user.id, session.user.id))

  // 4. Return structured response
  return { success: true, data: result }
})
```

### Error Handling

Always use `createError()` — never throw a plain `Error`:

```typescript
throw createError({ statusCode: 400, statusMessage: 'Validation failed' })
throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
throw createError({ statusCode: 500, statusMessage: 'Internal server error' })
```

---

## Page & Layout Conventions

### Layouts

- Auth pages (`login`, `signup`, `forgot-password`) use the `clean` layout:
  ```vue
  <script>
  export default { layout: 'clean' }
  </script>
  ```
- All dashboard pages automatically use the `dashboard` layout (set as default or explicitly)

### Route Categories

| Route | Layout | Auth State |
|---|---|---|
| `/` | — | Redirects based on session |
| `/login`, `/signup`, `/forgot-password` | `clean` | Public (redirects away if authed) |
| `/dashboard`, `/feedback`, `/reports`, `/settings`, `/help` | `dashboard` | Protected |

---

## Cursor IDE Rules

The project ships context-aware Cursor rules in MDC format:

| File | Scope |
|---|---|
| `.cursor/rules/project.mdc` | Project-wide patterns, security, architecture |
| `server/.cursor/rules/api.mdc` | API routes, database, server auth |
| `components/.cursor/rules/vue.mdc` | Vue components, UI patterns, client-side auth |

These mirror the conventions in this file. Keep them in sync when making architectural changes.

---

## Rules for AI Assistants

1. **Use Options API exclusively.** Never introduce `<script setup>` or Composition API imports.
2. **Do not edit `components/ui/`** — these are generated by shadcn-vue CLI. Run `npx shadcn-nuxt add <component>` to add new ones.
3. **Always validate sessions** on any new server API route using `auth.api.getSession()`.
4. **Use `createError()`** for all server-side errors — never throw plain exceptions.
5. **Use `import.meta.client` / `import.meta.server`** — never `process.client` or `process.server`.
6. **No fallback/placeholder data.** Show Skeleton loaders while fetching; show real error states on failure.
7. **Follow the existing email pattern** when adding transactional emails: template function → wrapper in `email.ts` → call site.
8. **Schema changes require migrations.** Edit the schema in `server/database/schema/auth.ts`, then run `yarn db:generate`. Never hand-write migrations.
9. **Keep `.env.example` updated** whenever a new environment variable is introduced.
10. **Respect the route guard categories.** New protected pages must have their path prefix in the `protectedRoutes` array in `middleware/auth.global.ts`.
11. **Icons are always `<Icon name="lucide:*" />`** — do not import from `lucide-vue-next` directly.
12. **`cn()` for class merging.** Import from `~/lib/utils` — do not add new utility functions for this.
13. **Do not remove or rename `auth-schema.ts`** at the project root — it exists as a BetterAuth schema reference and is imported by the auth configuration.
