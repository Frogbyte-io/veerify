# Veerify MCP — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user creates a personal API key in Settings, adds Veerify to Claude Code with
`claude mcp add --transport http veerify <host>/mcp --header "Authorization: Bearer vfy_usr_…"`, and the agent can
do anything that user can do through `whoami`, `list_workspaces`, `list_projects`, `set_context`, `search_api` and
`call_api`.

**Architecture:** Personal keys (`vfy_usr_…`, SHA-256 hashed, mirroring `server/utils/app-keys.ts`) become a second
way `requireAuth` resolves a user. A key principal looks like a normal `AuthSession` plus a `credential` marker; its
active workspace/project is stored on the key row instead of a session row. `/mcp` is a stateless Streamable HTTP
MCP endpoint whose tools call the existing `/api/**` routes in-process with the caller's `Authorization` header, so
every existing guard applies unchanged. `search_api` reads the generated OpenAPI spec, which this phase completes.

**Tech Stack:** Nuxt 3 / Nitro / h3, Drizzle + PostgreSQL, Better-Auth 1.5, zod 4, `@modelcontextprotocol/sdk`
(new), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-25-veerify-mcp-design.md` (Phase 1 of 4. Phases 2 to 4, which cover import,
OAuth login and curated tools plus Better-Auth-only org operations, get their own plans.)

## Global Constraints

- Project rules in `.agents/CLAUDE.md` apply: Options API only, `createError()` for all errors, `import.meta.client`,
  `<Icon name="lucide:*" />`, Skeleton loaders and error states with retry, migrations only via `yarn db:generate`.
- Personal key format: `vfy_usr_` + `randomBytes(32).toString('base64url')`; `keyPrefix` = first 12 chars; only the
  SHA-256 hex hash is stored; the full key is returned once.
- A credential principal acts as its user with exactly that user's permissions. It never gets more than the user.
- Self-protection: a credential principal cannot list, create or revoke personal keys, change the account email,
  start a public-auth handoff, or reach `/api/auth/*`. These return **403** for credential principals.
- A bearer header that starts with `vfy_usr_` but is invalid, revoked or expired → **401**, with no fallback to a cookie.
- `call_api` refuses paths under `/api/auth/`, `/api/cron/`, `/api/public/auth/`, `/api/user/api-keys`, `/api/test`,
  and anything not under `/api/`.
- `/mcp` accepts **only** credential principals (bearer). Cookie sessions get 401 there.
- Per-key rate limit: 600 requests / 60 s, `identifier: 'user-api-key'`, `subject: <keyId>`.
- Max 25 active (non-revoked, non-expired) personal keys per user.
- Every response uses the existing envelope helpers in `server/utils/response.ts`.

## Review Focus

1. **Bearer and cookie both present.** The bearer key wins. A bad bearer key → 401, even when the cookie is valid. (Task 3)
2. **Key revoked or expired while an agent is mid-run.** The very next request → 401. Principals aren't cached. (Task 2)
3. **`X-Veerify-Organization` / `X-Veerify-Project` naming something the user can't open.** → 403. It doesn't silently
   fall back to another workspace, because silent fallback means the agent edits the wrong workspace. (Task 2)
4. **`call_api` path tricks.** `/api/../api/auth/x`, `/api/%2e%2e/auth/x`, `/API/Auth/x`, `/api//auth/x`, `/api/auth`
   (no trailing slash) and `https://evil/x` are all refused. (Task 10)
5. **Stored context goes stale.** If the project behind a key's stored context is deleted, or the user's access is
   revoked, the next request falls back to the first accessible project and repairs the **key row**, not a session
   row. (Task 4)

---

## File Structure

| Path | Responsibility |
|---|---|
| `server/database/schema/credentials.ts` (new) | `userApiKey` table |
| `server/utils/user-api-keys.ts` (new) | Key generation, hashing, bearer parsing, principal resolution |
| `server/utils/auth-middleware.ts` | `requireAuth` / `optionalAuth` accept key principals; `requireInteractiveSession` |
| `server/utils/project-context.ts` | Context reads and writes go to the session row **or** the key row |
| `server/api/user/api-keys/*` (new) | List, create and revoke personal keys (cookie session only) |
| `components/settings/SettingsApiKeys.vue` (new) | Settings tab |
| `scripts/openapi-scanner.ts` | `findUndocumentedRoutes()` plus a `--check` flag |
| `server/mcp/*` (new) | Tool registry, API bridge, tools, MCP server factory |
| `server/routes/mcp.ts` (new) | HTTP endpoint |
| `docs/mcp.md` (new) | Setup and recipes |

---

### Task 1: `user_api_key` table

**Files:**
- Create: `server/database/schema/credentials.ts`
- Modify: `server/database/schema/index.ts` (add `export * from './credentials'`)
- Generated: `server/database/migrations/0061_*.sql` + meta

**Interfaces:**
- Produces: `userApiKey` Drizzle table, type `UserApiKeyRow = typeof userApiKey.$inferSelect`.

Columns: `id` text PK; `userId` text not null → `user.id` on delete cascade; `name` text not null; `keyPrefix` text
not null; `keyHash` text not null; `activeOrganizationId` text null; `activeProjectId` text null; `createdAt`
timestamp not null (`$defaultFn(() => new Date())`); `lastUsedAt`, `expiresAt`, `revokedAt` timestamps nullable.
Indexes: unique `user_api_key_hash_idx` on `keyHash`, `user_api_key_user_idx` on `userId`. Add a comment in the
style of `projectApiKey` saying only the hash is stored.

- [ ] **Step 1:** Write the table.
- [ ] **Step 2:** Run `yarn db:generate`. Expected: one new migration that creates `user_api_key` with both indexes and
  the FK, and nothing else. Review the SQL.
- [ ] **Step 3:** Run `yarn db:migrate` against the dev database. Expected: it applies cleanly.
- [ ] **Step 4:** Commit: `feat(db): add user_api_key table for personal API keys`.

---

### Task 2: Personal key utilities and principal resolution

**Files:**
- Create: `server/utils/user-api-keys.ts`
- Modify: `server/utils/auth-middleware.ts` (type only: add `credential` to `AuthSession`)
- Test: `tests/user-api-keys.test.ts`

**Interfaces:**
- Consumes: `userApiKey` (Task 1); `getOrganizationRole`, `getProjectById`, `resolveProjectRole` from
  `server/utils/project-access.ts`; `requireRateLimit` from `server/utils/rate-limit.ts`.
- Produces:
  - `AuthSession.credential?: { kind: 'user_api_key'; id: string }` (in `auth-middleware.ts`)
  - `USER_KEY_PREFIX = 'vfy_usr_'`
  - `hashUserApiKey(key: string): string`
  - `generateUserApiKey(): { key: string; keyPrefix: string; keyHash: string }`
  - `readBearerUserApiKey(event: H3Event): string | null`. Returns the token only when it starts with `vfy_usr_`
    (same parsing as `readBearerAppKey`).
  - `resolveUserApiKeyPrincipal(event: H3Event): Promise<AuthSession | null>`. Returns null when there is no
    `vfy_usr_` bearer. Throws 401 when the key is unknown, revoked or expired, or its user is gone. Throws 403 when a context
    header names an org or project the user can't open. Otherwise it applies the per-key rate limit, updates
    `lastUsedAt` fire-and-forget, and returns:
    `{ user: <user row fields>, session: { id: 'apikey:'+row.id, userId, token: '', expiresAt: row.expiresAt ?? new Date(8.64e15), activeOrganizationId, activeProjectId }, credential: { kind: 'user_api_key', id: row.id } }`.
  - Context headers are applied in that function. `X-Veerify-Organization` takes an org id or slug and requires
    membership. `X-Veerify-Project` takes a project id, or a slug resolved inside the effective org, and requires
    `resolveProjectRole`. A project header also sets `activeOrganizationId` to that project's org. Headers override
    the stored columns for this request only and aren't persisted.

- [ ] **Step 1: Write failing tests** in `tests/user-api-keys.test.ts`. Mock db and access helpers the way
  `tests/app-keys.test.ts` / `tests/app-key-routes.test.ts` do.
  - `generateUserApiKey` → `key` matches `/^vfy_usr_[A-Za-z0-9_-]{43}$/`, `keyPrefix === key.slice(0, 12)`,
    `keyHash === hashUserApiKey(key)`, and the hash is 64 hex chars.
  - `readBearerUserApiKey` returns null for `Bearer vfy_pub_x`, for no header and for `Basic x`. It returns the token for
    `bearer  vfy_usr_abc ` (case-insensitive, trimmed).
  - `resolveUserApiKeyPrincipal`:
    - It returns null without a bearer.
    - It throws `{ statusCode: 401 }` for an unknown hash, for `revokedAt` set, and for `expiresAt` in the past.
    - It returns `credential.id === row.id` and `session.activeProjectId === row.activeProjectId` for a valid key.
    - **Review Focus 2:** two sequential calls where the row is revoked between them → the second throws 401.
    - **Review Focus 3:** `X-Veerify-Organization: other-org` where `getOrganizationRole` returns null → throws 403.
      `X-Veerify-Project: p2` where `resolveProjectRole` returns null → throws 403.
    - A project header sets `session.activeOrganizationId` to the project's `organizationId`.
- [ ] **Step 2:** Run `yarn vitest run tests/user-api-keys.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `server/utils/user-api-keys.ts` and the `credential` field on `AuthSession`. Load the user
  row with an inner join on `user` by `userId`.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(auth): personal API key principal resolution`.

---

### Task 3: `requireAuth` accepts personal keys; interactive-only guard

**Files:**
- Modify: `server/utils/auth-middleware.ts`
- Modify: `server/api/user/profile.put.ts`, `server/api/user/submissions.get.ts` (switch to `requireAuth`)
- Modify: `server/api/public/auth/handoff/start.get.ts` (use `requireInteractiveSession`)
- Test: `tests/auth-middleware-credentials.test.ts`

**Interfaces:**
- Consumes: `resolveUserApiKeyPrincipal`, `readBearerUserApiKey` (Task 2).
- Produces:
  - `requireAuth(event)`: tries the key principal first. If one resolves, it is returned and the cookie is never
    consulted. Otherwise it falls back to the existing `auth.api.getSession` path.
  - `optionalAuth(event)`: a valid key returns its principal. A **present but invalid** `vfy_usr_` key still throws 401
    (it doesn't fall through to anonymous). No bearer means the existing behaviour.
  - `requireInteractiveSession(event): Promise<AuthSession>`. Calls `requireAuth` and throws 403 (`ErrorCode.FORBIDDEN`,
    message `'This action requires signing in to Veerify directly'`) when `session.credential` is set.
  - `isCredentialPrincipal(session: AuthSession): boolean`.

- [ ] **Step 1: Write failing tests.**
  - **Review Focus 1:** a valid key plus a valid cookie → the returned principal has `credential`, and `getSession` is not called.
    An invalid key plus a valid cookie → 401.
  - `optionalAuth` with an invalid `vfy_usr_` key → throws 401. With `vfy_pub_` → follows the cookie path.
  - `requireInteractiveSession` with a key principal → 403. With a cookie session → returns the session.
  - `profile.put`: a key principal changing `email` to a different value → 403. The same principal changing only `name`
    → 200.
- [ ] **Step 2:** Run `yarn vitest run tests/auth-middleware-credentials.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. In `profile.put.ts` keep the current behaviour but take the session from `requireAuth` and
  reject email changes for credential principals. In `submissions.get.ts` replace the inline `getSession` with
  `requireAuth`.
- [ ] **Step 4:** Run the new test plus `yarn test`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(auth): accept personal API keys in requireAuth`.

---

### Task 4: Active context is stored per credential

**Files:**
- Modify: `server/utils/project-context.ts`
- Modify: `server/api/projects/active.post.ts`, `server/api/organizations/active.post.ts`, `server/api/orgs/index.post.ts`
- Test: `tests/project-context-credentials.test.ts`

**Interfaces:**
- Consumes: `AuthSession.credential` (Task 2), `userApiKey` (Task 1).
- Produces:
  - `type ContextTarget = { kind: 'session'; token: string } | { kind: 'user_api_key'; id: string }`
  - `contextTargetFor(session: AuthSession): ContextTarget`
  - `writeContext(target: ContextTarget, organizationId: string | null, projectId: string | null, tx?)`. Updates
    `session` by token or `userApiKey` by id. Replaces `writeSessionContext` and the inline update in
    `requireAuthWithOrganization`.
  - `setActiveProjectForSession({ target, userId, projectId })` and
    `setActiveOrganizationForSession({ target, userId, organizationId, preferredProjectId })`. The `sessionToken`
    parameter is replaced by `target: ContextTarget`. Callers pass `contextTargetFor(session)`.
  - `orgs/index.post.ts` calls `writeContext(contextTargetFor(session), organizationId, null, tx)` inside its
    transaction.

- [ ] **Step 1: Write failing tests.**
  - `setActiveProjectForSession` with a key target updates `user_api_key` (`activeOrganizationId`,
    `activeProjectId`) and never `session`.
  - **Review Focus 5:** `resolveActiveProjectForSession` for a key principal whose stored project no longer resolves
    returns the first accessible project and writes it to the **key row**.
  - `requireAuthWithOrganization` for a key principal with no stored org repairs the key row.
  - With a cookie session, the same calls still update `session` by token (regression).
- [ ] **Step 2:** Run `yarn vitest run tests/project-context-credentials.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement and update the three callers.
- [ ] **Step 4:** Run the test plus `yarn test`. Expected: all pass. `yarn typecheck` passes.
- [ ] **Step 5:** Commit: `feat(auth): store active workspace and project per API key`.

---

### Task 5: Personal key REST endpoints

**Files:**
- Create: `server/api/user/api-keys/index.get.ts`, `server/api/user/api-keys/index.post.ts`,
  `server/api/user/api-keys/[keyId].delete.ts`, each with an `@openapi` block (tag `User`)
- Modify: `server/api/openapi.json.get.ts`. Add security scheme `userApiKeyAuth`
  (`{ type: 'http', scheme: 'bearer', description: 'Personal API key (vfy_usr_...) created in Settings → API keys' }`)
  and tags `User` and `MCP`.
- Test: `tests/user-api-key-routes.test.ts` (same mocking style as `tests/app-key-routes.test.ts`)

**Interfaces:**
- Consumes: `requireInteractiveSession` (Task 3), `generateUserApiKey` (Task 2).
- Produces:
  - `GET /api/user/api-keys` → `{ success, data: Array<{ id, name, keyPrefix, createdAt, lastUsedAt, expiresAt, revokedAt }> }`,
    the caller's own keys, newest first. Never includes `keyHash`.
  - `POST /api/user/api-keys` body `{ name: string (trim, 1–60), expiresInDays?: integer 1–365 | null }` → 201
    `{ data: { …same fields, key } }`. 409 `CONFLICT` when the user already has 25 active keys.
  - `DELETE /api/user/api-keys/:keyId` → sets `revokedAt`. 404 when the key isn't the caller's or is already revoked.

- [ ] **Step 1: Write failing tests.**
  - The create response contains `key` starting with `vfy_usr_`, and the inserted row has `keyHash` but no `key`.
  - The list never contains `keyHash` or `key`.
  - Creating a 26th active key → 409.
  - Revoking another user's key → 404.
  - All three routes reject a key principal with 403 (self-protection).
- [ ] **Step 2:** Run `yarn vitest run tests/user-api-key-routes.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the test, then `yarn openapi:generate`. Expected: tests PASS and the generator includes the 3 new operations.
- [ ] **Step 5:** Commit: `feat(api): personal API key endpoints`.

---

### Task 6: Settings → API keys tab

**Files:**
- Create: `components/settings/SettingsApiKeys.vue`
- Modify: `pages/settings/index.vue`. Add tab `{ key: 'api-keys', label: 'API keys', icon: 'lucide:key-round' }`
  after Security, plus the component map entry and the import.
- Test: `tests/e2e/user-api-keys.spec.ts`

**Interfaces:**
- Consumes: the Task 5 endpoints.

Behaviour (Options API):
- Loading → Skeleton rows. Error → message plus Retry. Empty → "No API keys yet".
- The list shows name, `keyPrefix…`, created, last used ("Never"), expiry, and a Revoke button with a confirm dialog.
- The Create dialog has a name field and an expiry select (Never / 30 / 90 / 365 days). On success it shows the full key
  once, with a copy button and the text "Copy this key now. You won't be able to see it again." It also shows a
  ready-to-copy line: `claude mcp add --transport http veerify {origin}/mcp --header "Authorization: Bearer {key}"`.
- A short help line explains that a key acts as you, with your permissions.

- [ ] **Step 1: Write the failing e2e test.** Sign in as the seeded user, open `/settings#api-keys`, create a key named
  `CLI`, and assert:
  - the dialog shows text starting with `vfy_usr_` and the `claude mcp add` line;
  - after closing it, the list shows `CLI` with `vfy_usr_` and a 4-char prefix and no full key;
  - Revoke → confirm → the row shows Revoked.
  Then use the copied key in a `request.get('/api/projects', { headers: { Authorization: 'Bearer …' } })` call. It
  returns 200 before revoking and 401 after.
- [ ] **Step 2:** Run `yarn test:e2e:worktree tests/e2e/user-api-keys.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the component and the tab.
- [ ] **Step 4:** Run the spec. Expected: PASS. `yarn lint` and `yarn typecheck` are clean.
- [ ] **Step 5:** Commit: `feat(ui): personal API keys settings tab`.

---

### Task 7: OpenAPI coverage checker

**Files:**
- Modify: `scripts/openapi-scanner.ts`
- Modify: `tests/openapi-scanner.test.ts`
- Modify: `package.json`. Add script `"openapi:check": "tsx scripts/openapi-scanner.ts --check"`.

**Interfaces:**
- Produces:
  - `OPENAPI_EXEMPT_PREFIXES = ['auth/', 'cron/', 'public/auth/', 'uploads/']` and
    `OPENAPI_EXEMPT_FILES = ['openapi.json.get.ts', 'test.ts']`, as paths relative to `server/api`, with forward slashes.
  - `findUndocumentedRoutes(routeDir?: string): Promise<string[]>`. Returns the sorted relative paths of non-exempt
    route files without `@openapi`.
  - With `--check`, the CLI prints each undocumented file and sets `process.exitCode = 1` if there are any.

- [ ] **Step 1: Write failing tests** against a temp dir fixture (the existing test file already uses `mkdtemp`). It has
  documented and undocumented files plus exempt `cron/x.get.ts` and `auth/[...all].ts`. The result lists only the
  undocumented non-exempt files, with forward slashes, sorted.
- [ ] **Step 2:** Run `yarn vitest run tests/openapi-scanner.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the test. Expected: PASS. Run `yarn openapi:check`. Expected: exit code 1 listing **68** files.
  This is the backlog Tasks 8 and 9 clear.
- [ ] **Step 5:** Commit: `feat(openapi): coverage checker for undocumented routes`.

---

### Task 8: Document feedback routes (20 files)

**Files:** every file `yarn openapi:check` lists under `server/api/feedback/`.

Each block follows the style of `server/api/projects/[slug]/api-keys/index.post.ts`:
- tag `Feedback`, `summary`, a unique camelCase `operationId`, path and query parameters;
- a `requestBody` schema that matches the route's zod schema field for field (names, types, enums, min/max,
  required);
- the response codes the handler actually throws.

Routes with optional auth say so in `description`. Routes without zod (`vote.post.ts`) are documented from their
`safeParse` schema.

- [ ] **Step 1:** Add the blocks.
- [ ] **Step 2:** Run `yarn openapi:generate && yarn vitest run tests/openapi-scanner.test.ts`. Expected: the generator
  succeeds with no "Conflicting OpenAPI operation" error, and the tests pass.
- [ ] **Step 3:** Run `yarn openapi:check`. Expected: no `feedback/` files listed (48 left).
- [ ] **Step 4:** Commit: `docs(openapi): document feedback and comment routes`.

---

### Task 9: Document remaining routes and enforce in CI

**Files:**
- every remaining file `yarn openapi:check` lists (`projects/**`, `orgs/**`, `organizations/**`, `notifications/**`,
  `user/**`, `dashboard/**`, `system/**`), using tags `Projects`, `Organizations`, `Notifications`, `User`, `System`;
- `.github/workflows/ci.yml`: add `- run: yarn openapi:check` to the job that runs `yarn harness:docs`.

The same rules as Task 8 apply. For `projects/[slug].put.ts`, document the `settings` object, including the module
flags from `lib/modules.ts`, since `.passthrough()` accepts them. For `organizations/invite.post.ts`,
`organizations/active.post.ts` and `projects/active.post.ts`, note in `description` that with an API key the active
context is stored on the key.

- [ ] **Step 1:** Add the blocks.
- [ ] **Step 2:** Run `yarn openapi:check`. Expected: exit 0, "0 undocumented routes".
- [ ] **Step 3:** Run `yarn openapi:generate && yarn test`. Expected: all pass.
- [ ] **Step 4:** Commit: `docs(openapi): document all dashboard routes; enforce coverage in CI`.

---

### Task 10: MCP core (registry, API bridge, universal tools)

**Files:**
- Modify: `package.json`. Add `@modelcontextprotocol/sdk` (latest 1.x). Confirm it works with zod 4 (the SDK accepts
  zod v4 schemas from 1.23 on). If the installed version needs v3, import from `zod/v3`.
- Create: `server/mcp/types.ts`, `server/mcp/api-bridge.ts`, `server/mcp/api-search.ts`,
  `server/mcp/tools/universal.ts`, `server/mcp/server.ts`
- Test: `tests/mcp-api-bridge.test.ts`, `tests/mcp-api-search.test.ts`, `tests/mcp-server.test.ts`

**Interfaces:**
- Consumes: `openapiPaths` from `server/generated/openapi-routes.ts`; the Task 5 and 9 routes.
- Produces:
  - `types.ts`:
    ```ts
    export interface ApiResult { status: number; body: unknown }
    export type ApiCaller = (req: { method: HttpMethod; path: string; query?: Record<string, unknown>; body?: unknown }) => Promise<ApiResult>
    export interface McpToolContext { principal: AuthSession; callApi: ApiCaller }
    export interface VeerifyTool<S extends z.ZodRawShape> { name: string; title: string; description: string; inputSchema: S; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }; handler(ctx: McpToolContext, input: z.infer<z.ZodObject<S>>): Promise<unknown> }
    ```
    `HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'`.
  - `api-bridge.ts`:
    - `normalizeApiPath(path: string): string | null`. Rejects absolute URLs, decodes percent-encoding once, resolves
      `.`/`..`, collapses `//`, lowercases for the check only, and returns the normalized path or null if it ends up
      outside `/api/`.
    - `isBlockedApiPath(normalized: string): boolean`. True when the path equals or starts with any blocked prefix
      (Global Constraints), compared case-insensitively.
    - `createApiCaller(authorization: string, contextHeaders: Record<string, string>): ApiCaller`. Uses Nitro's global
      `$fetch.raw(path, { method, query, body, headers: { authorization, ...contextHeaders }, ignoreResponseError: true })`,
      so the request runs in-process through the normal route stack. Returns `{ status, body: response._data }`.
      Forwards only `authorization` and `x-veerify-*`, never cookies.
  - `api-search.ts`:
    - `searchApi(query: string, opts?: { tag?: string; limit?: number }): ApiOperationSummary[]`. Default limit 10, max 25.
    - `getApiOperation(operationId: string): ApiOperationDetail | null`.
    - `ApiOperationSummary = { operationId, method, path, summary, tags }`. `ApiOperationDetail` adds `description`,
      `parameters`, `requestBody`, `responses`.
    - Ranking: case-insensitive token match, weighted operationId/path ×3, summary ×2, tags/description ×1. Ties are
      broken by path. Operations under blocked paths are excluded.
  - `tools/universal.ts` exports `universalTools: VeerifyTool[]`:

    | name | input | behaviour |
    |---|---|---|
    | `whoami` | none | `{ user: {id,name,email}, credential: 'api_key', activeOrganizationId, activeProjectId }` + GET `/api/projects/active` data |
    | `list_workspaces` | none | GET `/api/organizations/list` |
    | `list_projects` | `workspace?: string` | GET `/api/projects` (with `X-Veerify-Organization` when given) |
    | `set_context` | `workspace?: string; project?: string` (at least one) | POST `/api/organizations/active` and/or `/api/projects/active`; returns the new `whoami` |
    | `search_api` | `query?: string; tag?: string; operationId?: string; limit?: number` | `getApiOperation` when `operationId`, else `searchApi` |
    | `call_api` | `method: HttpMethod; path: string; query?: object; body?: unknown` | `normalizeApiPath` → reject null/blocked with a tool error naming the rule → `callApi` → `{ status, body }`; tool error when status ≥ 400 |

    `call_api` is annotated `destructiveHint: true`. The listing tools and `search_api` are `readOnlyHint: true`.
  - `server.ts`: `createVeerifyMcpServer(ctx: McpToolContext): McpServer` registers every tool in `universalTools` and
    sets the server `instructions` string. That string explains:
    - start with `whoami`;
    - pick a workspace and project with `set_context`;
    - find operations with `search_api`, then run them with `call_api`;
    - everything acts as the key's owner;
    - errors come back as `{ status, body }`.
    Tool results are returned as a single JSON text content block. `isError` is set for tool errors.

- [ ] **Step 1: Write failing tests.**
  - `tests/mcp-api-bridge.test.ts` **(Review Focus 4)**. `normalizeApiPath` + `isBlockedApiPath`:
    - refused: `/api/../api/auth/x`, `/api/%2e%2e/auth/x`, `/API/Auth/x`, `/api//auth/x`, `/api/auth`,
      `/api/cron/sla`, `/api/public/auth/session`, `/api/user/api-keys`, `/api/user/api-keys/1`, `/api/test`,
      `https://evil/x`, `/mcp`, `relative/path`;
    - allowed: `/api/projects`, `/api/projects/acme/statuses`, `/api/user/profile`, `/api/feedback?x=1`.
    - `createApiCaller` passes only `authorization` and `x-veerify-*` headers, and returns `{status, body}` for a 404
      without throwing.
  - `tests/mcp-api-search.test.ts` (mock `openapiPaths` with three operations):
    - `searchApi('status')` ranks the operation with `status` in its operationId first;
    - `getApiOperation` returns its `requestBody`;
    - an unknown id gives null;
    - a blocked-path operation never appears.
  - `tests/mcp-server.test.ts`. Connect `createVeerifyMcpServer` to an SDK `Client` over `InMemoryTransport`, with a
    stub `callApi`:
    - `listTools` returns exactly the six names;
    - `call_api` with `/api/auth/sign-out` returns `isError` and the stub isn't called;
    - `call_api` GET `/api/projects` returns the stub body;
    - a stub status of 403 → `isError`;
    - `set_context` with neither field → an input validation error.
- [ ] **Step 2:** Run `yarn vitest run tests/mcp-*.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Add the dependency and implement.
- [ ] **Step 4:** Run the tests. Expected: PASS. `yarn typecheck` is clean.
- [ ] **Step 5:** Commit: `feat(mcp): tool registry, API bridge and universal tools`.

---

### Task 11: `/mcp` HTTP endpoint

**Files:**
- Create: `server/routes/mcp.ts`
- Test: `tests/e2e/mcp.spec.ts` (HTTP-level, using Playwright `request`, which needs the running app and seed)

**Interfaces:**
- Consumes: `requireAuth`, `isCredentialPrincipal` (Task 3); `createVeerifyMcpServer`, `createApiCaller` (Task 10).
- Behaviour:
  - Handles `POST /mcp`. `GET` and `DELETE` return 405, because the transport is stateless with no SSE stream.
  - It runs `requireAuth`. When the result isn't a credential principal, it throws 401 with header
    `WWW-Authenticate: Bearer realm="veerify"`. Phase 3 adds `resource_metadata` here.
  - It builds `callApi` from the request's `authorization` header and any `x-veerify-organization` and
    `x-veerify-project` headers.
  - It creates a fresh `McpServer` and a `StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })`,
    `connect`s them, and calls `transport.handleRequest(event.node.req, event.node.res, await readBody(event))`.
    Both are closed when the response ends. The event is marked handled so Nitro doesn't write a second response.

- [ ] **Step 1: Write the failing e2e test.** Create a key through `POST /api/user/api-keys` using the signed-in cookie
  context. Then make raw JSON-RPC calls to `/mcp` with `Accept: application/json, text/event-stream`:
  - `initialize` → 200 with `serverInfo.name === 'veerify'`;
  - `tools/list` → the six tools;
  - `tools/call whoami` → contains the seeded user's email;
  - `tools/call call_api` GET `/api/projects` → contains the seeded project slug.
  - The same `initialize` with only the cookie → 401. With a revoked key → 401.
- [ ] **Step 2:** Run `yarn test:e2e:worktree tests/e2e/mcp.spec.ts`. Expected: FAIL (404).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the spec. Expected: PASS. Then check by hand:
  `claude mcp add --transport http veerify-dev http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <key>"`, then in
  Claude Code ask "who am I in Veerify?". Expected: it answers with your email.
- [ ] **Step 5:** Commit: `feat(mcp): stateless /mcp endpoint for personal API keys`.

---

### Task 12: Documentation

**Files:**
- Create: `docs/mcp.md`. Covers:
  - creating a key;
  - the `claude mcp add` command;
  - the context headers;
  - what `call_api` refuses and why;
  - three recipes as prompts plus the tool calls they lead to: "rename my project and turn on the roadmap", "add a
    product", "set up a custom domain" (Veerify side plus the DNS records your DNS tool must create).
- Modify: `.agents/CLAUDE.md`:
  - the Authentication section (personal keys, `requireInteractiveSession`, context stored per credential);
  - the endpoint authorization table (`/api/user/api-keys`, `/mcp`);
  - a pointer to `docs/mcp.md`.
- Modify: `.cursor/rules/project.mdc` and `server/.cursor/rules/api.mdc`, the matching lines, to keep them in sync as
  `.agents/CLAUDE.md` requires.
- Modify: `docs/agent/context-map.md` if it lists auth entry points.

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** Run `yarn harness:docs && yarn format:check`. Expected: both pass.
- [ ] **Step 3:** Commit: `docs(mcp): setup guide and agent instructions`.

---

## Phase 1 exit check

- [ ] `yarn lint && yarn typecheck && yarn test && yarn openapi:check` all pass.
- [ ] `yarn test:e2e:worktree tests/e2e/user-api-keys.spec.ts tests/e2e/mcp.spec.ts` passes.
- [ ] Manual: from Claude Code with a fresh key, create a category, rename it, and delete it via `search_api` + `call_api`. Then
  revoke the key in Settings. The next tool call fails with 401.
