# App Feedback API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let apps like Dot X post feedback into one Veerify project using a project-scoped
app key, with the post marked "Added from {key name}".

**Architecture:** A new `project_api_key` table holds hashed, revocable keys per project. A
`POST /api/v1/feedback` endpoint authenticates the bearer key, inserts feedback with
`apiKeyId` + `sourceLabel` + `metadata.{feedbackType,client}`, and is reachable cross-origin via
a CORS middleware scoped to `/api/v1/`. Team members manage keys from a new product-settings
tab; the source label renders in the dashboard and public board.

**Tech Stack:** Nuxt 3 / Nitro, Drizzle (Postgres), zod, vitest, Vue Options API + shadcn-vue.

**Spec:** `docs/superpowers/specs/2026-10-23-app-feedback-api-design.md`

## Global Constraints

- Vue: Options API only, `<Icon name="lucide:*" />`, Skeleton → error-with-retry → content.
- Server errors: `createError({ statusCode, statusMessage, data: createErrorResponse(ErrorCode.X, msg) })`.
- Schema change: edit schema, run `yarn db:generate`; never hand-write migration SQL.
- Key format: `vfy_pub_` + random; only the SHA-256 hex hash is stored; full key returned once.
- Description 1–2000 chars after trim; `appVersion` / `os` / `osVersion` ≤ 64 chars each.
- Title = first non-empty line of description, max 80 chars, longer → first 79 chars + `…`.
- Type mapping: `bug` → `bug_report`, `feature` → `feature_request` (in `metadata.feedbackType`).
- Author name: `` `${key.name} user` ``; `voteCount: 0`; no vote row; no anon session.
- Rate limits: per IP `rateLimits.strict` (5/60s) identifier `app-feedback-ip`; per key
  200/3600s identifier `app-feedback-key`, `subject: key.id`.
- CORS on `/api/v1/**` only: `Access-Control-Allow-Origin: *`, `-Methods: POST, OPTIONS`,
  `-Headers: Authorization, Content-Type`, `-Max-Age: 86400`; never `Allow-Credentials`.
- `metadata.client` is team-only; `sourceLabel` is public.
- GitHub auto-create is not called from the app endpoint.

## Review Focus

- CORS headers missing on error responses (401/400/429) → the webview sees an opaque network
  error and Dot X can't show a proper message. Headers must be set before auth/validation runs.
  (Task 3: `sets CORS headers on 401 responses`.)
- Preflight `OPTIONS` carrying no `Authorization` must return 204, never 401. (Task 3.)
- Whitespace-only description or one starting with blank lines → 400 / title from the first
  non-blank line. (Task 2 `deriveTitle` tests, Task 3 validation test.)
- Revoked key → 401, same message as unknown key. (Task 3.)
- Public detail endpoint `GET /api/feedback/[id]` returns full `metadata` today, which would leak
  `metadata.client` to anonymous viewers. (Task 6: `strips metadata.client for non-team viewers`.)

---

### Task 1: Schema — app keys and feedback source columns

**Files:**

- Modify: `server/database/schema/feedback.ts` (add `projectApiKey` table after `project`;
  add columns to `feedback`)
- Generated: `server/database/migrations/0056_*.sql` + `meta/`

**Interfaces:**

- Produces: `projectApiKey` table export with columns `id`, `projectId`, `name`, `keyPrefix`,
  `keyHash`, `createdByUserId`, `createdAt`, `lastUsedAt`, `revokedAt` (see spec §1; `keyHash`
  unique index, `projectId` index; FK project cascade, FK user set null). `feedback.apiKeyId`
  (`api_key_id`, FK → projectApiKey, set null) and `feedback.sourceLabel` (`source_label`, text,
  nullable).

- [ ] **Step 1:** Add the table and columns. `projectApiKey` must be declared before `feedback`
      for the FK reference. Make sure `schema/index.ts` re-exports it (it re-exports the file).
- [ ] **Step 2:** Run `yarn db:generate`. Expected: one new migration creating
      `project_api_key` and adding two nullable columns to `feedback`. Review the SQL: no drops.
- [ ] **Step 3:** Run `yarn typecheck`. Expected: no new errors.
- [ ] **Step 4:** Commit `feat(api): add project app keys and feedback source columns`.

### Task 2: App key utilities

**Files:**

- Create: `server/utils/app-keys.ts`
- Test: `tests/app-keys.test.ts`

**Interfaces:**

- Produces:
  - `APP_KEY_PREFIX = 'vfy_pub_'`
  - `generateAppKey(): { key: string; keyPrefix: string; keyHash: string }` — key =
    prefix + 32 bytes `randomBytes` base64url; `keyPrefix` = first 12 chars of key.
  - `hashAppKey(key: string): string` — SHA-256 hex.
  - `readBearerAppKey(event: H3Event): string | null` — parses `Authorization`, case-insensitive
    `Bearer`, trims; returns null unless it starts with `APP_KEY_PREFIX`.
  - `requireAppKey(event: H3Event): Promise<ProjectApiKeyRow>` — looks up by hash with
    `revokedAt IS NULL`; throws 401 `ErrorCode.UNAUTHORIZED` "Invalid app key" for missing,
    unknown, or revoked.
  - `deriveTitle(description: string): string` — rule in Global Constraints.
  - `toFeedbackType(type: 'bug' | 'feature'): 'bug_report' | 'feature_request'`

- [ ] **Step 1: Write failing tests** in `tests/app-keys.test.ts`:
  - `generateAppKey` → `key` starts with `vfy_pub_`, `keyPrefix === key.slice(0, 12)`,
    `keyHash === hashAppKey(key)`, two calls give different keys.
  - `deriveTitle('Fix it\nmore detail') === 'Fix it'`
  - `deriveTitle('\n\n  Slider jumps  \nx') === 'Slider jumps'`
  - `deriveTitle('a'.repeat(100))` → length 80, ends with `…`
  - `deriveTitle('a'.repeat(80))` → unchanged
  - `readBearerAppKey` with `bearer  vfy_pub_abc ` → `'vfy_pub_abc'`; with `Bearer xyz` → null;
    with no header → null.
  - `requireAppKey` (mock `~/server/database/drizzle` as in `tests/feedback-attachment-routes.test.ts`,
    stub `createError`): no row → throws `statusCode: 401`.
- [ ] **Step 2:** Run `yarn vitest run tests/app-keys.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `server/utils/app-keys.ts`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): add app key utilities`.

### Task 3: `POST /api/v1/feedback` + CORS

**Files:**

- Create: `server/middleware/api-v1-cors.ts`
- Create: `server/api/v1/feedback.post.ts` (with `@openapi` JSDoc block, tag `App API`)
- Modify: `server/api/openapi.json.get.ts` (add `appKeyAuth: { type: http, scheme: bearer }`
  security scheme beside `cookieAuth`)
- Regenerate: `server/generated/openapi-routes.ts` via `yarn openapi:generate`
- Test: `tests/app-feedback-route.test.ts`

**Interfaces:**

- Consumes: Task 2 exports; `requireRateLimit`, `rateLimits`; `validateBody`; and this call:

  ```ts
  notifyProjectTeam(projectId, null, {
    type: 'new_feedback',
    title: `New feedback: "${title}"`,
    body: `Added from ${key.name}`,
    link: `/feedback?id=${id}`,
    feedbackId: id,
    actorName: authorName,
  })
  ```

  (not awaited, same as `server/api/feedback/index.post.ts:331`).

- Produces: `201 { success: true, data: { id } }`.

Middleware: for paths starting `/api/v1/`, set the CORS headers from Global Constraints on every
response; if method is `OPTIONS`, respond 204 and stop. Order inside the handler: IP rate limit →
`requireAppKey` → key rate limit → `validateBody` → insert → `lastUsedAt` update (not awaited,
errors logged) → notify.

Body schema: `type: z.enum(['bug','feature'])`, `description: z.string().trim().min(1).max(2000)`,
`appVersion|os|osVersion: z.string().trim().max(64).optional()`.

- [ ] **Step 1: Write failing tests** (stub Nitro globals; mock db, rate limit, notifications):
  - `rejects requests without an app key` → 401.
  - `rejects a revoked key` → 401 (db lookup returns nothing).
  - `rejects a whitespace-only description` → 400.
  - `creates feedback marked with the key name` → inserted values include
    `projectId: key.projectId`, `title: 'Slider jumps'`, `body` = full description,
    `authorName: 'Dot X user'`, `voteCount: 0`, `apiKeyId: key.id`, `sourceLabel: 'Dot X'`,
    `metadata: { feedbackType: 'bug_report', client: { appVersion: '2.0.0-1', os: 'windows', osVersion: '10.0.26200' } }`,
    `authorUserId: null`, `authorSessionId: null`; response status 201 with `data.id`.
  - `applies a per-key rate limit` → `requireRateLimit` called with
    `{ maxRequests: 200, windowSeconds: 3600, identifier: 'app-feedback-key', subject: key.id }`.
  - Middleware: `answers preflight with 204 without auth` and
    `sets CORS headers on 401 responses` (headers present on the event before handler throws),
    `ignores non-/api/v1 paths` (no headers set).
- [ ] **Step 2:** Run `yarn vitest run tests/app-feedback-route.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement middleware, route, OpenAPI scheme; run `yarn openapi:generate`.
- [ ] **Step 4:** Run the test file. Expected: PASS. Run `yarn test`. Expected: all PASS.
- [ ] **Step 5:** Commit `feat(api): add app feedback endpoint with CORS`.

### Task 4: Key management routes

**Files:**

- Create: `server/api/projects/[slug]/api-keys/index.get.ts`
- Create: `server/api/projects/[slug]/api-keys/index.post.ts`
- Create: `server/api/projects/[slug]/api-keys/[keyId].delete.ts`
- Test: `tests/app-key-routes.test.ts`

**Interfaces:**

- Consumes: `requireProjectCategoryAccess(event)` from `server/utils/project-categories.ts`
  (resolves `[slug]` in the active team + team membership; returns `{ session, project }`);
  `generateAppKey()`.
- Produces:
  - `GET` → `ApiKeySummary[]` = `{ id, name, keyPrefix, createdAt, lastUsedAt, revokedAt }`,
    newest first. Never `keyHash`.
  - `POST { name: string (trim, 1–60) }` → `{ ...ApiKeySummary, key }` (only place `key` appears).
  - `DELETE` → sets `revokedAt = now` where `id = keyId AND projectId = project.id`; 404 if no row.

- [ ] **Step 1: Write failing tests:** list response objects have no `keyHash` property;
      create stores `keyHash === hashAppKey(returned.key)` and never stores `key`; delete of a key
      belonging to another project → 404; each route calls `requireProjectCategoryAccess`
      (mock it to throw 403 → route throws 403).
- [ ] **Step 2:** Run `yarn vitest run tests/app-key-routes.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement routes, each with an `@openapi` block; run `yarn openapi:generate`.
- [ ] **Step 4:** Run the test file. Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): add app key management routes`.

### Task 5: "API keys" product settings tab

**Files:**

- Create: `components/products/ProductSettingsApiKeys.vue`
- Modify: `pages/products/[slug].vue` (tab `{ id: 'api-keys', label: 'API keys', icon: 'lucide:key-round' }`
  before `embed`; add to `componentMap`; pass `projectSlug`)

**Interfaces:**

- Consumes: Task 4 routes via `$fetch`.

Behaviour: list (name, `keyPrefix…`, created, last used or "Never", Revoked badge); "Create key"
dialog with name input; after create, a dialog showing the full key with copy button and the text
"Copy this key now. You won't be able to see it again."; revoke via confirmation dialog. Show a
curl example using `window.location.origin + '/api/v1/feedback'`. Skeleton while loading, error
with Retry button. Use existing shadcn components only.

- [ ] **Step 1:** Implement the component and tab wiring.
- [ ] **Step 2:** Run `yarn typecheck` and `yarn lint`. Expected: no new errors.
- [ ] **Step 3:** Manual check (`yarn dev`): create, copy, revoke a key on a seeded product;
      `curl -X POST localhost:3000/api/v1/feedback -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -d '{"type":"bug","description":"Test from curl"}'`
      → 201; revoked key → 401.
- [ ] **Step 4:** Commit `feat(products): add API keys settings tab`.

### Task 6: Show the source in dashboard and public board

**Files:**

- Modify: `server/api/feedback/[id]/index.get.ts` (non-team viewers: `metadata` without `client`)
- Modify: `server/api/public/t/[teamSlug]/[projectSlug]/feedback.get.ts` (add `sourceLabel` to
  each mapped item)
- Modify: `pages/feedback/index.vue` (list item badge), `pages/feedback/[id]/index.vue` (badge +
  "App version" / "OS" rows from `metadata.client` when present)
- Modify: `components/public/PublicFeedbackBoard.vue` (badge on list item near the type tag and
  in the detail view)
- Test: `tests/feedback-source-visibility.test.ts`

**Interfaces:**

- Consumes: `feedback.sourceLabel`, `feedback.metadata.client` (Task 1/3). Dashboard list already
  selects the whole `feedback` row, so `sourceLabel` arrives without query changes.

Badge copy: `Added from {sourceLabel}`, `Badge variant="secondary"` with `lucide:app-window` icon.

- [ ] **Step 1: Write failing tests:** `strips metadata.client for non-team viewers` (detail
      endpoint, team member false → `metadata.client` undefined, `metadata.feedbackType` kept,
      `sourceLabel` kept); team member → `metadata.client` present; public list maps `sourceLabel`.
- [ ] **Step 2:** Run `yarn vitest run tests/feedback-source-visibility.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement server changes, then the three UI spots.
- [ ] **Step 4:** Run the test file → PASS; `yarn typecheck`, `yarn lint` → no new errors.
- [ ] **Step 5:** Manual: the curl-created post shows the badge in dashboard list, detail (with
      version/OS), and on the public board (without version/OS).
- [ ] **Step 6:** Commit `feat(feedback): show app source on feedback`.

### Task 7: Final verification and docs

**Files:**

- Modify: `.agents/CLAUDE.md` (Endpoint Authorization Rules table: add
  `POST /api/v1/feedback | App key | Creates feedback in the key's project`; Database table list:
  add `project_api_key`)

- [ ] **Step 1:** Update docs.
- [ ] **Step 2:** Run `yarn test`, `yarn typecheck`, `yarn lint`, `yarn format:check`. Expected:
      all pass (or only pre-existing failures, listed in the PR).
- [ ] **Step 3:** Commit `docs: document app feedback API`.
