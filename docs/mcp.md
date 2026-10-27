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
| `whoami`          | The user, credential type, workspace/project and `contextPinned`     |
| `list_workspaces` | Workspaces you belong to, with your role                             |
| `list_projects`   | Projects you can open                                                |
| `set_context`     | Change the key's stored workspace and project                        |
| `search_api`      | Find API operations by keyword or tag, or fetch one by `operationId` |
| `call_api`        | Call an operation: `method`, `path`, optional `query` and `body`     |
| `import_*`        | Move feedback from another tool into a project (see section 6)       |

### What `call_api` refuses, and why

`call_api` only reaches the dashboard API as the user. It refuses:

- `/api/auth/` (sign-in, sessions, 2FA): credentials must not manage credentials;
- `/api/cron/` and `/api/test`: internal and test-only routes;
- `/api/public/auth/`: public-auth handoff;
- `/api/user/api-keys`: an agent must not create or revoke keys;
- anything outside `/api/` (URLs, other hosts), traversal such as `/api/../api/auth/x`, double encoding, and paths
  containing `;` or non-ASCII characters: these could be used to dodge the checks above.

### Known gaps in Phase 1

- Inviting members (`POST /api/organizations/invite`) needs a browser session; with a key the route returns 403.
  Other Better-Auth organization operations (changing member roles, removing members, cancelling invitations) also
  need a browser session and do not work with keys yet.
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

## 6. Importing feedback from another tool

Seven tools (project admin required) let an agent move feedback, comments, votes, people, statuses, categories and
changelog entries from another system into a project. The agent does the fetching and converting; Veerify validates,
previews and writes. The format (`veerify-import/1`) is served by `import_get_format` and the resource
`veerify://imports/schema`.

| Tool                 | Purpose                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `import_get_format`  | JSON Schema and an example batch. Call this first                                          |
| `import_create_run`  | Draft run: `source`, `sourceLabel`, optional `product`, `project`, `onExisting`            |
| `import_add_records` | Stage one batch: sections only, not the full document; returns per-record issues           |
| `import_preview`     | The plan: `counts` per section (`create`, `update`, `unchanged`, `skip`), `kept`, `issues` |
| `import_commit`      | Write the run. Returns `{ run }` with `run.summary = { counts, kept }`                     |
| `import_status`      | Run status, counts, summary and issues; poll after a large commit                          |
| `import_cancel`      | Cancel an unfinished run and drop its staged records                                       |

`project` defaults to the active project.

### Rules

- Always preview, show it to the user, and commit only after they agree. Preview works only on a draft run (409 after
  commit).
- `records` in `import_add_records` holds only the sections (`statuses`, `categories`, `people`, `feedback`,
  `comments`, `changelog`). It is not the full document: `format`, `target`, `source` and `sourceLabel` are rejected
  (they belong to `import_create_run`).
- Limits: 1,000 records per `import_add_records` call and a 4 MiB request body (the records route and `/mcp` both
  refuse more with 413), 50,000 records per run, 10,000 listed `votes` per feedback (put larger totals in `voteCount`,
  at most 2,147,483,647). Runs of 500 records or fewer commit inline. Larger runs return `committing`; poll
  `import_status` until `completed`. A commit that hits a temporary database error stays `committing` and resumes on
  the next background tick; it fails after 10 such errors in a row.
- Re-importing is an ongoing sync where Veerify wins. A field is updated from the source only if nobody changed it in
  Veerify since the last import; edited fields are kept and the preview lists them under `kept`. New comments, votes and
  people are added. Nothing is ever deleted because it is missing from the source. `onExisting: "skip"` creates only
  records not seen before.
- What the team deletes in Veerify stays deleted. Imported feedback or comments deleted in Veerify are skipped on every
  later import from the same source (`skip` with the issue "Deleted in Veerify"; replies under a deleted comment and
  votes on deleted feedback are skipped too). When a user removes an imported vote that was attributed to them, the
  vote row is kept but detached from the user, so a re-import does not add the vote back.
- Votes: listed votes become vote rows. `voteCount` is a signed net counter that becomes a baseline for votes you do
  not list. If a re-run omits `voteCount`, the stored baseline is kept.
- Changelog links to feedback are created only when the entry is first imported.
- An import has no side effects: nobody is emailed or notified, no GitHub calls are made, and no subscriptions are
  created.

### Imported people

- Imported people are never emailed and never become users.
- An import never matches users by email. Importing a person whose email belongs to an account does not attribute
  anything to that account.
- Activity is attributed to a user only after that user verifies a matching email: following the verification link
  (also after an email change), signing up with an already verified email (social sign-in, magic link), or a magic-link
  sign-in that verifies the address. At that moment the person's imported posts, comments and votes become theirs (the
  person is "claimed"). Other account updates, such as a name change or turning on two-factor authentication, never
  claim anything.
- Later imports for a person who has already been claimed are attributed to that user.
- Newly imported people are not auto-claimed, even when a verified account with the same email already exists. They
  are claimed the next time that user verifies the email.
- Changing your email in Settings marks it unverified and sends a verification link to the new address.
- Converters key people known only by email as `email_<sha256 of the lowercased address>`, never the raw address. Do
  the same when you build `externalId`s yourself.
- Erasing a contact (Workspace, erase contact) tombstones the imported person: name and email are removed, links and
  counts stay, and a re-import never brings that data back. An `externalId` equal to the address is replaced by its
  hashed form, import issues that mention the address are deleted, and staged batches of unfinished runs lose the
  person and every reference to the address. A person later imported with an erased (suppressed) address is created
  without personal data. Staged batches are deleted when a run finishes.
- Source `metadata` on feedback is stored under `metadata.import.extra`. Erasure does not cover it. Do not put personal
  data there.

### "Migrate from Canny"

1. `whoami` to confirm the project, then `import_get_format`.
2. Fetch the Canny data with your own Canny access (boards, posts, comments, votes, users, changelog) and convert it to
   the format: one `externalId` per Canny id, `votes` where Canny lists voters, `voteCount` where it only gives a
   total.
3. `import_create_run` with `source: "canny"` and a `sourceLabel`.
4. `import_add_records` in batches of at most 1,000 records. Statuses, categories and people first is fine, but order
   does not matter within a run.
5. `import_preview`. Read `counts`, `taxonomy` and `issues` to the user, then ask to continue.
6. `import_commit`. If the run is `committing`, poll `import_status`.

### "Re-run weekly from GitHub issues"

Use `source: "github-issues"` and the issue number as `externalId`, and repeat the same recipe each week. Records seen
before are matched by `source` plus `externalId`, so only new issues, comments and votes are created and changed titles
or bodies update. Anything the team edited in Veerify in the meantime is kept (see `kept` in the preview). Closed or
deleted issues are not removed from Veerify.

## 7. Coverage of the API

Every non-exempt route must carry an `@openapi` block; `yarn openapi:check` (run in CI) enforces this, and
`search_api` is built from it. Run `yarn openapi:generate` to rebuild the spec.
