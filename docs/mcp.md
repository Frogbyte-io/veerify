# Veerify MCP server

Veerify exposes a Model Context Protocol endpoint at `/mcp`. Claude Code (or any MCP client) connects with a personal
API key and acts as that user, with exactly that user's permissions. This is Phase 1 (foundation): a small set of
universal tools that reach every dashboard API route. Purpose-built tools for feedback, roadmap and more are coming later.

## 1. Create a key

1. Sign in and open Settings, then API keys (`/settings#api-keys`).
2. Create a key. Pick an expiry (30, 90 or 365 days, or never).
3. Copy it immediately. Keys look like `vfy_usr_...` and are shown **once**; only a hash is stored.

You can have at most 25 active keys. Revoke a key in the same screen; the next request made with it returns 401.

Keys are managed through `GET/POST /api/user/api-keys` and `DELETE /api/user/api-keys/:keyId`. These endpoints need a
browser session: a request made with a key gets 403, so an agent can never mint or revoke keys.

## 2. Connect Claude Code

```bash
claude mcp add --transport http veerify https://<your-veerify-host>/mcp --header "Authorization: Bearer vfy_usr_..."
```

`/mcp` is POST only (stateless Streamable HTTP, JSON responses), accepts only key credentials (a cookie-only request
gets 401 with `WWW-Authenticate: Bearer realm="veerify"`), caps request bodies at 4 MiB (413), and limits each key to
600 requests per 60 seconds. One tool call can make several internal requests.

The same key also works as `Authorization: Bearer vfy_usr_...` on every dashboard route under `/api/`. An invalid,
revoked or expired key returns 401 and never falls back to a cookie. Key credentials cannot change the account email.

## 3. Context: workspace and project

Each key stores its own active workspace and project. The agent changes it with `set_context`. To override it per
request, send these headers (on the MCP connection or on direct API calls):

| Header                   | Value                                            |
| ------------------------ | ------------------------------------------------ |
| `X-Veerify-Organization` | Workspace id or slug                             |
| `X-Veerify-Project`      | Project id, or project slug within the workspace |

- Both are access-checked: if the user cannot open it the request fails with 403. There is never a silent fallback to
  another workspace.
- Nothing is persisted under a header override. If the header workspace has no project, the request fails with 409.
- If the MCP connection itself sends these headers, the context is pinned and `set_context` refuses.

## 4. Tools

| Tool              | Purpose                                                              |
| ----------------- | -------------------------------------------------------------------- |
| `whoami`          | The user, key and current workspace and project                      |
| `list_workspaces` | Workspaces you belong to, with your role                             |
| `list_projects`   | Projects you can open                                                |
| `set_context`     | Change the key's stored workspace and project                        |
| `search_api`      | Find API operations by keyword or tag, or fetch one by `operationId` |
| `call_api`        | Call an operation: `method`, `path`, optional `query` and `body`     |

### What `call_api` refuses, and why

`call_api` only reaches the dashboard API as the user. It refuses:

- `/api/auth/` (sign-in, sessions, 2FA, Better-Auth organization operations): credentials must not manage credentials;
- `/api/cron/` and `/api/test`: internal and test-only routes;
- `/api/public/auth/`: public-auth handoff;
- `/api/user/api-keys`: an agent must not create or revoke keys;
- anything outside `/api/` (URLs, other hosts), traversal such as `/api/../api/auth/x`, double encoding, and paths
  containing `;` or non-ASCII characters: these could be used to dodge the checks above.

### Known gaps in Phase 1

- Inviting members (`POST /api/organizations/invite`) and other Better-Auth organization operations (changing member
  roles, removing members, cancelling invitations) need a browser session and do not work with keys yet.
- Connecting GitHub is a browser OAuth flow.
- `PUT /api/projects/{slug}` replaces the whole `settings` object, so send every key, including the module flags
  (`feedbackEnabled`, `roadmapEnabled`, `changelogEnabled`, `supportEnabled`, `marketingEnabled`).

## 5. Recipes

Each recipe is a prompt followed by the tool calls an agent makes. Run `search_api` with `operationId` to see the
full request shape.

### "Rename my project and turn on the roadmap"

1. `whoami` to confirm workspace and project.
2. `search_api` with `query: "update project"`.
3. `call_api` `GET /api/projects/{slug}` to read the current `settings`.
4. `call_api` `PUT /api/projects/{slug}` with `{ "name": "New name", "settings": { ...current settings, "roadmapEnabled": true } }`.

`settings` is replaced, not merged. Send the full object or omitted keys revert to defaults.

### "Add a product"

1. `whoami`.
2. `search_api` with `query: "create product"`.
3. `call_api` `POST /api/projects/{slug}/products` with `{ "name": "Decker" }` (the slug is derived from the name
   unless you pass `slug`). Project admins only.

### "Set up a custom domain"

1. `whoami`.
2. `search_api` with `query: "custom domain"`.
3. `call_api` `PUT /api/projects/{slug}` with `{ "customDomain": "feedback.example.com" }` (send `settings` too if you
   also change it, per the note above).
4. `call_api` `GET /api/projects/{slug}/verify-domain` with `query: { "domain": "feedback.example.com" }` (it must
   equal the project's current custom domain). The result lists the DNS records the domain needs.
5. Create those records in your DNS provider with your own DNS tool; Veerify cannot create them for you. Then repeat
   step 4 until the domain verifies.

## 6. Coverage of the API

Every non-exempt route must carry an `@openapi` block; `yarn openapi:check` (run in CI) enforces this, and
`search_api` is built from it. Run `yarn openapi:generate` to rebuild the spec.
