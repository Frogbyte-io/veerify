# CLAUDE.md — Veerify

This file is the single source of truth for AI assistants working on this codebase. Read it in full before making any changes.

---

## Project Overview

Veerify is a feedback management and verification platform built with **Nuxt 3**. It provides features for collecting user feedback, voting on feature requests, managing workspaces, projects and products, and presenting public roadmaps. The application ships a full authentication system (email/password + OAuth-ready), organization management, two-factor authentication, and a transactional email layer.

---

## Technology Stack

| Layer           | Technology                                              |
| --------------- | ------------------------------------------------------- |
| Framework       | Nuxt 3 (Vue 3)                                          |
| Language        | TypeScript                                              |
| UI Components   | shadcn-vue (New York style)                             |
| Styling         | Tailwind CSS v4 (`@tailwindcss/vite`)                   |
| Icons           | Nuxt Icon — Lucide icon set                             |
| Authentication  | Better-Auth v1.2+                                       |
| ORM             | Drizzle ORM                                             |
| Database        | PostgreSQL 17.5                                         |
| Email           | Nodemailer via `nuxt-nodemailer`                        |
| Dark Mode       | `@nuxtjs/color-mode` (system preference, dark fallback) |
| Package Manager | Yarn                                                    |

---

## Directory Structure

```
/
├── .agents/                     # AI assistant configuration
│   ├── CLAUDE.md                # This file — full project instructions
│   └── skills/                  # Reusable agent skill prompts
│       ├── new-api.md           # Scaffold a protected server API endpoint
│       ├── new-page.md          # Scaffold a new dashboard page
│       ├── new-component.md     # Scaffold an Options API Vue component
│       └── db-change.md         # Guide a schema change end-to-end
├── assets/css/main.css          # Tailwind entry + CSS custom properties (light/dark)
├── components/
│   ├── settings/                # Settings tab components (Profile, Security, etc.)
│   ├── sidebar/                 # AppSidebar, NavUser, ProjectSwitcher
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
│   ├── [...slug].vue            # Public project site, and `/` (redirect to /dashboard or /login)
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

- Node.js 22.12+
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

| Script             | Purpose                                                 |
| ------------------ | ------------------------------------------------------- |
| `yarn dev`         | Start Nuxt dev server                                   |
| `yarn build`       | Production build                                        |
| `yarn preview`     | Preview production build locally                        |
| `yarn db:generate` | Generate a new Drizzle migration from schema changes    |
| `yarn db:migrate`  | Run pending migrations against the database             |
| `yarn db:push`     | Push schema directly (no migration file — dev use only) |
| `yarn db:studio`   | Open Drizzle Studio UI                                  |

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
2. Server handler calls `requireAuth(event)` (`server/utils/auth-middleware.ts`), which accepts a session cookie or a personal API key
3. If neither is valid → 401
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

### API keys and MCP

Personal API keys (`vfy_usr_...`, Settings → API keys) let an agent act as a user. Setup and recipes: `docs/mcp.md`.

- `requireAuth` (`server/utils/auth-middleware.ts`) resolves `Authorization: Bearer vfy_usr_...` first. An invalid,
  revoked or expired key is 401 with no cookie fallback. Key logic lives in `server/utils/user-api-keys.ts`.
- `requireInteractiveSession` returns 403 for keys; use it on anything a key must not do. `isCredentialPrincipal`
  tells the two apart. Keys cannot change the account email.
- Active workspace and project are stored per credential on the `user_api_key` row. `X-Veerify-Organization` and
  `X-Veerify-Project` override them per request, are access-checked (403, never a silent fallback) and persist nothing.
- `/mcp` (`server/routes/mcp.ts`, tools in `server/mcp/`) is POST-only, key principals only, 4 MiB body limit, 600
  requests per 60 s per key. `call_api` refuses `/api/auth/`, `/api/cron/`, `/api/public/auth/`, `/api/user/api-keys`
  and `/api/test`.
- Device login (RFC 8628, `server/services/device-login.ts`): `/api/device/code` and `/api/device/token` are public; the
  `/device` page and `/api/device/requests/*` need a browser session. An approved request mints a `createdVia: 'device'`
  key (90 days, full access, counts toward the 25-key cap). `/mcp` 401s carry `error.details.hint` pointing at it.
  `call_api` refuses `/api/device/`.

### Crawlers and AI agents

Public boards load their data in the browser, so the server adds a machine-readable layer (`server/services/public-site/`):

- `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/llms-full.txt` (`server/routes/`) answer per host: the app host
  describes Veerify, the API and MCP; a workspace subdomain lists its projects (plus `/<project>/llms.txt`); a custom
  domain describes its project.
- Each public feedback item has its own URL: `/<project>/p/<title-slug>-<id>` (custom domain: `/p/...`; non-UUID ids
  are used bare). Only the trailing id matters, so renamed items keep working; the canonical link carries the current
  slug. The board opens the item's details over itself and keeps the address bar in sync (`lib/public-site-path.ts`).
- Any public page is available as markdown at `<page>.md` (board root: `/index.md`) or with `Accept: text/markdown`
  (handled in `server/middleware/subdomain.ts`).
- `server/plugins/public-site-head.ts` adds title, description, canonical, Open Graph, JSON-LD and a `<noscript>`
  copy of the content to SSR HTML.
- Only what anonymous visitors can see is included: public projects/products, non-hidden feedback (no support-derived
  items), published changelog entries, and only tools that are on. Snapshots are cached for 60 s per project.
- New public pages: add them to `lib/public-site-path.ts` and the renderers in `server/services/public-site/render.ts`.

### Route Guard — `middleware/auth.global.ts`

Runs on the **client only** (`process.server` check skips SSR/build). Categorises routes:

| Category  | Routes                                                                                | Behaviour                                  |
| --------- | ------------------------------------------------------------------------------------- | ------------------------------------------ |
| Protected | `/dashboard`, `/settings`, `/workspace`, `/project`, `/reports`, `/feedback`, `/help` | Redirect to `/login` if no session         |
| Auth      | `/login`, `/signup`, `/auth`                                                          | Redirect to `/dashboard` if session exists |
| Public    | everything else                                                                       | No redirect                                |

---

## Database Layer

### ORM Setup — `server/database/drizzle.ts`

Uses `drizzle-orm/node-postgres` with a raw `pg` `Client`. Connection parameters read from `PG*` env vars with dev defaults. The exported `db` instance is used everywhere in server code.

### Schema — `server/database/schema/auth.ts`

Eight tables, all defined with `pgTable` from `drizzle-orm/pg-core`:

| Table          | Key Columns                                                           | Notes                                      |
| -------------- | --------------------------------------------------------------------- | ------------------------------------------ |
| `user`         | id, name, email (unique), emailVerified, twoFactorEnabled             | Core identity                              |
| `session`      | id, token (unique), userId (FK→user), expiresAt, activeOrganizationId | Auth sessions                              |
| `account`      | id, accountId, providerId, userId (FK→user), password                 | Stores credential per provider             |
| `verification` | id, identifier, value, expiresAt                                      | Email verification & password reset tokens |
| `organization` | id, name, slug (unique), logo                                         | Multi-tenant orgs                          |
| `member`       | id, organizationId (FK→organization), userId (FK→user), role          | Org membership                             |
| `invitation`   | id, organizationId, email, role, status, inviterId, expiresAt         | Pending invites                            |
| `twoFactor`    | id, userId (FK→user), secret, backupCodes                             | TOTP 2FA                                   |

App feedback keys (`project_api_key`: project + product scoped, SHA-256 hash only stored) live in `server/database/schema/feedback.ts`, not `auth.ts`.

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
  │     │            or the dedicated SYSTEM_SMTP_* transport (lib/mail-transport.ts)
  │     └── Client:  throws (mail is server-only; there is no send endpoint)
  ├── sendEmailVerificationEmail()  ← wraps sendEmail with verification template
  └── sendPasswordResetEmail()      ← wraps sendEmail with reset template
```

Templates live in `lib/email-templates.ts`. Each template function returns `{ subject, html, text }`.

`sendEmail` defaults to the `system` channel, which uses `SYSTEM_SMTP_*` when `SYSTEM_SMTP_HOST` is set and the primary `SMTP_*` transport otherwise. Only the support outbox sends with `channel: 'support'`, which always uses `SMTP_*`. See `docs/deployment-mail.md`.

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
    return {
      /* reactive state */
    }
  },
  computed: {
    /* derived state */
  },
  methods: {
    /* actions */
  },
  async mounted() {
    /* lifecycle */
  },
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
if (import.meta.client) {
  /* browser-only code */
}
if (import.meta.server) {
  /* server-only code */
}
```

### Tailwind & Theming

- CSS variables for all theme colours are in `assets/css/main.css` using Oklch
- Dark mode is handled automatically by `@nuxtjs/color-mode` + shadcn CSS variables
- Use the `cn()` utility (`lib/utils.ts`) to merge Tailwind classes conditionally

---

## Server API Conventions

### File-Based Routing

Nuxt maps files under `server/api/` directly to routes. Method-specific files use suffixes:

| File                             | Route               | Method                      |
| -------------------------------- | ------------------- | --------------------------- |
| `server/api/auth/[...all].ts`    | `/api/auth/*`       | All (Better-Auth catch-all) |
| `server/api/user/profile.put.ts` | `/api/user/profile` | PUT                         |

### Protected Route Template

```typescript
import { db } from '~/server/database/drizzle'
import { user } from '~/server/database/schema/auth'
import { eq } from 'drizzle-orm'
import { requireAuth } from '~/server/utils/auth-middleware'

export default defineEventHandler(async (event) => {
  // 1. Authenticate: session cookie or personal API key (Bearer vfy_usr_...), 401 otherwise.
  //    Use requireAuthWithResolvedProject / requireAuthWithOrganization (server/utils/project-context.ts)
  //    when the route works in the active project/workspace, and requireInteractiveSession for
  //    actions API keys must not perform (403 for keys).
  const session = await requireAuth(event)

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

## Authorization Patterns

### Multi-Tenant Data Isolation

The hierarchy is **Organization (UI: "workspace") → Project → Product**. There are no teams.

- A **project** is a brand (e.g. _Dotmatrixlabs_). It owns the domain, appearance, statuses, categories, GitHub,
  Marketing, the Inbox (formerly Support; all `support_*` tables carry `projectId`) and its people.
- A **product** (e.g. _dot x_, _Decker_) lives in a project. Each product has its own feedback board with its own
  public/private flag (`feedback.productId` is required); roadmap and changelog are project-wide and filter/tag by
  product. A project always has ≥ 1 product; with exactly one, the UI hides the product layer.
- Tools are switched per project only, in `project.settings` (`feedbackEnabled`, `roadmapEnabled`,
  `changelogEnabled`, `supportEnabled`, `marketingEnabled`; see `lib/modules.ts`).
- The Support tool is called **Inbox** in the UI (dashboard routes `/inbox`, `/inbox/contacts`, `/inbox/settings`). Internal
  names stay `support`: the `supportEnabled` key, `/api/support/*`, `support_*` tables, `server/utils/support-*`. Each
  address has a behaviour, Mail or Helpdesk (SLAs, CSAT, auto-replies). Use "Inbox"/"Helpdesk" in user-facing text.
- Marketing provider keys, budgets/usage, email suppression and LLM data consent are organization-level.
- The dashboard works in the session's **active project** (`session.activeProjectId`): use
  `requireAuthWithResolvedProject(event)` or `requireAuthWithOrganization(event)` from `server/utils/project-context.ts`.

Full contract: `docs/plans/2026-10-23-projects-products/design.md`.

### Project Access Utilities (`server/utils/project-access.ts`)

Organization owners/admins administer every project. Other organization members can open a project when its
`accessMode` is `'workspace'` (the default) or when they have a `project_member` row (`'restricted'` projects).
A `project_member` row with role `admin` makes them a project admin.

| Function                                         | Purpose                                                   | Throws                                     |
| ------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------ |
| `requireProjectAccess(projectId, userId)`        | Verify the user can open the project                      | 404 if project not found, 403 if no access |
| `requireProjectAdmin(projectId, userId)`         | Verify the user administers the project                   | 404 / 403                                  |
| `requireOrganizationAdmin(orgId, userId)`        | Verify organization owner/admin                           | 403                                        |
| `requireFeedbackAccess(feedbackId, userId)`      | Verify user has access to feedback's project              | 404 if not found, 403 if no access         |
| `requireProductInProject(projectId, productId?)` | Load a product of the project (default product if absent) | 404                                        |
| `requirePublicProject(projectId)`                | Verify project is public (for anonymous)                  | 404 if not found, 403 if not public        |
| `requirePublicProduct(project, productSlugOrId)` | Verify a product board is public                          | 404 for private products                   |
| `resolvePublicProject(orgSlug, projectSlug)`     | Resolve public project by slugs                           | 404 if not found, 403 if not public        |

### Endpoint Authorization Rules

| Endpoint                                                                                    | Auth     | Access Rule                                                                                                     |
| ------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `GET /api/feedback`                                                                         | Optional | Project access per requested project; anonymous callers see only public products of public projects             |
| `POST /api/feedback`                                                                        | Optional | Authenticated: project access. Anonymous: public project and public product                                     |
| `GET /api/feedback/[id]`                                                                    | Optional | Authenticated: project access. Anonymous: public project and public product                                     |
| `DELETE /api/feedback/[id]`                                                                 | Required | Author OR anyone with access to the project                                                                     |
| `POST /api/feedback/[id]/vote`                                                              | Optional | Project and product must be public (voting is public-facing)                                                    |
| `POST /api/v1/feedback`                                                                     | App key  | Creates feedback on the key's product (key is the authorization; bypasses public checks)                        |
| `/api/projects/[slug]/api-keys`                                                             | Required | Project admins manage app keys (Feedback settings → App keys)                                                   |
| `/api/user/api-keys` (+ `/[keyId]`)                                                         | Required | Browser session only (`requireInteractiveSession`); 403 for personal keys. Max 25 active keys per user          |
| `POST /api/device/code`, `POST /api/device/token`                                           | Public   | Device login start and poll; rate limited per IP; errors are RFC 8628 bodies                                    |
| `/api/device/requests/[userCode]` (+ `/approve`, `/deny`)                                   | Required | Browser session only; approving mints a 90-day personal key                                                     |
| `/api/projects/[slug]/imports` (+ `/[runId]`, `/records`, `/preview`, `/commit`, `/cancel`) | Required | Project admins only (`requireProjectBySlug` with `admin: true`); work with keys. MCP tools `import_*` wrap them |
| `GET /api/imports/schema`                                                                   | Required | The `veerify-import/1` JSON Schema and example                                                                  |
| `POST /mcp`                                                                                 | User key | Personal key principals only (cookie-only gets 401); acts with the key owner's permissions                      |

### Imports

Services live in `server/services/imports/` (format, planner, committer, claim, tombstones, suppression). Commit
suppresses every side effect (no emails, notifications, realtime, GitHub or subscriptions). Re-import is a sync where
Veerify wins. Agent guide: `docs/mcp.md`.

- An import never matches users by email. Activity is attributed to a user only after that user verifies a matching
  email: claiming runs from Better-Auth's `afterEmailVerification`, `user.create.after` (user created verified) and
  `user.update.after` only while `/verify-email` or `/magic-link/verify` is handled (`lib/auth.ts`). Never claim from
  any other user update.
- Later imports for a person who has already been claimed are attributed to that user (`authorUserId` /
  `voterUserId` = `claimedByUserId` at insert). Newly imported people are not auto-claimed.
- Deleting imported feedback or comments writes an `import_tombstone` row; re-imports skip tombstoned records. Unvoting
  a claimed imported vote clears `voterUserId` and keeps the row.
- Transient database errors leave a run `committing` (resumed by `imports:advance`); deterministic errors fail it.

### Roles

- Organization: `owner`, `admin` (administer every project, workspace settings, API keys), `member`.
- Project (`project_member.role`): `admin` (tools, project settings, members) or `member` (use every tool).
- Inbox addresses keep their own roles (`agent`, `supervisor`, `admin`); project admins act as inbox admins.

---

## Page & Layout Conventions

### Layouts

- Dashboard pages get the `dashboard` layout from route meta, assigned by the `pages:extend` hook in
  `nuxt.config.ts` (`DASHBOARD_PAGE`). The layout then stays mounted across navigation, so the sidebar never reloads.
  **Never wrap a dashboard page in `<NuxtLayout>`.** A new top-level dashboard section needs its folder added to
  `DASHBOARD_PAGE`.
- Clean pages (auth, public token pages) wrap their content in `<NuxtLayout name="clean">` and use `AuthCard`.
- Dashboard pages render `PageContainer` (width `default` = `max-w-6xl`, `narrow` = `max-w-3xl` for detail and
  editor pages, `full` for boards) with a `PageHeader` first. The layout owns the gutters: no `p-6`.
- Full-bleed pages (the inbox) are listed in `FLUSH_DASHBOARD_PAGE` in `nuxt.config.ts`: the layout drops its gutters
  and page scroll, and the page fills the space under the header with its own panes.
- Header actions render from the first paint (disabled while loading), skeletons match the content's shape, and each
  `v-if` loading/content branch is a single element (multi-root `<template v-if>` branches break hydration).
- Settings-style pages use `SettingsTabs` (`?tab=` in the URL; visited and hovered tabs stay mounted).
- Pages that work in the active project read it from `lib/active-project.ts` (`loadActiveProject`), not a raw fetch.
- The public site is one persistent `PublicProjectShell` (`PublicProjectSite`); tab data goes through
  `lib/public-cache.ts`.

### Route Categories

| Route                                                       | Layout      | Auth State                        |
| ----------------------------------------------------------- | ----------- | --------------------------------- |
| `/`                                                         | —           | Redirects based on session        |
| `/login`, `/signup`, `/forgot-password`                     | `clean`     | Public (redirects away if authed) |
| `/dashboard`, `/feedback`, `/reports`, `/settings`, `/help` | `dashboard` | Protected                         |

---

## Cursor IDE Rules

The project ships context-aware Cursor rules in MDC format:

| File                               | Scope                                         |
| ---------------------------------- | --------------------------------------------- |
| `.cursor/rules/project.mdc`        | Project-wide patterns, security, architecture |
| `server/.cursor/rules/api.mdc`     | API routes, database, server auth             |
| `components/.cursor/rules/vue.mdc` | Vue components, UI patterns, client-side auth |

These mirror the conventions in this file. Keep them in sync when making architectural changes.

---

## Agent Skills

Reusable skill prompts live in `.agents/skills/`. Use them when asked to scaffold common structures:

| Skill file                        | Invoke with      | Purpose                                      |
| --------------------------------- | ---------------- | -------------------------------------------- |
| `.agents/skills/new-api.md`       | `/new-api`       | Scaffold a protected server API endpoint     |
| `.agents/skills/new-page.md`      | `/new-page`      | Scaffold a new dashboard page                |
| `.agents/skills/new-component.md` | `/new-component` | Scaffold an Options API Vue component        |
| `.agents/skills/db-change.md`     | `/db-change`     | Guide a schema change + migration end-to-end |

---

## Rules for AI Assistants

1. **Use Options API exclusively.** Never introduce `<script setup>` or Composition API imports.
2. **Do not edit `components/ui/`** — these are generated by shadcn-vue CLI. Run `npx shadcn-nuxt add <component>` to add new ones.
3. **Always authenticate** new server API routes with `requireAuth` (or `requireAuthWithResolvedProject` / `requireAuthWithOrganization`) from `server/utils/`, not `auth.api.getSession()` (which rejects personal API keys). Use `requireInteractiveSession` for actions API keys must not perform.
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
14. **Always use project access utilities** when implementing new endpoints that interact with projects or feedback. Never rely solely on `projectId` parameter presence.
15. **Public vs Private projects** — Public projects accept anonymous feedback/votes. Private projects (and private products) require project access for all operations.
16. **Always read `.agents/CLAUDE.md` first** — it is the authoritative source of project conventions. The root `CLAUDE.md` imports it via `@.agents/CLAUDE.md`.
