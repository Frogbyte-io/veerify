# Veerify MCP server — design

Date: 2026-10-25 · Status: draft for approval

## Intent

Let an AI agent — first and foremost **Claude Code** on a user's machine — set up and run a Veerify workspace
on the user's behalf: create projects and products, set up the custom domain, configure statuses, categories,
appearance, modules, members and app keys, and above all **bring existing feedback into Veerify** from anywhere —
another feedback platform (Canny, Sleekplan, Featurebase…), a public roadmap page, GitHub issues, a Discord thread.

The agent does the gathering and reshaping itself, with its own tools (web fetch, `gh`, other MCP servers).
Veerify's job is to accept one well-defined **import format**, show what an import would do before doing it, and
apply it safely and repeatably.

## Goals

1. A hosted MCP server at `https://<veerify-host>/mcp` that Claude Code can add with `claude mcp add`.
2. Two ways to authenticate, both acting **as a person with exactly that person's permissions**:
   - **Log in** — OAuth browser flow (Claude Code's built-in MCP OAuth support).
   - **Personal API key** — for headless/CI use, passed as `Authorization: Bearer …`.
3. The agent can do **anything the user can do in the dashboard** (deletes included). No separate "agent
   permissions" — the user's role in each workspace/project is the limit.
4. An **import** capability: a documented JSON format covering feedback posts, their authors, voters and vote
   counts, comments, statuses, categories, roadmap placement and changelog entries; with dry-run, chunked upload,
   and re-runs that update instead of duplicating.
5. Imported **authors and voters are preserved**. A migrated post with 140 votes still shows 140 votes, and when
   someone later signs up with a matching email, their imported votes and posts become theirs.

## Non-goals (for now)

- **Organization-owned API keys** (keys that outlive their creator). Personal keys only; org keys later.
- **WebMCP** (`navigator.modelContext`, tools exposed by an open browser tab). It only serves agents running inside
  the browser; Claude Code can't use it. The tool layer is built so a WebMCP or in-app-assistant adapter can be
  added later as a thin wrapper (see _Tool registry_).
- **Veerify doing the scraping.** No server-side "import from URL" for arbitrary sites in v1; the agent fetches.
- A dashboard import wizard UI (the old one is being retired; see _Existing migration code_). Possible later.
- A general audit log of agent actions.

## Anti-goals (would be a failure even if it "works")

- An API key or OAuth token that can do **more** than its owner can, or that bypasses the existing access helpers
  (`requireProjectAccess`, `requireProjectAdmin`, `requireOrganizationAdmin`, …).
- An import that **emails** imported authors/voters (subscription confirmations, status-change notifications,
  "new comment" mails, in-app notifications to the team for every imported post).
- Imported people becoming **user accounts** they never signed up for.
- Re-running the same import **duplicating** posts, comments or votes.
- Importing into `support` contacts. Feedback and support contacts stay separate by design (hard constraint in
  `TODO.md` / support `design.md`: feedback gets no `contactId`).

## Decisions made with the user

| Topic              | Decision                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| Primary agent      | Claude Code (local CLI)                                                                          |
| Auth               | Both OAuth login and API key                                                                     |
| API key ownership  | Belongs to a person, carries their permissions, dies with their account. Org keys later.         |
| Agent powers       | "Do anything" the user could — including deletes                                                 |
| WebMCP             | Not now; only relevant for in-browser agents                                                     |
| Import sources     | Anything; the agent converts to Veerify's format                                                 |
| Authors & voters   | Keep them; import may set votes (individual voters and/or a bare count)                          |
| Old migration code | Check whether to merge or remove → see below (verdict: port the useful parts, delete the branch) |
| Re-import          | Ongoing sync; Veerify wins — fields edited in Veerify are never overwritten by the source        |

## Existing migration code

The Sleekplan/CSV importer exists only on the unmerged branch `sleekplan-export` (single commit `bb30ea5`,
2026-08-13). It is **645 commits behind main**, predates the teams → projects/products restructure, ships its own
migration `0019` (main is past `0055`), bundles an older changelog implementation that main has since replaced,
and stores votes only as a number.

**Verdict: do not merge.** Port into the new import feature:

- the canonical-snapshot idea (`server/services/imports/types.ts`) — the new import format grows out of it;
- the staged run lifecycle (`import_run` / `import_run_issue`, analyze → start → step → cancel) — reshaped for
  project + product scoping;
- the Sleekplan and CSV parsing logic and `tests/import-adapters.test.ts`, as **converters** that produce the
  new import format (kept server-side for a future dashboard wizard; not exposed as v1 MCP tools — an agent can
  parse a CSV itself).

Then delete `sleekplan-export` locally and on origin. (Never commit the real Sleekplan CSV exports that sat
next to that work — they contain live email addresses.)

## Architecture

```
Claude Code ──HTTP (Streamable HTTP, JSON-RPC)──▶ /mcp  (Nitro route, @modelcontextprotocol/sdk)
     │  Authorization: Bearer <personal key | OAuth access token>
     ▼
 Principal resolution (one place) ──▶ { user, organization?, project?, credential }
     ▼
 Tool registry ──▶ calls existing API routes in-process with the same principal
     ▼
 Existing access helpers + Drizzle  (unchanged authorization rules)
```

### Transport

- `@modelcontextprotocol/sdk`, Streamable HTTP transport, mounted at `/mcp` (server route outside `/api/`).
- **Stateless**: each request carries its credential; no server-held MCP session is required for correctness.
- Setup docs give the exact command, e.g.
  `claude mcp add --transport http veerify https://app.veerify.com/mcp --header "Authorization: Bearer vfy_usr_…"`
  and, for login, the same without the header (Claude Code discovers OAuth and opens the browser).

### Credentials

**Personal API keys** — _my call:_ a new table mirroring the existing app-key pattern (`server/utils/app-keys.ts`)
rather than adopting a Better-Auth API-key plugin (not present in the installed better-auth 1.5.0, and the app-key
pattern is already reviewed and in production):

- `user_api_key`: id, userId (FK, cascade), name, keyPrefix, keyHash (SHA-256, unique), lastUsedAt, expiresAt
  (optional), revokedAt, createdAt.
- Format `vfy_usr_<base64url 32 bytes>`; full key shown once. Distinct prefix from app keys (`vfy_pub_`), so the
  two can never be confused at the parser.
- Managed in **Settings → Security** (or a new "API keys" tab in user settings): list, create, revoke.

**OAuth login** — Better-Auth's MCP/OAuth support (`mcp` / `oidcProvider` plugins ship in 1.5.0; a newer
`oauth-provider` package may be the recommended path by build time — builder checks current Better-Auth docs and
picks; see _Left to the builder_). Requirements regardless of plugin:

- OAuth 2.1 + PKCE, dynamic client registration (Claude Code registers itself), protected-resource and
  authorization-server metadata under `/.well-known/…` as the MCP authorization spec requires.
- Consent screen in Veerify's `clean` layout: "Claude Code wants to act as you in Veerify".
- Users can see and revoke connected apps (same settings area as API keys).

**Credential self-protection** — _my call, the one exception to "do anything":_ a credential cannot manage
credentials or the account's security: no creating/revoking API keys or OAuth grants, no password / email / 2FA
changes, no account deletion. Everything else the user can do, the agent can do. Rationale: a leaked key must not
be able to mint more keys or lock the owner out.

### Principal resolution (the core change)

Today `requireAuth` (`server/utils/auth-middleware.ts`) is the single place a request becomes a user, but
organization/project context is resolved in three different ways (URL id/slug, `session.activeOrganizationId`
via `requireAuthWithOrganization`, `session.activeProjectId` via `requireAuthWithResolvedProject`), and the latter
two **write back to the session row by token**. Token callers have no session row.

Change: `requireAuth`/`optionalAuth` accept `Authorization: Bearer vfy_usr_…` or an OAuth access token in addition
to the cookie, and return the same shape for all three. For non-cookie principals:

- **Active organization / project** come from, in order: `X-Veerify-Organization` / `X-Veerify-Project` request
  headers (slug or id; membership/access verified) → the credential's stored context (set by the `set_context`
  tool) → the existing fallback (first membership / first accessible project).
- The session-repair write-backs are **skipped** for non-cookie principals (they store context on the credential
  instead).
- `projects/active.post` and `organizations/active.post` update the credential's stored context instead of a
  session row.

Credential context storage: `activeOrganizationId` / `activeProjectId` columns on `user_api_key`, and an equivalent
small table keyed by OAuth grant for login. _My call._

Better-Auth's own endpoints under `/api/auth/*` (org member role/removal, invitation cancel/accept) only work with
a cookie session. Where the dashboard uses those through the Better-Auth client, add thin Veerify server routes
that apply the same org-access checks so token principals can reach them (except the self-protection list above).

Rate limiting: per credential, on top of existing per-IP limits. `lastUsedAt` updated fire-and-forget, like app keys.

### Tool registry

One registry, transport-agnostic: each tool = `{ name, description, inputSchema (zod), handler(principal, input) }`.
The MCP server is one adapter over it; WebMCP or an in-app assistant can be another later.

Handlers call the **existing API routes in-process** (Nitro `event.$fetch`/`$fetch` with the principal forwarded),
so every authorization rule, validation and side effect stays in one place. Tools never query the database
directly except the import tools, which have their own service.

Two layers of tools:

**1. Universal access (guarantees "anything the user can do")**

| Tool                               | Purpose                                                                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `whoami`                           | User, credential type, current org/project context, roles                                                                              |
| `list_workspaces`, `list_projects` | Discover where the user can act                                                                                                        |
| `set_context`                      | Store active workspace/project on the credential                                                                                       |
| `search_api`                       | Search Veerify's OpenAPI spec by keyword/tag; returns operations with params and body schemas                                          |
| `call_api`                         | Make any `/api/**` request (method, path, query, body) as the user. Refuses `/api/auth/*`, `/api/cron/*`, and the self-protection list |

This depends on the OpenAPI spec covering every route. Today 84 of 295 route files have no `@openapi` block —
including all core feedback/comment routes, every `projects/*` route (CRUD, products, statuses, categories,
members, GitHub, settings), `orgs/[slug]` put/delete/members/invitations, `notifications/*`, `user/*`. **Completing
that coverage is part of this work**, plus a CI check (`harness-docs-check` or the scanner) that fails when a
non-cron, non-test route lacks `@openapi`.

**2. Curated setup tools (fast path for common jobs; typed, with good descriptions)**

- Projects & products: `create_project`, `update_project_settings` (appearance, modules, visibility, access mode),
  `create_product`, `update_product`, `delete_product`, `delete_project`
- Domain: `set_custom_domain` (returns the DNS records to create), `verify_custom_domain`
- Taxonomy: `list/create/update/delete_status`, `list/create/update/delete_category`
- People: `invite_member`, `list_members`, `set_project_member`
- App keys: `create_app_key`, `list_app_keys`, `revoke_app_key`
- Content: `list_feedback`, `get_feedback`, `update_feedback_status`, `create_changelog_entry`, `publish_changelog_entry`
- Import: see below

Curated tools are thin wrappers over the same routes. Anything not curated is still reachable via `call_api`.

Domain note: Veerify can only do its side (store domain, report required records, verify). Creating DNS records
happens with whatever DNS tool the agent has (e.g. a Cloudflare MCP).

## Import

### Format (v1)

One JSON document per import, versioned (`"format": "veerify-import/1"`). Every record carries an `externalId`
unique within its `source`. Top level:

```jsonc
{
  "format": "veerify-import/1",
  "source": "canny",                 // free-text source key: canny | github | discord | sleekplan | <anything>
  "sourceLabel": "Canny",            // shown as the "Added from …" badge
  "target": { "project": "dotmatrixlabs", "product": "decker" },   // slugs or ids
  "statuses":   [{ "externalId", "name", "color?", "mapTo?" }],    // mapTo = existing Veerify status value
  "categories": [{ "externalId", "name", "color?", "mapTo?" }],
  "people":     [{ "externalId", "name?", "email?", "avatarUrl?" }],
  "feedback": [{
    "externalId", "title", "body?", "url?",            // url = link back to the original
    "status?", "category?",                              // externalIds from above, or existing Veerify values
    "authorExternalId?",
    "createdAt?", "updatedAt?",
    "votes?": [{ "personExternalId", "type?": "upvote|downvote", "createdAt?" }],
    "voteCount?": 140,                                   // used when individual voters aren't known
    "isPinned?", "isLocked?", "isHidden?",
    "metadata?": {}
  }],
  "comments": [{ "externalId", "feedbackExternalId", "parentExternalId?", "body", "authorExternalId?",
                 "isInternal?", "createdAt?" }],
  "changelog": [{ "externalId", "title", "body", "labels?", "publishedAt?", "status?": "draft|published",
                  "feedbackExternalIds?": [], "products?": [] }]
}
```

- **Roadmap** in Veerify is feedback grouped by status, so roadmap items are feedback with a status — no separate
  section.
- **Votes**: if `votes` is given, real vote rows are created and the count follows them. If only `voteCount` is
  given, it becomes an **imported baseline**. If both, the baseline is `max(0, voteCount − votes.length)`.
  _My call:_ the baseline is stored in its own column (`feedback.importedVoteBaseline`), and `feedback.voteCount`
  stays the displayed counter that live votes increment. A re-import changes `voteCount` by the _difference_
  between the old and new baseline, so live votes are never lost or double-counted (140 imported + 5 live = 145;
  re-import with 150 → 155).
- **Timestamps** from the source are kept (feedback/comment timestamps are insertable today).
- A JSON Schema for the format is published (served by the MCP server as a resource and at `/api/imports/schema`)
  so agents can validate before sending.

### Imported people

A new feedback-side table (`imported_person`: projectId, source, externalId, name, email, avatarUrl; unique on
(projectId, source, externalId)) — **not** the support `contact` table.

- Posts/comments by imported people keep `authorName`/`authorEmail` as today, plus a reference to the imported person.
- Votes: `vote` gains a nullable `importedPersonId` with a unique (feedbackId, importedPersonId) index, alongside
  the existing user/anonymous-session voter columns.
- **Claiming** (_my call_): when a user **verifies** an email that matches imported people, their imported posts,
  comments and votes are re-pointed to the user (skipping a vote if the user already voted on that post).
  Triggered from Better-Auth's after-email-verification hook — **not** from `auth/merge-anonymous`, which runs at
  login/signup before verification and would let anyone claim an email they don't own. Social logins count only
  when the provider asserts a verified email.
- An import **never writes `authorUserId` / `voterUserId` directly**, even when an imported email matches an
  existing Veerify user. Otherwise a project admin could make content appear to come from any user by typing their
  email. Existing users are not auto-claimed in v1; imported activity stays under the imported person.
- Imported people are never emailed and never become users unless they sign up themselves.

### Idempotency

Re-import is an **ongoing sync, and Veerify wins** (decided with the user). An agent may re-run an import from the
same source over and over (e.g. weekly from GitHub issues or a Discord channel):

- `feedback`, `feedback_comment` and `changelog_entry` gain `externalSource` + `externalId`, unique per project.
  A record seen again is matched, never duplicated.
- New posts, comments, votes and people from the source are added on every run.
- Each imported record keeps a snapshot of the field values it was last imported with (`importSnapshot` jsonb:
  title, body, status, category, pin/lock/hidden, changelog fields). On re-import, a field is updated from the
  source **only if its current Veerify value still equals the snapshot**, meaning nobody changed it in Veerify.
  A field the team edited (status moved to "In progress", title fixed) is never overwritten. The snapshot is then
  refreshed for the fields that were applied.
- Vote baselines follow the rule under _Format → Votes_; individual votes are added, never removed.
- Re-import never deletes anything that has disappeared from the source.
- `onExisting` on the run: `sync` (default, the rules above) or `skip` (only create records not seen before).
  `import_preview` reports, per field, what would update and what is kept because it was edited in Veerify.

### Flow and tools

Imports can be large, and MCP tool arguments shouldn't carry megabytes, so runs are chunked:

| Tool                 | What it does                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `import_get_format`  | Returns the JSON Schema + a short example                                                                    |
| `import_create_run`  | Target project/product, source, `onExisting` (see _Idempotency_) → `runId`                                   |
| `import_add_records` | Append a batch (any sections) to the run; validates each record, reports issues per record                   |
| `import_preview`     | Dry-run: counts to create/update/skip, status/category mapping, unknown references, warnings. Writes nothing |
| `import_commit`      | Applies the run                                                                                              |
| `import_status`      | Progress, issues, and per-record outcomes                                                                    |
| `import_cancel`      | Cancels a not-yet-finished run                                                                               |

- Records staged in the run (DB, jsonb per batch) until commit; `import_run` / `import_run_issue` tables ported
  from the old branch and re-scoped to project + product.
- Small runs commit inline; large ones are advanced by a per-minute scheduled task within a time budget, the same
  status-row state machine pattern `seo_audit` uses (`server/services/marketing/audit/runner`).
  Threshold left to the builder.
- Same endpoints exist as REST under `/api/projects/[slug]/imports/*`, so the MCP tools stay thin and a dashboard
  wizard can reuse them later.
- Requires **project admin** on the target project.
- **Side-effect suppression** during commit: no subscription emails, no status-change or comment notifications,
  no in-app notifications, no realtime fan-out per record (one "import finished" event at the end is fine), no
  GitHub sync.

## Security summary

- Every credential resolves to a user; every tool goes through existing route guards.
- Keys hashed (SHA-256), shown once, revocable, `lastUsedAt` tracked; OAuth via PKCE + consent + revocation.
- Credential self-protection list (above).
- `call_api` blocks `/api/auth/*` and `/api/cron/*`.
- Per-credential rate limits.
- Imported email addresses are personal data: covered by the existing workspace data-erasure flow
  (`workspace/erase-contact.post` must also erase matching `imported_person` rows and their author fields).

## Phasing (_my call_ — import is the user's main interest, so it comes right after the foundation)

1. **Foundation**: personal API keys + settings UI, principal resolution across all guards, `/mcp` endpoint, the
   universal tools (`whoami`, `list_*`, `set_context`, `search_api`, `call_api`), OpenAPI coverage completed +
   CI check, setup docs. Usable end-to-end with an API key.
2. **Import**: schema changes, import service and REST, import MCP tools, claiming on signup, port Sleekplan/CSV
   converters and tests, delete `sleekplan-export`.
3. **OAuth login**: Better-Auth OAuth provider, discovery metadata, consent screen, connected-apps management.
4. **Curated setup tools** and a short agent guide (MCP `instructions` string + a docs page with recipes:
   "migrate from Canny", "turn GitHub issues into feedback", "set up a custom domain with Cloudflare").

## Left to the builder

- Which Better-Auth OAuth plugin (`mcp`, `oidcProvider`, or a newer `oauth-provider` package — upgrading
  better-auth is acceptable if it's the recommended path), checked against current docs.
- How in-process route calls carry the principal (forwarded header vs. an internal context object).
- Exact batch size limits, inline-vs-background threshold, staging storage shape.
- Thin server routes needed to replace Better-Auth client-only org operations.
- Naming of tools and REST paths beyond those listed; tool descriptions.
- Test strategy, following existing patterns (vitest unit, guarded Postgres integration, Playwright).
- Follow project rules in `.agents/CLAUDE.md`: Options API, `createError`, migrations via `yarn db:generate`,
  `.env.example` for any new variable, update `.agents/CLAUDE.md` endpoint/auth tables and `.cursor` rules.
