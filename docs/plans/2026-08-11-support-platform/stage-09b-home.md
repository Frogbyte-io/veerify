# Stage 09b — Home

**Depends on:** Stage 02. **Blocks:** nothing.
**Read `design.md` first.**

**Goal:** A fixed, always-visible **Home** destination showing what a user is personally involved in —
assigned tickets, recent feedback — across every team they belong to, without requiring them to switch
teams one at a time to find their own work.

> Outline-level detail, recorded 2026-08-14 as a future task. Not scheduled, not dispatched. Refine into
> full step detail when unblocked.

**Positioned at 09b at the requester's direction**, and numbered `09b` so Stages 10–13 are not renumbered
(they are referenced by number across `design.md`, `deltas.md`, and seven stage docs).

**Its only dependency is Stage 02**, and it stays light because of a design choice explained below: Home
is a small set of its own cross-team **read** pages, not a mode that changes what `/support` and
`/feedback` mean. It can be pulled forward into the post-Stage-02 parallel group alongside Stages 10, 11,
and 13 whenever wanted.

## Home is a nav destination, not a picker scope

This went through two earlier drafts and it is worth recording why they were rejected, so nobody
re-derives the same dead ends.

**Draft 1 — "Organization workspace"**, an org-wide stats view. Rejected: organization membership does
not imply membership of every team in it, so an org-wide page showing only a user's subset is a partial
view of something claiming to be complete, and "show everything in the org" is the obvious wrong
shortcut.

**Draft 2 — "Home" as a third entry in the team picker**, alongside the teams, which reroutes every
team-scoped surface (`/support`, `/feedback`, `/products`, …) into a cross-team aggregate while selected.
This fixed the authorization framing but introduced a harder problem: **what happens when you click
through from an aggregate view to one specific item?** A ticket in the Home inbox belongs to exactly one
team. Does selecting it silently snap the picker to that team, or does the picker keep saying "Home"
while you act on a team-owned item? Answering that consistently means every surface needs its own
scope-transition rule, "new conversation" has no implicit team while Home is selected, and a live
cross-team inbox needs new realtime fan-out (subscribing to every inbox in every team approaches
`MAX_CHANNELS_PER_PEER`).

**This draft — Home as a fixed sidebar destination, separate from the picker** — removes the problem
instead of solving it. The team picker goes back to being purely "which team's workspace am I working in
right now," unchanged in kind from today. Home is a small set of its own routes (`/home`, `/home/inbox`,
`/home/feedback`) that list things across teams and link out to their real, team-scoped pages. `/support`
and `/feedback` are not touched by this stage at all — no dual-mode logic, no team-set query rewiring, no
scope-transition question, because Home never claims to represent your current context. It is a jumping-
off list, the same relationship Linear's "My Issues" and GitHub's cross-org pull-request page have to
their respective team/org views.

## Scope

**In:** the `/dashboard` → `/home` rename, a fixed Home entry in the sidebar's Personal group (visible
regardless of active team or organization), and `/home/inbox` and `/home/feedback` as small cross-team
read views.

**Out:** any change to the team picker beyond removing the misleading row described below — it does not
gain a Home option. Any change to `/support`, `/feedback`, or their APIs — they stay purely team-scoped.
Per-team or organization-wide *statistics* (needs Stage 09; recorded as a later extension). Cross-team
contact merging or conversation moves. Creating anything from a Home page — creation still happens inside
a team.

**Scope boundary:** Home spans the teams the user belongs to **within the active organization**, not
across organizations. This matches the picker, which only ever lists the active organization's teams.

## The existing picker entry gets deleted, not replaced

`components/sidebar/TeamSwitcher.vue` renders a "Workspace" row above the team list, styled like a team
entry, that reads as a cross-team scope (delta D-30). It is not one:

- `switchToDefaultTeam()` resolves the team **named `Default`** and activates it. The app remains in a
  single-team scope afterwards.
- `additionalTeams` filters `name !== 'Default'`, hiding that team from the list and silently reusing it
  as a pseudo-org entry.
- `displaySubtitle` renders "All projects" in that state, which is **false** as soon as a second team
  owns a project.

Because Home is no longer a picker concept, the fix is simpler than earlier drafts assumed: **delete the
row.** `switchToDefaultTeam` and the `additionalTeams` filter go with it, so the `Default` team appears in
the list like any other team, and the picker no longer makes a claim it can't back up. No new scope-
resolution layer is needed behind it.

## `/dashboard` becomes `/home`

`pages/dashboard/index.vue` already has two modes:

- **Personal** (no active organization) — "Welcome, {name}", My Submissions / Completed / Total Votes.
- **Workspace** (organization active) — "Dashboard", *"Overview of your team's feedback activity"*,
  scoped to the **active team**.

The renamed `/home` keeps the workspace mode's presence (so it is still useful once teams exist) but is
no longer keyed on organization state — it becomes the fixed, always-personal destination, sitting above
the team list rather than swapping in when no team is active. The team-scoped "workspace" content that
used to live here either moves to being one of several Home sections or is dropped in favor of the
cross-team framing; decide when this is scheduled.

Call sites to update: the redirect in `pages/index.vue`, the `Dashboard` entry in `personalItems` in
`AppSidebar.vue` (including the `hasActiveOrganization !== false` filter that currently hides it for
personal accounts — Home should now always be visible), `protectedRoutes` in `middleware/auth.global.ts`,
and any test selectors or fixtures referencing `/dashboard`.

## What's under Home

Three small, separate pages — not a mirror of the full team-scoped nav:

- **`/home`** — overview: recent activity, counts, entry points into the other two.
- **`/home/inbox`** — support conversations assigned to the user, or in inboxes they're a member of,
  across every team they belong to. Each row links to the real conversation page
  (`/support/conversations/[id]`) in its owning team — clicking through is a normal navigation, not a
  scope change.
- **`/home/feedback`** — feedback items the user authored, is watching, or is a team member on the
  product for, across every team. Links to the real feedback item.

Each gets its own small read endpoint (e.g. `GET /api/home/inbox`, `GET /api/home/feedback`) scoped to
`resolveHomeTeamScope(userId, organizationId)`. These are new, narrow endpoints — **not** the existing
`/api/support/conversations` or feedback list endpoints modified to accept a team set. Keeping them
separate is what keeps `/support` and `/feedback` untouched.

## Realtime — reuse `user:<id>`, no new fan-out

Because Home is read-only triage, not a live team inbox, it does not need per-inbox or per-team
subscriptions. `conversation_assigned` and `conversation_mention` notifications already exist from Stage
02 and already publish on `user:<id>`, which every client already subscribes to
(`NotificationBell.vue`'s pattern). Home's inbox and feedback pages refetch on the same signal. No change
to Stage 02's publish targets is needed — the earlier draft's `team:<id>` publish requirement is
withdrawn along with the picker-scope design it existed for.

## Known collisions with existing design

**`displayId` is per team.** `conversation` is unique on `(teamId, displayId)`, so `/home/inbox` will show
tickets numbered `#41` from more than one team. Show a team badge or team-qualified reference next to the
number.

**Contacts are per team.** `contact` is unique on `(teamId, email)` — out of scope here since Home does
not include a contacts page, but worth remembering if one is added later: the same person in three teams
is three unrelated rows, not one to be merged.

## Work sketch

1. **Picker cleanup** — delete the "Workspace" row, `switchToDefaultTeam`, and the `Default`-name filter
   in `additionalTeams`; the team list becomes a plain list of the user's teams.
2. **Access layer** — `resolveHomeTeamScope(userId, organizationId)` returning the set of teams the user
   belongs to in the active organization. An empty set is legitimate: render an empty Home, never fall
   back to the full organization.
3. **Route rename** — `/dashboard` → `/home` with a redirect, updating all call sites listed above; Home
   becomes unconditionally visible in the sidebar rather than gated on organization state.
4. **Home pages and endpoints** — `/home/inbox` and `/home/feedback` with their own narrow, cross-team
   read endpoints; each row links to its real, team-scoped page.
5. **Realtime** — wire Home's lists to refetch on the existing `user:<id>` notification signal.

## Acceptance criteria

1. `/dashboard` redirects to `/home`, and Home is visible in the sidebar regardless of which team is
   active or whether an organization exists.
2. A user belonging to two of an organization's four teams sees only those two teams' items on
   `/home/inbox` and `/home/feedback`. Verified by test, as cross-tenant isolation.
3. A user belonging to no team in the active organization sees an empty Home, not an error and not
   everything.
4. Clicking an item on `/home/inbox` or `/home/feedback` opens that item's real, team-scoped page; the
   team picker's selection is unaffected by browsing Home.
5. Two conversations with the same `displayId` in different teams are distinguishable on `/home/inbox`.
6. The team picker no longer contains a "Workspace" row, and its subtitle claims match what it actually
   shows.
7. `/support` and `/feedback` and their APIs are unchanged by this stage.
8. `yarn harness:verify` green on `support-platform`.

## TODO items

- [ ] Delete the "Workspace" row, `switchToDefaultTeam`, and the `Default`-name filter from `TeamSwitcher.vue`; the team list shows every team plainly
- [ ] Add `resolveHomeTeamScope(userId, organizationId)` returning the user's teams in the active organization; unit tests for partial membership, full membership, and no membership
- [ ] Rename `/dashboard` to `/home` with a redirect; update `pages/index.vue`, `AppSidebar.vue` (make Home unconditionally visible), `protectedRoutes`, and test selectors
- [ ] Add `GET /api/home/inbox` and `GET /api/home/feedback` as new, narrow cross-team read endpoints scoped via `resolveHomeTeamScope`; do not modify the existing team-scoped list endpoints
- [ ] Build `/home`, `/home/inbox`, and `/home/feedback` with team-qualified references and links out to real team-scoped pages
- [ ] Wire Home's lists to refetch on the existing `user:<id>` notification signal
- [ ] Add E2E coverage: a user in a subset of an organization's teams sees only those teams' items on Home; clicking through lands on the correct team-scoped page without changing the picker's selection

## Possible later extension

Per-team stat cards on the Home overview — volume, response times, SLA attainment per team, with
drill-through. This **would** depend on Stage 09's `supportMetricDaily` rollups; computing it live over
`conversationMessage` is the scaling mistake Stage 09 exists to prevent. Treat as a separate item.

## Risks

- **Re-coupling Home to the picker.** If a future change makes Home selectable in the picker again, the
  click-through ambiguity this draft removed comes back. Keep it a fixed nav destination.
- **Forking the existing endpoints instead of adding narrow new ones.** Modifying
  `/api/support/conversations` to accept a team set would silently reintroduce the coupling this draft
  avoids. Home gets its own endpoints.
- **Route rename breakage.** `/dashboard` is the post-login landing route and appears in tests, the
  sidebar, and the root redirect. Missing a call site strands users on a dead route immediately after
  login.
- **The existing "Workspace" entry looks finished.** Anyone glancing at `TeamSwitcher.vue` may assume a
  cross-team scope already exists. It does not — that row activates a team named `Default` and nothing
  else.
