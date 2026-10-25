# App Feedback API (Dot X in-app feedback)

Status: draft, awaiting approval
Date: 2026-10-23

## Intent

Dot X (DotMatrixLabs' Tauri desktop app, `D:/dot-x`) currently sends users to the browser
(`https://dml.gg/feedback`) to leave feedback. We want users to submit feedback from a modal
inside the app, and have it land in the Dot X project in Veerify clearly marked as coming from
the app. Veerify needs a small, safe API that third-party apps can post feedback to.

This doc covers the Veerify side in full and the Dot X side at the level needed to agree on the
contract. The Dot X work is done in a separate thread against `D:/dot-x`.

## Goals

- A Veerify endpoint that accepts feedback from an app, scoped to one project via an app key.
- Feedback posted this way shows "Added from Dot X" (the key's name) in the dashboard and on
  the public board; the dashboard also shows the app version and OS the user was on.
- Team members can create, see and revoke app keys per project from product settings.
- Dot X: Settings → About → "Give feedback" opens an in-app modal: Bug / Feature selector, one
  short description box, Send → "Thanks for the feedback" message. A second button opens the
  public DotMatrixLabs board (`https://dml.gg/feedback`) in the browser so users can see others'
  feedback.

## Non-goals

- No reading feedback through the API (no list/vote/comment endpoints for apps).
- No user accounts or login in Dot X; no email capture in the modal.
- No attachments/screenshots from the app.
- No JS embed widget for websites (this API could back one later, but not now).

## Anti-goals (would make this a failure even if it works)

- An app key that grants anything beyond "create feedback in this one project". The key ships
  inside a desktop binary, so it must be treated as public.
- Any cookie / session-based auth on the app endpoint (CORS + credentials must stay off).
- App submissions that look identical to website submissions in the dashboard.
- The modal silently losing feedback: failures must show an error with a retry.

## Constraints (from the codebase)

- Feedback type already lives in `feedback.metadata.feedbackType`
  (`feature_request | bug_report | ...`), which the public board renders as a tag. App
  submissions use the same values: Bug → `bug_report`, Feature → `feature_request`.
- `feedback.title` is required; the app sends only a description.
- Votes require a user or anonymous session (`vote` table); app submissions have neither.
- No CORS is configured anywhere today. Dot X calls with the webview's `fetch`, so the origin will
  be `https://tauri.localhost` on Windows (Dot X sets `useHttpsScheme: true`), which means a
  preflight is needed. Dot X's CSP is `null`, so nothing blocks the call client-side.
- Rate limiting exists (`server/utils/rate-limit.ts`), keyed on IP.
- Schema changes go through `yarn db:generate` (never hand-written migrations). Options API only
  for Vue. `createError()` for errors. Project access utilities for anything touching projects.

## Design

### 1. App keys (`project_api_key` table)

New table in `server/database/schema/feedback.ts`:

| column                                 | notes                                                         |
| -------------------------------------- | ------------------------------------------------------------- |
| `id`                                   | text PK                                                       |
| `projectId`                            | FK → project, cascade delete                                  |
| `name`                                 | display name, e.g. "Dot X" — this is the "Added from …" label |
| `keyPrefix`                            | first ~12 chars of the key, shown in the UI to identify it    |
| `keyHash`                              | SHA-256 of the full key, unique; the key itself is not stored |
| `createdByUserId`                      | FK → user, set null on delete                                 |
| `createdAt`, `lastUsedAt`, `revokedAt` | timestamps; revoked keys are rejected                         |

Key format: `vfy_pub_` + 32 random bytes base62/base64url. The full key is shown once on
creation (copy button + "you won't see this again"). Lookup is by hash.

Scope: one key = create feedback in one project. Nothing else. Works for public and private
projects (the key is the authorisation; private projects simply don't show it on a public board).

### 2. Feedback source

Add to `feedback`:

- `apiKeyId` — nullable FK → `project_api_key`, set null on delete.
- `sourceLabel` — nullable text, copied from the key name at submit time (so the badge survives
  key rename/deletion).

Client context goes in `metadata.client`: `{ appVersion, os, osVersion }` (all optional strings,
length-capped).

`sourceLabel` null means submitted via Veerify itself (existing behaviour, unchanged).

### 3. Endpoint: `POST /api/v1/feedback`

- Auth: `Authorization: Bearer vfy_pub_…`. Missing/unknown/revoked → 401. No session lookup.
- Body (zod):
  - `type`: `'bug' | 'feature'` (required)
  - `description`: string, trimmed, 1–2000 chars (required)
  - `appVersion`, `os`, `osVersion`: optional strings, ≤ 64 chars each
- Title: first non-empty line of the description, truncated to 80 chars with an ellipsis.
  `body` = full description.
- Insert: `projectId` from the key, `status 'open'`, `authorName: '<key name> user'`
  (e.g. "Dot X user"), no author user/session, `voteCount 0`, no vote row,
  `metadata: { feedbackType, client }`, `apiKeyId`, `sourceLabel`.
- Update `lastUsedAt` on the key (fire-and-forget is fine).
- Side effects: notify the project team via `notifyProjectTeam` (`server/utils/notifications.ts`).
  GitHub auto-create is skipped: it is inlined in `server/api/feedback/index.post.ts` and not
  reusable without copying (follow-up: extract it).
- Response `201`: `{ success: true, data: { id } }` via existing `createSuccessResponse`.
- Rate limit: per IP strict (5/min), plus a per-key ceiling (e.g. 200/hour) so a leaked key
  can't flood a project. Uses existing `requireRateLimit`; the per-key limit passes the key id
  as `subject`.
- CORS for `/api/v1/**` only: `Access-Control-Allow-Origin: *`, methods `POST, OPTIONS`,
  headers `Authorization, Content-Type`, no `Allow-Credentials`. `OPTIONS` returns 204.
- Document it with `defineOpenAPIRoute` in the route file and regenerate via
  `yarn openapi:generate`; add a bearer security scheme next to `cookieAuth` in
  `server/api/openapi.json.get.ts`.

### 4. Key management API (team members only)

Under `server/api/projects/[slug]/api-keys/` (existing routes are slug-based):

- `GET` — list (id, name, keyPrefix, createdAt, lastUsedAt, revokedAt). Never returns hashes.
- `POST { name }` — create; returns the full key once.
- `DELETE [keyId]` — revoke (sets `revokedAt`).

Access follows the existing settings-tab pattern: `requireAuthWithResolvedTeam` + project
lookup by slug within the active team + team membership (see
`requireProjectCategoryAccessBySlug` in `server/utils/project-categories.ts`).

### 5. Dashboard UI

- Product settings (`pages/products/[slug].vue`): new "API keys" tab
  (`components/products/ProductSettingsApiKeys.vue`): create with name, show-once dialog with
  copy, list with prefix / created / last used, revoke with confirmation. Skeleton/error/retry
  per project conventions. Include a short curl example for the endpoint.
- Feedback list and detail in the dashboard: badge "Added from {sourceLabel}" when set. Detail
  view also shows app version and OS from `metadata.client`.
- Public board: app posts appear like any other post (type tag already renders). Also show
  "Added from {sourceLabel}" on list items and the detail view; expose `sourceLabel` (not
  `metadata.client`) from the public feedback API. App version/OS stay dashboard-only.

### 6. Dot X side (separate thread, `D:/dot-x`)

- `src/SettingsModal/About.vue`: the existing "Give feedback" button opens a new
  `FeedbackModal.vue` (DaisyUI modal, same pattern as `components/ActionModal.vue`).
- Modal: Bug / Feature toggle, one textarea ("Short description"), a line saying the feedback
  will be posted publicly on the DotMatrixLabs feedback board, Send. While sending, the
  button is disabled with a spinner. On success: "Thanks for the feedback!" + close. On failure:
  error message + Retry, text kept.
- "See others' feedback" button in the modal → `openLink('https://dml.gg/feedback')`.
- Sends `type`, `description`, `appVersion` (from `tauri.conf.json` / `getVersion()`), `os` and
  `osVersion` (`@tauri-apps/plugin-os`). Device ID is not sent.
- Config: `VITE_VEERIFY_API_URL` and `VITE_VEERIFY_APP_KEY` in `.env` / `.env.example`.

## Calls I made (not discussed)

- Name: "app key" in UI, `project_api_key` in schema, endpoint versioned under `/api/v1`.
- Single description box; title derived from its first line.
- No auto-vote for app submissions; author shown as "{key name} user".
- Client context = app version + OS; no device ID.
- App version/OS are dashboard-only; only the source label is public.

## Left to the builder

- Exact key encoding, prefix length, per-key rate ceiling value.
- Where the source badge sits visually in list/detail.
- Whether CORS is done as a server middleware scoped to `/api/v1` or `routeRules` + an OPTIONS
  handler.

## Testing

- Unit tests (vitest, existing `tests/` patterns with mocked drizzle): endpoint rejects
  missing/unknown/revoked keys; validates body; derives title; maps type; sets source fields;
  key management requires project access; created key hash matches and plaintext isn't stored.
- Manual: create a key in the dashboard, curl the endpoint, see the badge; preflight from a
  non-Veerify origin succeeds.
