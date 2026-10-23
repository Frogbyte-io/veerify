# Projects & products restructure — contract

Status: in progress (branch `feat/projects-products`). Mockups: `docs/plans/2026-10-23-ux-structure-*.html`
(v3-brands is current; "brand" there = **project** here).

## Decisions (from the product owner)

- **Model:** Organization (UI: "workspace") → **Project** → **Product**.
  - Project = the brand, e.g. _Dotmatrixlabs_, _Veerify_. Owns domain, appearance, statuses,
    categories, GitHub, Marketing, Support, people.
  - Product = a sub-unit, e.g. _dot x_, _Decker_. Each product has **its own feedback board** with its
    **own public/private flag**. Roadmap and changelog are project-wide and **filter/tag by product**.
  - Every project has ≥ 1 product. **With exactly one product the UI hides the product layer** — the
    project simply _is_ the product (no product chips/tabs/sub-nav anywhere).
- **Teams are removed entirely.** No team UI, tables, or APIs. No backwards compatibility: old URLs,
  `team:` channels, `/api/teams/*` simply go away. (Existing data was migrated, see below.)
- **Access:** people are assigned to projects. New projects are open to **everyone in the workspace** by
  default (`accessMode: 'workspace'`); a project can be **restricted** to listed people.
- **Tools** (Feedback, Roadmap, Changelog, Support, Marketing) are switched **per project only**
  (`project.settings.<key>Enabled`). The team-level switch is gone.
- **Support** is project-scoped (inboxes, contacts, SLA, tags, canned replies, CSAT, automations, sending domains).
- **Marketing** can be _used_ by any project member. Money/credential settings (provider API keys, budgets,
  integration status, LLM data consent, contact erasure) move to **workspace settings**, org owners/admins only.
  Existing team API keys were **not** migrated (encryption was bound to the team id) — re-entered by the user.
- **Navigation (variation A):** project switcher at the top of the sidebar; each tool keeps its settings in a
  **Settings tab inside the tool**; personal settings (`/settings`) are split from workspace settings (`/workspace`).

## Data model (done in phase 0 — do not change without the integrator)

Migrations `0056` (additive), `0057` (custom backfill), `0058` (drops). Schema files are final.

| Table                     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project`                 | `organizationId` (no `teamId`), slug unique per org (`project_org_slug_idx`), `accessMode` `'workspace' \| 'restricted'`, `settings` jsonb holds tool switches incl. **`supportEnabled`**, theme, etc. `isPublic` = the public site exists.                                                                                                                                                                                                                                                                                             |
| `project_member`          | `(projectId, userId)` unique, `role` `'admin' \| 'member'`. Org owners/admins never need a row.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `product`                 | `projectId`, `name`, `slug` (unique per project), `description`, `isPublic` (default true), `sortOrder`.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `feedback.productId`      | **NOT NULL**, FK restrict. Every feedback item belongs to one product.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `changelog_entry_product` | `(entryId, productId)`; no rows = entry applies to the whole project.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| support tables            | every former `teamId` is now **`projectId` NOT NULL** (support*company, contact, contact_identity, support_inbox, business_hours, sla_policy, support_counter (PK), conversation, conversation_status_event, support_tag, csat_survey, canned_response, automation_rule, support_metric_daily, support_sending_domain). Index names `\*\_team*_`→`__project_\*`. `support_team_settings` → **`support_project_settings`** (PK projectId). `support_inbox_address.projectId` stays (nullable attribution, now always = inbox's project). |
| marketing                 | `organization_api_credential` (replaces `team_api_credential`, unique (org, provider)); `marketing_usage` PK (organizationId, period, metric); `marketing_email_suppression` PK (organizationId, email); `marketing_data_consent` PK organizationId; `marketing_site.teamId` and `review_request.teamId` dropped (use `project.organizationId`).                                                                                                                                                                                        |
| `session`                 | `activeProjectId` (Better-Auth additional field) replaces `activeTeamId`.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| dropped                   | `team`, `team_member`, `team_module_settings`, `team_api_credential`, `support_team_settings`, `roadmap_item` (was unused), `invitation.teamId`.                                                                                                                                                                                                                                                                                                                                                                                        |

Better-Auth: organization plugin **without** teams (`lib/auth.ts`, `lib/auth-client.ts` done).

## Core server helpers (phase 0, done — use these, don't reimplement)

`server/utils/project-access.ts`

- `getOrganizationRole(orgId, userId)`, `isOrganizationAdminRole(role)`
- `resolveProjectRole(project, userId)` / `getProjectRole(projectId, userId)` → `'admin' | 'member' | null`
- `hasProjectAccess`, `isProjectAdmin` (booleans)
- `requireProjectAccess(projectId, userId)` → project (404/403) — same signature as before
- `requireProjectRole(projectId, userId)` → `{ project, role }`
- `requireProjectAdmin(projectId, userId)` → project (403 unless admin)
- `requireOrganizationAdmin(orgId, userId)`, `requireOrganizationMember(orgId, userId)`
- `listAccessibleProjects(orgId, userId)` → projects + `role`; `listAccessibleProjectIds(userId)`
- `requireFeedbackAccess(feedbackId, userId)` (unchanged signature)
- Products: `listProducts(projectId)`, `getDefaultProduct(projectId)`, `requireProductInProject(projectId, productId?)` (default product when omitted)
- Public: `requirePublicProject(projectId)`, `requirePublicProduct(project, productSlugOrId?)` (404 for private), `listPublicProducts(projectId)`, `resolvePublicProject(orgSlug, projectSlug)` → `{ organization, project }`, `findPublicProjectByDomain(hostname)` → `{ project, organization, domainStatus } | null`

`server/utils/project-context.ts` (replaces deleted `team-context.ts` / `team-membership.ts`)

- `requireAuthWithResolvedProject(event)` → `{ session, activeProject }` (activeProject has `role`); 409 when the user has no project. **Mechanical replacement for `requireAuthWithResolvedTeam`.**
- `requireAuthWithOrganization(event)` → `{ session, organizationId, organizationRole }` for workspace-level endpoints.
- `resolveActiveProjectForSession(session)`, `setActiveProjectForSession({ sessionToken, userId, projectId })`, `setActiveOrganizationForSession({ sessionToken, userId, organizationId, preferredProjectId? })`

`lib/modules.ts` — single level: `MODULES`, `ModuleKey`, `ModuleSettings`, `MODULE_KEYS`, `DEFAULT_PROJECT_MODULES`,
`resolveProjectModules(settings)`, `isModuleEnabled(settings, key)`, `isModuleKey`. (`resolveProductModules`,
`PRODUCT_MODULES`, `DEFAULT_TEAM_MODULES`, `pickTeamModules` are gone.)

`server/utils/public-modules.ts` — `isModuleEnabledForProject(projectSettings, key)` (sync, no team arg).

Realtime: channel scope `team:` → **`project:`**; `projectChannel(projectId)` replaces `teamChannel`;
envelope field `teamId` → `projectId` (server `services/realtime/types.ts`, client `lib/realtime-client.ts`).
`authorizeChannelWith` deps use `hasProjectAccess`.

## API contract

All responses keep the existing `{ success, data }` envelope (`server/utils/response.ts`). "Admin" = project admin
(org owner/admin or `project_member.role = 'admin'`) unless stated.

### Context & projects (Agent A)

```ts
type ProductSummary = {
  id: string
  name: string
  slug: string
  description: string | null
  isPublic: boolean
  sortOrder: number
}
type ProjectSummary = {
  id: string
  name: string
  slug: string
  description: string | null
  isPublic: boolean
  accessMode: 'workspace' | 'restricted'
  role: 'admin' | 'member'
  organizationId: string
}
type ActiveProjectContext = {
  project: ProjectSummary & { settings: Record<string, unknown> }
  organization: { id: string; name: string; slug: string; logo: string | null; role: 'owner' | 'admin' | 'member' }
  products: ProductSummary[] // ordered; length 1 => hide product layer in UI
  modules: ModuleSettings // resolveProjectModules(project.settings)
}
```

- `GET  /api/projects/active` → `ActiveProjectContext` (409 `CONFLICT` when the user has no project → client routes to create one)
- `POST /api/projects/active` `{ projectId }` → `ActiveProjectContext`
- `GET  /api/projects` → `Array<ProjectSummary & { productCount: number }>` (accessible projects in the active org)
- `POST /api/projects` `{ name, slug?, description?, isPublic? }` → `{ project: ProjectSummary, product: ProductSummary }` — **org admin only**; creates the default product (same name/slug); does not switch the active project.
- `GET  /api/projects/[slug]` — project in the active org by slug (access required). Same shape as today minus team fields, plus `role`, `products`, `organization { id, name, slug }`.
- `PUT  /api/projects/[slug]` — admin. Existing fields plus `accessMode`, tool switches in `settings`.
- `DELETE /api/projects/[slug]` — **org admin only**.
- `GET  /api/projects/[slug]/members` → `{ accessMode, members: Array<{ userId, name, email, image, role: 'admin'|'member', source: 'organization_admin' | 'project_member' | 'workspace' }> }` — every org member who can open the project (`workspace` = implicit access).
- `POST /api/projects/[slug]/members` `{ userId, role }` (admin; user must be an org member) · `PATCH /api/projects/[slug]/members/[userId]` `{ role }` · `DELETE /api/projects/[slug]/members/[userId]`
- `GET  /api/projects/[slug]/products` → `ProductSummary[]`
- `POST /api/projects/[slug]/products` `{ name, slug?, description?, isPublic? }` (admin) → `ProductSummary`
- `PUT  /api/projects/[slug]/products/[productId]` `{ name?, slug?, description?, isPublic?, sortOrder? }` (admin)
- `DELETE /api/projects/[slug]/products/[productId]?moveTo=<productId>` (admin) — 409 if it is the last product; 409 if it has feedback and no `moveTo`.
- Product slugs must not be `roadmap`, `changelog`, `testimonials`, `support`, `products`, `settings`, `api` (public sub-pages). Project slugs must not be reserved (`server/utils/reserved-slugs.ts`, add `active`).
- `POST /api/organizations/active` `{ organizationId, projectId? }` → `{ organization, project: ProjectSummary | null }`
- `GET  /api/dashboard/bootstrap` → replaces `teamContext` with `projectContext: { organizations, activeOrganization, projects: ProjectSummary[], activeProject: ActiveProjectContext | null }`.
- `GET  /api/dashboard/stats` — stats for the active project.
- **Deleted:** everything under `/api/teams/**`, `/api/org-context/*` (fold into bootstrap/active if still needed).
- Workspace members/invitations keep `/api/orgs/[slug]/*`; invitations no longer carry `teamId`.

### Feedback, roadmap, changelog, public (Agent B)

- `GET /api/feedback?projectIds=…&productId=…` — **must check `hasProjectAccess` for every requested project** (current code has no check — security fix); anonymous callers only see public projects/products. Items include `productId` and `product { id, name, slug }`.
- `GET /api/feedback/export` — same access fix.
- `POST /api/feedback` `{ projectId, productId?, … }` — `productId` validated with `requireProductInProject` (default product when omitted). Anonymous posts require a public project **and** public product.
- `PATCH /api/feedback/[id]` accepts `productId` (move between products of the same project).
- `GET /api/roadmap/projects/[projectId]?productId=` — items carry `productId`; response includes `products: ProductSummary[]` and `publicUrl`.
- Changelog: create/update accept `productIds: string[]` (empty = whole project); list accepts `?productId=` (returns entries tagged with it **or** untagged); entries return `productIds`.
- Public API moves from `/api/public/t/[teamSlug]/…` to **`/api/public/o/[orgSlug]/…`**:
  - `GET /api/public/o/[orgSlug]` — org's public projects
  - `GET /api/public/o/[orgSlug]/[projectSlug]` — project, **public products**, modules, branding
  - `GET|POST /api/public/o/[orgSlug]/[projectSlug]/products/[productSlug]/feedback`
  - `GET /api/public/o/[orgSlug]/[projectSlug]/roadmap?product=<slug>` and `/changelog?product=<slug>`, `/changelog/[slug]`, `/changelog.rss`, `/testimonials`
  - `GET /api/public/o/[orgSlug]/[projectSlug]/viewer` → `{ isMember: boolean, role: 'admin'|'member'|null }` (replaces client-side team-slug admin check)
  - Roadmap/changelog public output excludes items/entries that belong **only** to private products.
- Hostnames: default subdomain is **`<organization.slug>.APP_DOMAIN`** (was team slug). Custom domains map to a project. Page paths: `/<project>` (board when 1 product, else product list) · `/<project>/<product>` · `/<project>/roadmap|changelog[?product=]`; on a custom domain drop the `/<project>` segment. `lib/public-board-url.ts` → `buildPublicBoardUrl({ orgSlug, projectSlug, productSlug?, customDomain? })`.

### Support (Agent C)

- `/api/support/teams/[teamId]/**` → **`/api/support/projects/[projectId]/**`\*\* (same subtree: settings, sla, csat-summary, csat-surveys, automation-rules, sending-domains).
- `teamId` query/body params on contacts, companies, canned-responses, inboxes, tags → **`projectId`**. Response fields `teamId` → `projectId`.
- Team-admin checks → `requireProjectAdmin`/`isProjectAdmin`; membership checks → `requireProjectAccess`/`hasProjectAccess`. Inbox roles (agent/supervisor/admin) unchanged; "team admin" → "project admin" (`isProjectAdmin` in `InboxAccess`).
- Support enablement = `project.settings.supportEnabled` (inbound route checks it).
- Platform addresses use the **project slug** (+ org slug if needed for uniqueness) instead of the team slug.
- Sending-domain policy value `'team'` → `'project'`. Realtime: publish on `projectChannel`.

### Marketing (Agent D)

- `requireMarketingAccess` → `{ project, organizationId }` (any project member, marketing switched on for the project). "Marketing admin" = project admin. Data/credential admin = **org owner/admin**.
- Project routes keep `/api/marketing/projects/[projectId]/**`.
- Workspace routes (replacing `/api/marketing/teams/[teamId]/**`), org owner/admin to write, any org member to read, active org via `requireAuthWithOrganization`:
  - `GET /api/workspace/api-keys` · `PUT /api/workspace/api-keys/[provider]` `{ key }` · `PATCH /api/workspace/api-keys/[provider]` `{ monthlyBudgetCents }` · `DELETE /api/workspace/api-keys/[provider]`
  - `GET|PUT /api/workspace/data-consent`
  - `GET /api/workspace/integrations` · `POST /api/workspace/integrations/[id]/test`
  - `POST /api/workspace/erase-contact`
  - Response shapes identical to the old team routes (minus `teamId`).
- Usage/budgets/suppression/consent keyed by `organizationId`. Encryption associated data `org:<orgId>:<provider>` (`secrets-rotation.ts` too).
- Public URLs (announcements, llms.txt, testimonials) use the org slug via `buildPublicBoardUrl`.

## UI contract

- **Options API only**, `<Icon name="lucide:*">`, Skeleton loading + error-with-retry, `import.meta.client`.
- Components are registered with `pathPrefix: false`: **every component's file basename must equal its tag name** and be globally unique.
- Client "active project" source: `GET /api/projects/active`; after switching, dispatch `window` event **`veerify:active-project-changed`**; after toggling tools, **`veerify:project-modules-changed`**. (Old `veerify:active-team-changed` / `veerify:team-modules-changed` are gone.)
- Wording: "workspace" (org), "project", "product". Never "team". Single-product projects: never show product chips, product columns, product sub-nav, or the word "product" where the project name suffices.
- Routes:
  - `/settings` — personal only (Profile, Security, Notifications, Appearance)
  - `/workspace` — workspace settings (General, Members, Projects, AI & API keys, Integrations, Data & privacy, Billing/Status) — org owner/admin can edit, members read-only with a lock line
  - `/project/settings` — active project settings (General, Products, Members & access, Tools, Appearance, Domain, Embed, Danger)
  - Tools keep their pages (`/feedback`, `/dashboard/roadmap`, `/dashboard/changelog`, `/support`, `/marketing/*`), each with a **Settings** tab/page for tool-specific settings: Feedback → defaults, categories, statuses, GitHub; Support → existing `/support/settings`; Marketing → site, terms (no API keys).
  - `/products*` pages are removed.
- Sidebar (variation A): project switcher (current project; list of accessible projects; other workspaces; "New project" for org admins; "Workspace settings") → Overview, Feedback (per-product sub-items only when > 1 product), Roadmap, Changelog, Marketing, Support (Inbox, Contacts) — only tools switched on — then "Project settings"; for admins "+ Add tool" when some tools are off (→ `/project/settings#tools`); **Workspace** group: Workspace settings; **You**: My submissions, Notifications.
- Permission visibility: anything the user cannot change shows a lock line ("Project admins can change this").

## Ownership (parallel agents)

Each agent works in its own worktree, starts with `git merge --ff-only feat/projects-products`, edits **only its
files**, updates/deletes the unit + integration tests for its area, and commits on its own branch. Do **not** edit
`server/generated/openapi-routes.ts` (the integrator regenerates it) or the schema/migrations/phase-0 helpers
(ask the integrator via your final report if a helper is missing).

| Agent                                        | Owns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A — context & workspace server               | `server/api/projects/{index,active}*`, `server/api/projects/[slug].*`, `server/api/projects/[slug]/{members,products}/**`, delete `server/api/teams/**` & `server/api/org-context/**`, `server/api/orgs/**`, `server/api/organizations/**`, `server/api/dashboard/**`, `server/api/auth/**`, `server/api/openapi.json.get.ts`, `server/utils/{dashboard-bootstrap,organization-access,project-categories,project-statuses,reserved-slugs,openapi,notifications,auth-headers}.ts`, `server/api/projects/[slug]/{categories,statuses,github,assets}/**` + `verify-domain`, `lib/{org-switch,dashboard-bootstrap-client,email,email-templates}.ts`, `scripts/seed.ts`, delete `scripts/backfill-default-team-memberships.ts`, `tests/e2e/helpers/**`, tests for these |
| B — feedback/roadmap/changelog/public server | `server/api/{feedback,feedback-attachments,roadmap,changelog,public,github}/**`, `server/services/changelog/**`, `server/utils/{changelog-access,roadmap-access,feedback-attachment-access,tls-ask}.ts`, `server/api/system/**`, `server/middleware/subdomain.ts`, `plugins/subdomain.*`, `server/services/domains/**`, `scripts/ensure-team-subdomains.ts` (→ org subdomains), `lib/{public-board-url,public-shell}.ts`, tests for these                                                                                                                                                                                                                                                                                                                          |
| C — support server                           | `server/api/support/**`, `server/api/cron/support-*`, `server/api/csat/**`, `server/utils/{support-*,sla-*,csat-*,contact-*,inbound-*,conversation-*,automation-engine,platform-address,sending-domain*,sender-enforcement,support-realtime}.ts`, `server/services/support*/**`, sending-domain services, `scripts/backfill-sending-domains.ts`, tests for these                                                                                                                                                                                                                                                                                                                                                                                                   |
| D — marketing server                         | `server/api/marketing/**`, new `server/api/workspace/**`, `server/api/cron/marketing-*`, `server/services/marketing/**`, `server/services/scheduler/tasks/marketing-*`, `server/utils/{marketing-*,team-credentials→org-credentials,secrets-rotation}.ts`, `server/api/r/**`, tests for these                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| E1 — shell & workspace UI                    | `components/sidebar/**` (TeamSwitcher → ProjectSwitcher), `lib/sidebar-nav.ts`, `middleware/**`, `layouts/**`, `pages/settings/**`, new `pages/workspace/**`, `components/settings/**`, `components/workspace/**`, `components/marketing/settings/{MarketingSettingsApiKeys,MarketingSettingsIntegrations,MarketingSettingsPrivacy}.vue` (move to workspace), `pages/{onboarding,accept-invitation,get-started,help,submissions,reports}/**`, `pages/dashboard/index.vue`, `components/NavUser*`, `NotificationBell.vue`, tests for these                                                                                                                                                                                                                          |
| E2 — project settings UI                     | new `pages/project/**`, `components/products/**` → `components/project/**` (rename `ProductSettings*` → `ProjectSettings*`; Categories/Statuses/GitHub/Feedback-defaults components move to E3a), delete `pages/products/**`, tests for these                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| E3a — feedback/roadmap/changelog/public UI   | `pages/feedback/**`, `pages/dashboard/{roadmap.vue,changelog/**}`, `components/{feedback,roadmap,changelog,public}/**`, `pages/index.vue`, `pages/[...slug].vue`, `pages/{csat,testimonial}/**`, Feedback settings tab (moved Categories/Statuses/GitHub/Feedback-defaults components, renamed `FeedbackSettings*`), tests for these                                                                                                                                                                                                                                                                                                                                                                                                                               |
| E3b — support & marketing UI                 | `pages/support/**`, `components/support/**`, `pages/marketing/**`, `components/marketing/**` except E1's three settings files (remove `MarketingProductPicker`; marketing uses the active project), tests for these                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Integrator (main agent): merges branches, regenerates OpenAPI, resolves seams, runs typecheck/lint/unit/integration/e2e.
