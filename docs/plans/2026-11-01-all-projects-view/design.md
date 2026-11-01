# All projects

Sketch: `docs/plans/2026-11-01-all-projects-view/sketch.html` (open it in a browser; the notes under the
prototype list every decision). This file is the contract the implementation follows.

## What it is

Next to picking one project, the project switcher offers **All projects**: the dashboard then combines
every project the user can open in the active workspace. Inbox, Feedback, Roadmap, Changelog and the
Overview work across projects; Marketing, project settings, inbox settings and contacts stay per project
and are hidden.

Decisions (settled with the user):

- All projects only exists with **two or more** projects the user can open (restricted projects they are
  not in are left out, so admins and members can see different sets).
- It is a place, not a filter: stored per session (and per API key), and **the last used context is
  restored at sign-in**.
- **Full actions in place**: reply, triage, change status, merge, publish. Creating something asks which
  project (and product), defaulting to the last project used.
- **Filter chips** narrow All projects to some projects. Selection lives in `?projects=id1,id2` and is
  remembered per page. Empty = every project.
- Every row/card is tagged with its project (colour + initials, `ProjectTag`) **only in All projects**.
- The combined **inbox is sorted by time**, newest first, no grouping.
- The combined **roadmap merges columns by status value**; a status only one project has gets its own
  column marked "<Project> only".
- **Reports** will be combined too once Reports exists (nothing to do now).
- **Overview** is redesigned for both modes (see below). "Needs you" is team-wide (everything
  unanswered/untriaged), the four 7-day numbers are as sketched.

## Data model

- `session.active_project_scope` and `user_api_key.active_project_scope` (migration `0073`): `'all'` = All
  projects, `null` = the one project. `activeProjectId` keeps the **last single project** in All projects,
  so project-only pages keep working on it.
- `user.settings.lastContext = { organizationId, projectId, scope }` is written on every explicit switch
  from a browser session (`server/utils/last-context.ts`) and copied into new sessions by Better-Auth's
  `session.create.before` hook (`lib/auth.ts`).

## Server contract (`server/utils/project-context.ts`)

- `requireAuthWithProjectScope(event)` → `{ session, activeProject, scope, projects }`. `projects` is every
  accessible project for `'all'` (creation order) else `[activeProject]`. A stored `'all'` with fewer than
  two accessible projects is repaired to `'project'`.
- `requireScopedProjects(event, { module? })` → the above plus `scopeProjects`; `projects` is narrowed by
  the `projects` query parameter (comma-separated ids; an id outside the scope is **403**, never dropped)
  and to projects with `module` (a `lib/modules.ts` key) on. **Every combining endpoint uses this.** It
  works in single-project mode too (then the scope is just the active project), so one endpoint can serve
  both modes.
- `setAllProjectsForSession` / `POST /api/projects/active { scope: 'all' }` (409 with < 2 projects).
- `GET /api/projects/active` (and the dashboard bootstrap's `projectContext.activeProject`) now include
  `scope`, `projects: ScopeProject[]` (summary + `identity` + `modules` + `productCount`) and
  `allProjectsAvailable`; `project.identity` is set too. `GET /api/projects` returns `ScopeProject[]`.
- Project identity (`lib/project-identity.ts`): `{ color, initials, logoUrl }`; colour = changed accent
  colour, else a palette colour by the project's creation position in its workspace. Server helpers in
  `server/utils/project-summary.ts`: `toScopeProjects`, `projectIdentityIndex`, `identityFor`.
- Item rows returned by combining endpoints carry `project: { id, name, slug }`; clients look up the
  identity in the context's `projects` by id (don't send identity per row).

## Client contract

- `lib/project-scope.ts`: `isAllProjects(ctx)`, `scopeProjects(ctx)`, `scopeProjectsWithModule(ctx, key)`,
  `scopeModules(ctx)` (union in All projects), `findScopeProject(ctx, id)`, `parseProjectFilter`,
  `projectFilterParam(ids)` (value for `?projects=`), `isProjectOnlyRoute(path)`.
- Context comes from `loadActiveProject()` (`lib/active-project.ts`); `veerify:active-project-changed`
  fires on any switch, including to/from All projects. Pages must reload their data on it.
- Components (`components/project-scope/`, registered without path prefix):
  - `<ProjectScopeChips v-model="selectedIds" :projects="scopeProjects" page="inbox" module="supportEnabled" :counts="countsById" />`
    — only render it in All projects. It restores the selection from the URL/storage on mount and emits it.
  - `<ProjectTag :project="scopeProject" suffix="dot x" />` — badge + name for rows.
  - `<ProjectBadge :project="scopeProject" size="xs|sm|md|lg" />`, `<ProjectBadgeStack :projects />`.
- Switcher: "All projects" on top (Alt+0; projects Alt+1…9). Sidebar: union of tools, Marketing / Manage /
  inbox Contacts + Settings hidden, a note explains where they went.

## Per tool

### Inbox (`/inbox`)

- Single project: unchanged.
- All projects: one combined list over every inbox the user can work in, across the scoped projects with
  `supportEnabled`, newest first. Rows: project colour as a 3px left edge + `ProjectTag`. Chips with
  per-project counts. Opening a conversation works exactly as today (thread, composer, actions) because
  conversation endpoints are per conversation; the composer says which project address it replies from;
  an "Open in <project>" action switches to that project.

### Feedback (`/feedback`)

- `GET /api/feedback` already accepts `projectIds` and returns `project` per item; in All projects pass the
  scoped ids. Rows show `ProjectTag` (with product suffix when the project has several products). Status
  filter offers the union of statuses. "New feedback" asks project → product (default: last used).

### Roadmap (`/dashboard/roadmap`) and Changelog (`/dashboard/changelog`)

- Combined roadmap: columns merged by status `value` (first project's name/colour wins); a status only one
  project has gets its own column labelled "<Project> only". Cards have the project colour edge + tag.
- Combined changelog: one timeline, newest first, each entry tagged; "New entry" asks for the project.

### Overview (`/dashboard`)

Same page in both modes; in All projects with chips. Top to bottom:

1. **Needs you** — sentences with one action each, most urgent first: SLA breaching soon (Reply), N
   conversations waiting for a reply (Open inbox, with per-project breakdown), N feedback posts with no
   status yet = still on the project's default status (Triage), changelog drafts (Review draft). Empty:
   "You're all caught up".
2. **Last 7 days** — Conversations received, Median first reply, New feedback posts, Votes; each with
   "↑/↓ n% vs previous 7 days" against the same projects. Only reply time is coloured (faster = green);
   volumes stay neutral. In All projects with 2+ projects in view a thin bar splits each count by project.
3. **Projects** table (All projects with 2+ projects in view): Project, Waiting for reply, SLA at risk, New
   feedback (7 days), Votes (7 days), Last release; problems red, zeros grey, "Inbox off"/"Changelog off"
   in words; clicking a row switches to that project.

Personal accounts (no workspace) keep today's "My submissions" dashboard.
