# Veerify MCP — Phase 3 (Device login) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent that can only send a message gets access to Veerify like this:

1. It asks Veerify for a code.
2. It sends the user a link (`/device?code=WXYZ-1234`).
3. The user signs in and clicks **Allow**.
4. The agent polls and receives a `vfy_usr_…` personal key, which it uses with `/mcp` or the REST API exactly like a
   hand-made key.

**Architecture:**

- A `device_authorization` row tracks each request through `pending → approved | denied → redeemed`, or until it
  expires.
- The device code is stored only as a hash.
- The personal key is minted at **redemption**, inside a conditional update, so the plaintext key is never stored and
  only one poll can win.
- Approval happens only through a browser session (`requireInteractiveSession`).
- The issued key is an ordinary `user_api_key` row with `createdVia = 'device'` and a 90-day expiry. Everything from
  Phase 1 applies to it unchanged: rate limit, context, self-protection and revocation.

**Tech Stack:** Nuxt 3 / Nitro / h3, Drizzle + PostgreSQL, Vue Options API + shadcn-vue, Vitest (unit + guarded
Postgres integration), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-25-veerify-mcp-design.md`, section _Credentials → Device login_ (Phase 3).
Phases 1 and 2 are merged (PRs #91, #99).

## Global Constraints

- **Project rules** from `.agents/CLAUDE.md` apply:
  - Options API only.
  - `createError()` with `createErrorResponse` (except the RFC-shaped `/api/device/token` errors below).
  - Skeleton loading and an error state with retry.
  - `<Icon name="lucide:*" />`.
  - Migrations only through `yarn db:generate`.
  - Every route has `@openapi`, and `yarn openapi:check` stays at 0.
  - `npx prettier --check` must be clean on changed files.
- **`POST /api/device/code` response** (RFC 8628 §3.2):
  `{ device_code, user_code, verification_uri, verification_uri_complete, expires_in: 600, interval: 5 }`.
  `verification_uri` = `${BETTER_AUTH_URL}/device`. `verification_uri_complete` = `${verification_uri}?code=<user_code>`.
- **`user_code` format**: 8 characters from `BCDFGHJKLMNPQRSTVWXZ` (no vowels, no look-alikes), shown as `XXXX-XXXX`.
  Input is normalised by upper-casing and removing everything outside the alphabet.
- **`device_code`**: `'vfy_dev_' + randomBytes(32).toString('base64url')`. Only its SHA-256 hex is stored.
- **`POST /api/device/token`** accepts JSON or `application/x-www-form-urlencoded`, with `{ device_code }`
  (`grant_type` is optional; when present it must be `urn:ietf:params:oauth:grant-type:device_code`).
  - Errors are RFC-shaped, HTTP 400 `{ error, error_description }`, with `error` one of: `authorization_pending`,
    `slow_down`, `access_denied`, `expired_token`, `invalid_grant` (unknown or already redeemed code),
    `invalid_request`.
  - Success: 200 `{ access_token: 'vfy_usr_…', token_type: 'Bearer', expires_in: 7776000 }`.
- **Polling**: polling faster than the row's `interval` gives `slow_down` and adds 5 s to that row's `interval`.
- **Issued key**:
  - `name` = `clientName` (trimmed, ≤ 60 characters), or `'Device login'` when absent.
  - `createdVia = 'device'`.
  - `expiresAt` = redemption time + 90 days.
  - It counts toward the existing cap of 25 active keys. When the user is at the cap, approval is refused with 409, and
    so is redemption, which returns `access_denied` with a description.
- **Approve and deny** require a browser session: `requireInteractiveSession`, so a key gets 403.
- **Rate limits** (`requireRateLimit`):
  - `/api/device/code`: 10 per 60 s per IP, identifier `'device-code'`.
  - User-code lookup, approve and deny: 10 per 60 s per user, identifier `'device-approve'`.
  - `/api/device/token`: 60 per 60 s per IP, identifier `'device-token'`.
- **Expiry**: a request older than 600 s can't be approved or redeemed.
- **MCP**: `call_api` refuses `/api/device/`, so a key can't drive the flow through MCP. Add it to
  `BLOCKED_API_PREFIXES`.

## Review Focus

1. **Two polls racing after approval.** Exactly one gets the key and the other gets `invalid_grant`, and only one
   `user_api_key` row exists. (Task 2)
2. **Approving after the 10-minute window.** It is refused, and a poll returns `expired_token`, never a key. (Task 2)
3. **An agent tries to approve a code with its key**, through REST or MCP. It gets 403 or a refusal, never an approval.
   (Tasks 3, 5)
4. **Guessing user codes.** A wrong code gets the same 404 as an expired or used one, and repeated guesses hit the
   per-user rate limit. (Task 3)
5. **A signed-out user opens `/device?code=…`.** They go to login, come back to `/device` with the code still filled
   in, and the request is still approvable. (Task 4)

---

## File Structure

| Path                                                                                                     | Responsibility                                           |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `server/database/schema/credentials.ts`                                                                  | `deviceAuthorization` table and `userApiKey.createdVia`  |
| `server/services/device-login.ts` (new)                                                                  | Codes, create, look up, approve or deny, poll and redeem |
| `server/api/device/code.post.ts`, `token.post.ts` (new)                                                  | Agent-facing RFC endpoints (public)                      |
| `server/api/device/requests/[userCode].get.ts`, `approve.post.ts`, `deny.post.ts` (new)                  | User-facing approval (browser session)                   |
| `pages/device/index.vue` (new)                                                                           | Approval page                                            |
| `lib/route-guard.ts`, `components/settings/SettingsApiKeys.vue`, `server/api/user/api-keys/index.get.ts` | Wiring and the "via device login" badge                  |
| `server/routes/mcp.ts`, `server/mcp/api-bridge.ts`, `docs/mcp.md`, `.agents/CLAUDE.md`                   | Hint, block and docs                                     |

---

### Task 1: Schema

**Files:** Modify `server/database/schema/credentials.ts`. A migration is generated (`0067_*`).

**Interfaces — Produces:**

- `deviceAuthorization` table:
  - `id` text PK
  - `deviceCodeHash` text not null, unique
  - `userCode` text not null, unique (stored normalised, without the dash)
  - `clientName` text
  - `status` text not null, default `'pending'` (`pending | approved | denied | redeemed`)
  - `userId` → user, cascade, nullable
  - `interval` int not null, default 5
  - `lastPolledAt` timestamp
  - `expiresAt` timestamp not null
  - `approvedAt`, `redeemedAt` timestamps
  - `issuedKeyId` → userApiKey, set null
  - `createdAt`
  - Indexes: (`expiresAt`), (`userId`)
- `userApiKey.createdVia` text not null, default `'manual'` (`manual | device`). This needs a DB-level default for
  existing rows.

- [ ] **Step 1:** Edit the schema.
- [ ] **Step 2:** Run `yarn db:generate`. Expected: one additive migration (CREATE TABLE plus ADD COLUMN with
      `DEFAULT 'manual' NOT NULL`). Review the SQL.
- [ ] **Step 3:** Run `yarn db:migrate && yarn typecheck`. Expected: both clean.
- [ ] **Step 4:** Commit `feat(db): device authorization requests and key origin`.

---

### Task 2: Device login service

**Files:** Create `server/services/device-login.ts`. Tests: `tests/device-login.test.ts` (pure helpers) and
`tests/integration/device-login.test.ts` (real Postgres).

**Interfaces — Produces:**

- `DEVICE_CODE_TTL_SECONDS = 600`, `DEVICE_POLL_INTERVAL_SECONDS = 5`, `DEVICE_KEY_TTL_DAYS = 90`,
  `USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ'`.
- `generateUserCode(): string`: 8 characters from the alphabet, using `crypto.randomInt`.
- `normalizeUserCode(input: string): string`.
- `formatUserCode(code: string): string`: `XXXX-XXXX`.
- `createDeviceAuthorization({ clientName?: string | null }): Promise<{ deviceCode: string; userCode: string; expiresIn: number; interval: number }>`.
  Retries on a userCode unique collision, up to 5 times.
- `findPendingByUserCode(userCode: string): Promise<{ id, clientName, expiresAt } | null>`. Returns null unless the row
  is `pending` and not expired.
- `approveDeviceAuthorization(userCode: string, userId: string): Promise<void>`:
  - throws 404 `NOT_FOUND` "Code not found or expired" unless the row is pending and unexpired;
  - throws 409 `CONFLICT` "You already have 25 active API keys" when the user is at the cap;
  - otherwise does a conditional update `pending → approved`, setting `userId` and `approvedAt`.
- `denyDeviceAuthorization(userCode: string, userId: string): Promise<void>`: a conditional update `pending → denied`,
  with the same 404 rule.
- `pollDeviceToken(deviceCode: string): Promise<{ ok: true; accessToken: string; expiresIn: number } | { ok: false; error: DeviceTokenError; description: string }>`.
  The algorithm, in one transaction:

  ```
  row = SELECT … WHERE device_code_hash = hash FOR UPDATE   → none: invalid_grant
  if row.status = 'redeemed'                                → invalid_grant
  if now > row.expiresAt                                    → expired_token
  if row.lastPolledAt and now - lastPolledAt < interval s   → UPDATE interval += 5, lastPolledAt = now; slow_down
  UPDATE lastPolledAt = now
  if status = 'pending'  → authorization_pending
  if status = 'denied'   → access_denied
  status = 'approved':
    if active keys of userId >= 25 → access_denied ("API key limit reached")
    generateUserApiKey(); INSERT user_api_key (name, createdVia 'device', expiresAt now+90d)
    UPDATE status='redeemed', redeemedAt, issuedKeyId
    return key
  ```

  Use the existing helpers `generateUserApiKey` (`server/utils/user-api-keys.ts`) and `MAX_ACTIVE_KEYS`. Move it to an
  exported constant if it is only local today.

- [ ] **Step 1: Write failing tests.**
  - **Unit tests:**
    - `generateUserCode` returns 8 characters, all from the alphabet.
  - `normalizeUserCode(' bcdf-ghjk ')` returns `'BCDFGHJK'` (lowercase, dash and spaces are handled). `normalizeUserCode('BCDF-GHJA')` returns `'BCDFGHJ'`, because `A` isn't in the alphabet.
    - `formatUserCode('BCDFGHJK')` returns `'BCDF-GHJK'`.
  - **Integration tests:**
    - The full happy path: create, then poll gives `authorization_pending`, then approve, then poll gives a key that
      starts with `vfy_usr_`. The `user_api_key` row has `createdVia: 'device'` and an expiry about 90 days out, and a
      second poll gives `invalid_grant`.
    - Deny, then poll gives `access_denied`.
    - **Review Focus 2:** set `expiresAt` in the past. Approve throws 404 and poll gives `expired_token`.
    - **Review Focus 1:** approve, then run `Promise.all` with two polls (the second ignores `slow_down` by resetting
      `lastPolledAt`). Exactly one key comes back and the table holds one key row.
    - `slow_down`: two polls within 5 s. The second is `slow_down` and `interval` becomes 10.
    - Key cap: seed 25 active keys. Approve throws 409.
- [ ] **Step 2:** Run `yarn vitest run tests/device-login.test.ts` and
      `npx vitest run -c vitest.integration.config.ts tests/integration/device-login.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both commands. Expected: PASS.
- [ ] **Step 5:** Commit `feat(auth): device login service`.

---

### Task 3: Device REST endpoints

**Files:**

- Create `server/api/device/code.post.ts` and `server/api/device/token.post.ts`.
- Create `server/api/device/requests/[userCode].get.ts`, `server/api/device/requests/[userCode]/approve.post.ts` and
  `server/api/device/requests/[userCode]/deny.post.ts`.
- Add an `Auth` tag usage (tag `Device login`) in `server/api/openapi.json.get.ts`.
- Modify `server/mcp/api-bridge.ts` to add `/api/device` to `BLOCKED_API_PREFIXES`.
- Test: `tests/device-routes.test.ts` (mocked service, same style as `tests/user-api-key-routes.test.ts`).

**Interfaces:**

- **Consumes:** the Task 2 service, `requireInteractiveSession`, and `requireRateLimit`.
- **Produces:**
  - `POST /api/device/code`: public. Body: optional JSON `{ client_name?: string (≤ 60) }`. Rate-limited.
    Returns 200 with the Global Constraints shape (bare RFC JSON, no `{ success, data }` envelope).
  - `POST /api/device/token`: public, rate-limited.
    - Body: JSON, or form-urlencoded read with `readFormData` / `readBody` based on `content-type`.
    - Returns RFC-shaped success or error.
    - Sets `Cache-Control: no-store` and `Pragma: no-cache`.
  - `GET /api/device/requests/:userCode`: `requireInteractiveSession` plus the per-user rate limit.
    - Returns `{ data: { userCode: formatted, clientName, expiresAt } }`.
    - Returns 404 `NOT_FOUND` "Code not found or expired" for unknown, expired, used, approved or denied codes alike.
  - `POST …/approve` and `POST …/deny`: `requireInteractiveSession` plus the per-user rate limit. Return
    `{ data: { status: 'approved' | 'denied' } }`.

- [ ] **Step 1: Write failing tests.**
  - The code endpoint returns the exact keys, `expires_in: 600`, `interval: 5`, and
    `verification_uri_complete` ending with `/device?code=` plus the formatted code.
  - The token endpoint maps each service error to 400 `{ error, error_description }`, and success to 200 with
    `token_type: 'Bearer'` and `no-store`. A form-encoded body works.
  - `grant_type` with any value other than the device grant gives `invalid_request`.
  - **Review Focus 3:** a key principal calling approve, deny or the lookup gets 403.
  - **Review Focus 4:** an unknown code and an expired code produce identical 404 bodies. The 11th lookup within 60 s
    gets 429. Assert the configured `requireRateLimit` call.
  - `normalizeApiPath`/`isBlockedApiPath('/api/device/requests/X/approve')` is blocked. Add this to
    `tests/mcp-api-bridge.test.ts`.
- [ ] **Step 2:** Run `yarn vitest run tests/device-routes.test.ts tests/mcp-api-bridge.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the routes with `@openapi` blocks:
  - Public routes have no `security`.
  - Approval routes use `security: [{ cookieAuth: [] }]` and note "browser session only".
  - Then run `yarn openapi:generate` and commit the generated file.
- [ ] **Step 4:** Run the tests and `yarn openapi:check`. Expected: PASS, and 0 undocumented routes.
- [ ] **Step 5:** Commit `feat(api): device login endpoints`.

---

### Task 4: `/device` approval page and key origin badge

**Files:**

- Create: `pages/device/index.vue`
- Modify: `lib/route-guard.ts` (add `/device` to `PUBLIC_HOST_APP_ROUTES` only; **not** to `PROTECTED_ROUTES`, because
  the page sends signed-out users to login itself so the code survives)
- Modify: `server/api/user/api-keys/index.get.ts` (select `createdVia`)
- Modify: `components/settings/SettingsApiKeys.vue` (badge)
- Test: `tests/e2e/device-login.spec.ts`

**Page behaviour (Options API, `clean` layout):**

- On mount, read `?code=`. Check the session via the Better-Auth client (`useSession`) or `/api/auth/get-session`.
  When signed out, `navigateTo('/login?redirect=' + encodeURIComponent('/device?code=' + code))`. The login page
  already honours `redirect`; confirm it accepts paths with a query string through `resolveSafeRedirectTarget`.
- Without a code, show an input for `XXXX-XXXX`, plus a Continue button that does the lookup.
- After the lookup:
  - Loading shows a Skeleton.
  - A 404 shows "This code is invalid or has expired. Ask the agent for a new one." with a retry input.
  - Otherwise show a card: "**{clientName ?? 'An agent'}** wants to act as you in Veerify", "It will be able to do
    anything you can do. You can revoke it any time in Settings → API keys.", the code in large monospace, and the
    expiry countdown. Then two buttons: **Allow** (primary) and **Deny**.
- When done, show "Approved — you can close this tab and return to the agent." or "Denied."
- A 409 (key cap) shows the server message with a link to `/settings#api-keys`.

**Settings:** a key with `createdVia === 'device'` shows a small badge "via device login" next to its name.

- [ ] **Step 1: Write the failing e2e test.** It uses Playwright's `request` for the agent side and a page for the user.
  - The agent POSTs `/api/device/code` with `client_name: 'E2E agent'`.
  - **Review Focus 5:** in a fresh, signed-out context, open `verification_uri_complete`. This lands on `/login`. Sign
    in as the seed user. The page returns to `/device?code=…` and shows "E2E agent".
  - Click Allow. The page shows "Approved".
  - The agent polls `/api/device/token`, waiting out `slow_down`, and gets `access_token`.
  - `GET /api/projects` with that bearer returns 200.
  - In `/settings#api-keys` the key "E2E agent" shows "via device login".
  - A second flow where the user clicks Deny makes the poll return `access_denied`.
- [ ] **Step 2:** Run it against a dev server.
  - Start `BETTER_AUTH_SECRET=… UPLOAD_TOKEN_SECRET=… yarn dev --port 4599` in the background.
  - Run `PLAYWRIGHT_BASE_URL=http://localhost:4599 npx playwright test tests/e2e/device-login.spec.ts --workers 1`.
    Expected: FAIL.
  - Stop **only that server process** by PID. Never use `taskkill /IM node.exe`.
- [ ] **Step 3:** Implement the page, route-guard entry, list field and badge.
- [ ] **Step 4:** Run the spec again. Expected: PASS. Then run `npx eslint` on the changed files (0 errors) and
      `yarn typecheck`.
- [ ] **Step 5:** Commit `feat(ui): device login approval page`.

---

### Task 5: MCP hint and docs

**Files:**

- Modify: `server/routes/mcp.ts`. The 401 body adds
  `hint: 'No API key. Create one in Settings → API keys, or use device login: POST <host>/api/device/code'` inside
  `data.error.details`, while keeping the `WWW-Authenticate` header.
- Modify: `docs/mcp.md`. Add a "Headless agents: device login" section with a curl recipe:
  - `curl -X POST <host>/api/device/code -d '{"client_name":"My agent"}' -H 'content-type: application/json'`;
  - show the link to the user;
  - poll `/api/device/token` every `interval` seconds;
  - use `access_token` as the bearer.

  Also cover the 90-day expiry, revoking, and that approval grants full access.

- Modify: `.agents/CLAUDE.md`. Add the endpoint rows `/api/device/code`, `/api/device/token` (public) and
  `/api/device/requests/*` (browser session only), and one line under "API keys and MCP".
- Modify: `server/.cursor/rules/api.mdc` (one line).
- Test: update `tests/e2e/mcp.spec.ts`. The cookie-only 401 body contains `device`.

- [ ] **Step 1:** Write the failing assertion in `tests/e2e/mcp.spec.ts`. Run it against a dev server as in Task 4.
      Expected: FAIL.
- [ ] **Step 2:** Implement the hint and write the docs.
- [ ] **Step 3:** Run the spec again (PASS), then `yarn harness:docs`, `npx prettier --check` on the changed files,
      `npx eslint .` (0 errors), `yarn typecheck`, `yarn vitest run` (only `tests/build-lifecycle.test.ts` may fail) and
      `yarn openapi:check`.
- [ ] **Step 4:** Commit `docs(mcp): device login for headless agents`.
