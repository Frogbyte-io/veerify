## 📥 Inbox

_New ideas land here automatically from Discord #veerify-ideas. Move them to the right section when triaged._

- [ ] Add language selection using i18n

MVP

### Customers (Dashboard)

- [x] **Banner customization** — Add banner image/URL field to `ProductSettingsAppearance` and render it on the public board header
- [x] **Dark/Light mode toggle for public board** — Add theme mode setting (dark/light/system) to `ProductSettingsAppearance`; apply it to the public feedback board page
- [x] **GitHub issue creation from feedback** — `POST /api/github/issues` is a 501 stub; implement full flow: verify feedback, get GitHub token, create issue with labels, store link in `githubIssueLink` table
- [x] **GitHub settings in product settings** — Add a "GitHub" tab to `pages/products/[slug].vue`; allow user to connect a GitHub repo (OAuth token, owner/repo); save to `githubIntegration` table
- [x] **Auto-create GitHub issues toggle** — UI toggle in GitHub product settings that sets `githubIntegration.autoCreateIssues`; wire up the feedback creation flow to create an issue automatically when enabled
- [x] **Auto-add labels on GitHub issue close** — Finish `server/api/github/webhook.post.ts`: when an issue is closed, update feedback status to `completed` and add the configured label back to the issue if needed
  - Implemented `issues.closed` webhook handling in `server/api/github/webhook.post.ts`, with signature verification helpers in `server/utils/github-webhook.ts` and coverage in `tests/github-webhook-utils.test.ts`.

### Users (Public Board)

- [x] **Feedback submission confirmation email** — Send a confirmation email to the submitter when they submit feedback (if email provided), including a tokenized edit link
- [x] **Edit feedback from confirmation email** — Create a token-based edit endpoint (`GET/PUT /api/feedback/[id]/edit?token=...`) and edit page so submitters can update their feedback via email link
- [ ] **File/image/log attachments** — Add file upload support to the feedback submission form; store files (S3/local) and reference them from the feedback record
- [x] **Email notification subscription** — Allow users/anonymous submitters to subscribe to a feedback item for state-change and comment notifications; implement notification dispatch on status change and new public comment
  - Added `feedbackSubscription` table (migration `0014_medical_jamie_braddock.sql`). `POST/DELETE /api/feedback/[id]/subscribe` handle subscribe/unsubscribe; `GET /api/feedback/[id]/unsubscribe?token=` handles one-click email links. Status-change and new-comment notifications are dispatched fire-and-forget in `status.patch.ts` and `comments.post.ts`. Three email templates added. UI: logged-in users get a one-click toggle; anonymous users see an inline email prompt with a confirmation message.

### Implementation

- [x] **Anti-spam: cookie/localStorage vote tracking** — Supplement the anonymous session with a cookie/localStorage record on the client so a page refresh doesn't allow re-voting before the session expires
- [x] **GitHub OAuth repo-selection flow** — In the GitHub product settings tab, trigger GitHub OAuth (with `repo` or `public_repo` scope), exchange for a token, and let the user pick which repo to link
- [x] **Iframe embed** — Generate an embeddable `<iframe>` snippet for the public board and display it in product settings (domain tab or a new "Embed" tab)

### Infrastructure

- [ ] Set up full test infrastructure
- [x] Send email when custom domain has been verified/connected
  - Added connected/verified domain email templates and wired notifications in `server/api/projects/[slug].put.ts` and `server/api/projects/[slug]/verify-domain.get.ts` with per-domain dedupe markers in project settings.
- [x] Allow users to create an account or log in directly from the public feedback board (top-right button)
- [x] Add REST API docs UI (`/api/openapi.json` exists; add Scalar or Swagger UI)
  - Added Scalar docs route at `/api-docs` via `nuxt.config.ts`, documented in `README.md`, and covered by `tests/e2e/api-docs.spec.ts`.
- [x] Notifications infrastructure (real-time or polling for in-app notifications)
  - Added `notification` table (migration `0017_wealthy_captain_midlands.sql`) and `settings` jsonb column on `user` for notification preferences. `server/utils/notifications.ts` utility creates notifications respecting user preferences. CRUD API at `server/api/notifications/` (list with cursor pagination, mark read, delete, unread count, preferences GET/PUT). Trigger points wired: new feedback, status change, and new comment create in-app notifications for project team members. `NotificationBell` component in dashboard header with polling (30s), dropdown list, mark-read on click, and dismiss. `SettingsNotifications` rewritten with real preference toggles (email, in-app, per-type: new feedback, status changes, comments).
- [ ] Create embeddable widgets for customers to add to their own website
- [ ] Migrate to Nuxt 4
- [x] Anti-spam: IP-based rate limiting, duplicate content detection, user reputation scoring, CAPTCHA (optional)
  - Implemented sliding-window in-memory rate limiter in `server/utils/rate-limit.ts`; applied strict (5/min) on public feedback submission, relaxed (100/min) on votes, and standard (60/min) on comment posting. Swap the in-memory store for a Redis backend (e.g. Upstash) in multi-instance deployments.
- [x] Review and harden HTML sanitization for user-submitted content; audit for SQL injection risks
  - Added `escapeHtml()` helper in `lib/email-templates.ts`; applied to all user-controlled values (`authorName`, `feedbackTitle`, `projectName`, `name`, `domain`, and server-generated URLs) interpolated into HTML email bodies across all six template functions. Added `escapeHtml()` method in `components/products/ProductSettingsDomain.vue` and applied it to the user-supplied custom domain (`host`) and CNAME target (`cname`) interpolated into `v-html` provider step strings. SQL injection risk is already mitigated by Drizzle ORM's parameterized queries throughout; no raw SQL concatenation found. Vue template interpolation (`{{ }}`) is safe by default.

- [ ] Discord Bot — notify on new feedback; submit feedback via `/feedback` slash command
- [ ] Polls / feature suggestions with yay-or-nay vote
- [ ] Integrations with form providers (Tally, Jotform, Google Forms, etc.)
- [ ] Simple form website for collecting feedback publicly and adding it to the board without a public board (for internal use or private feedback collection)
- [ ] For the new product form, add options between what type of product to create, like public feedback board, private feedback collection form, or in the future roadmaps/etc.. Make it a multi-step guide that explains the different options and helps users choose the right one for their needs. Different features can be combined based on the product type (e.g. a public feedback board would have voting and commenting enabled, while a private feedback form would just collect submissions from a third party form without showing them publicly).
- [x] Export feedback to Google Sheets / Excel / Airtable
  - Added CSV export endpoint at `GET /api/feedback/export` (authenticated, supports all existing filters). Export button added to `pages/feedback/index.vue` toolbar; downloads a `.csv` file with title, status, category, product, votes, comments, author, GitHub issue link, and timestamps.
- [x] Roadmap page — public timeline view based on feedback status tags
  - Added `/roadmap` sub-page on public boards (e.g. `team.veerify.io/project-slug/roadmap`); new `GET /api/public/t/[teamSlug]/[projectSlug]/roadmap` endpoint returns feedback items grouped by status; `PublicRoadmap.vue` renders a horizontal kanban-style view with status columns; tab navigation added to `PublicFeedbackBoard.vue` linking to the roadmap.
- [ ] Sync roadmaps to GitHub Projects
- [x] Customizable vote style (thumbs, arrows, ducks, rockets, etc.)
  - Added `voteStyle` setting (arrows/thumbs/rockets/hearts) to project appearance settings. Vote icons on the public board are now driven by this setting. Configured in `ProductSettingsAppearance.vue` and rendered dynamically via a `voteIcons` computed in `PublicFeedbackBoard.vue`; validated server-side in `server/api/projects/[slug].put.ts`.
- [x] When creating a feedback item, it should be automatically upvoted by the submitter (if anonymous, use the session; if logged in, use their user ID) so it appears in the board without needing a second click
- [x] Add a "Feedback" tab to the product settings page that shows a list of all feedback items with filters (status, tags, etc.) and search
  - Added `ProductSettingsFeedback.vue` with search, status/category/sort filters, paginated feedback list, inline status updates, and GitHub issue links. Wired into `pages/products/[slug].vue` as the second tab.
- [x] Allow product admins to add and change status tags (e.g. "planned", "in progress", "completed")
  - Added `feedbackStatus` table (migration `0013_redundant_micromax.sql`) for per-project custom statuses. CRUD API routes at `server/api/projects/[slug]/statuses/`. New `ProductSettingsStatuses.vue` tab with drag-to-reorder, create/edit/delete dialogs, and fallback to system defaults when no custom statuses are configured. `ProductSettingsFeedback.vue` now loads statuses dynamically for both the filter dropdown and inline status-change select.
- [x] Show icon besides the feedback category on the public board (e.g. a bug icon for bug reports, a lightbulb for feature requests, etc.) when icon is added to the category
  - Rendered category icons in `components/public/PublicFeedbackBoard.vue` and added e2e coverage in `tests/e2e/anonymous-feedback.spec.ts`.
- [x] In public feedback board, it should be possible to click a feedback to see more details (description, comments, etc.) in a modal or separate page without leaving the board
  - Added clickable feedback cards in `components/public/PublicFeedbackBoard.vue` that open a details dialog with full description and comments, with e2e coverage in `tests/e2e/anonymous-feedback.spec.ts`.
- [x] Move powered by verify to the very bottom of the page and make it smaller. Change domain to veerify.io
- [x] Add a GitHub mention link to the footer of the public board for users to easily report issues with the board itself, and to see the source code. Mention that it is open source and contributions are welcome.
- [x] Add a link to veerify's own public feedback board in the footer of the public board, so users can see an example of a feedback board and submit feedback about veerify itself.
  - Added footer link in `components/public/PublicFeedbackBoard.vue` (`public-footer-veerify-board`) with coverage updates in `tests/e2e/anonymous-feedback.spec.ts`.

- [x] When refreshing in a personal account, the sidebar renders the items for the organization instead of the personal account. This is because the sidebar is rendered before we fetch the user data and determine if it's a personal or org account. We should either fetch the user data earlier or make the sidebar more resilient to this case.

- [x] Add hover effect to products in products page to indicate they are clickable

- [x] For the billing page, please add a contacts section where it is possible to add additional emails that will be on copy when the bill/receipt is sent out.
  - Added editable billing contact emails in `components/settings/SettingsBilling.vue`, persisted to organization `settings.billingCcEmails` via `server/api/orgs/[slug].put.ts`, with e2e coverage in `tests/e2e/organization-settings.spec.ts`.

- [x] Workspace icon for when the sidebar is collapsed is not centered in the sidebar. Please center it.

- [x] When on a public board on a custom domain or subdomain but I am logged in to the dashboard on the main domain, it should show that I am logged in and allow me to access the dashboard from the public board. Currently, it shows that I am not logged in and when I click the login button, it takes me to the main domain login page instead of showing a login modal on the public board. We should either show a login modal on the public board or redirect to the main domain login page and then back to the public board after login.
  - Added safe absolute redirect handling in login/signup (including GitHub auth) and a server allowlist endpoint (`/api/public/auth/redirect-allowed`) that permits only app-domain hosts and configured public custom domains.

- [x] The toggle in product settings to show or not show the powered by veerify badge on the public board is currently updating on public boards. It should hide the badge when toggled off and show it when toggled on. Please also add option to toggle Github footer as well.

- [x] Add option to create a custom footer for public feedback boards, where customers can add their own text, links, and branding instead of the default "Powered by Veerify" badge. This would allow customers to fully white-label the public board experience if they choose to.
  - Added custom footer settings and rendering in `components/products/ProductSettingsAppearance.vue` and `components/public/PublicFeedbackBoard.vue`, with API validation in `server/api/projects/[slug].put.ts` and e2e coverage in `tests/e2e/anonymous-feedback.spec.ts`.

- [x] Feedback page for a product should default to a Kanban style board instead
  - Replaced list rendering in `pages/feedback/index.vue` with a Kanban-first board and updated e2e selectors/assertions in `tests/e2e/helpers/selectors.ts` and `tests/e2e/admin-feedback.spec.ts`.

- [x] We want to have a home page for the entire project, hosted on veerify.io. Please change the main domain for the dashboard to app.veerify.io, so we can host a separate site for the homepage.
  - Added dedicated dashboard-domain config (`APP_DASHBOARD_DOMAIN`) and runtime usage in `nuxt.config.ts`, `server/middleware/subdomain.ts`, and `components/public/PublicFeedbackBoard.vue`, plus env/docs updates in `.env.example` and `README.md`.

- [x] Add ability on public feedback items to subscribe to a feedback to get notified when there are updates. For anonymous this should open a prompt for email, and for logged in users this should open a modal where they can select between email and app notifications. If app notifications has not been enabled, it should prompt for access before toggling the button.
  - Implemented via the Email notification subscription feature above. App notifications deferred to the Notifications infrastructure item.

- [x] Add selection between table view of feedback items, and Kanban view. Feedback table view should have a compact view of all feedback items, just like the github projects tool, with links and issues number, or a create github issue button if it does not exist as a github issue. The github issue column should only appear if github issues feature is set up.

- [x] Add option to select multiple feedback products to see feedback from, in addition to a ALL checkbox that checks all feedback products.

- [x] In feedback kanban view, add drag and drop sorting of items.

- [x] In feedback kanban view, remove status and sort by as they are not needed in kanban view

- [x] In product settings feedback categories, add drag and drop sorting on which feedback category should appear first.
  - Added drag handles and drop targets in `components/products/ProductSettingsCategories.vue`, persisting `sortOrder` via category `PUT` updates, with reorder API coverage in `tests/e2e/team-primary-workspace.spec.ts`.

- [x] Add Organization avatar image to the organization settings, with file upload using the S3 bucket

- [x] For the Visibility - Control who can see and submit feedback to your product setting in general, add a copy URL button.
  - Added a `Copy URL` action in `components/products/ProductSettingsGeneral.vue` (`project-visibility-copy-url`) that copies the computed public board URL.

- [x] In product settings Apperance, Improve the look of the File picker - use shadcn if a component exist or make a better one, and add preview of the image that is selected.
  - Implemented styled upload inputs and preview handling in `components/products/ProductSettingsAppearance.vue`.

- [x] For the Public Feedback Page, add banner image and logo to the public feedback page and use that is uploaded for that project, or if user has not uploaded logo or banner show a default look. like today.
  - Public banner/logo rendering and fallback behavior is implemented in `components/public/PublicFeedbackBoard.vue`; fallback-aware assertions were updated in `tests/e2e/anonymous-feedback.spec.ts`.

- [x] Allow resizing of sidebar.

- [x] For the feedback board, please replace the product selector with a dropdown that allows you to select multiple products to view feedback from, Use checkboxes, and let the dropdown stay open while selecting multiple products. Also add an All checkbox that selects all products.

- [x] For the add feedback modal form, please make it more of a guided form with multiple steps. First step should be to select the type of feedback (bug report, feature request, etc.), then the next step should be to add the details of the feedback (title, description, attachments, etc.). This will make it easier for users to submit feedback and ensure that they provide all the necessary information.

- [x] For the feedbacks, add ability to downvote feedback in addition to upvote, and show the total votes (upvotes - downvotes) on the feedback card. This will allow users to express disagreement with feedback and help surface the most popular feedback more accurately.
  - Added `type` column to `vote` table (migration `0012_steep_scorpion.sql`); vote API handles toggle/switch; public board and detail page show paired up/down buttons with net score.

- [x] For the public feedback board, add a filter option to filter feedback by category, status, or tags. This will allow users to easily find feedback that is relevant to them and help them navigate the board more effectively.
  - Added tag filtering (based on `metadata.feedbackType`) in `server/api/public/t/[teamSlug]/[projectSlug]/feedback.get.ts`, wired filter controls in `components/public/PublicFeedbackBoard.vue`, and covered end-to-end behavior in `tests/e2e/anonymous-feedback.spec.ts`.

- [x] For the public feedback board, please add infinite scrolling with lazy loading of feedback items as the user scrolls down, instead of paginating with a "Load more" button. This will create a smoother browsing experience and allow users to easily explore more feedback without interruption.
  - Replaced Previous/Next pagination with an `IntersectionObserver` sentinel at the bottom of the list. Filter/sort changes reset to page 1 (skeleton shown); subsequent pages append via `loadMore()` with a spinner indicator.

- [x] For the public feedback board, please reduce the size of the banner, and increase the space below the bottom feedback so it is possible to scroll the banner up and see it fully without the feedback cards covering it. This will improve the visibility of the banner and make the board look less cramped.
  - Reduced banner from `h-48 md:h-64` to `h-24 md:h-36`; inner parallax layer drifts at 25% of scroll speed (capped 30px); added `pb-32` scroll buffer below feedback list.

- [x] For the public feedback board, please add a pinning feature, so that product admins can pin important feedback items to the top of the board. This will allow them to highlight key feedback and ensure it gets the attention it deserves.
  - Pinned items now sort to top via `isPinned DESC` in `server/api/feedback/index.get.ts`; pin icon indicator added to cards in `components/public/PublicFeedbackBoard.vue`; list reloads after pin toggle for correct sort order.

- [x] For the public feedback board, please add the ability for comment posters to edit or delete their comments within a certain time window (e.g. 15 minutes after posting). This will allow users to correct mistakes or remove comments they no longer want visible, while still maintaining the integrity of the discussion. After the time window has passed, comments should be locked from editing to prevent abuse.
  - Added `PATCH` and `DELETE` endpoints at `server/api/feedback/[id]/comments/[commentId]` with a 15-minute window check and authorship validation (user ID or anon session). The GET comments endpoint now returns `canEdit: true` for eligible comments. `PublicFeedbackBoard.vue` renders inline pencil/trash buttons on editable comments with an inline edit textarea.

- [x] For the private feedback collection at /feedback, everything resizes and changes when I switch between the list view and the kanban view. Please make it so that the filters, search bar, and other UI elements stay consistent and in the same place when switching between views, to create a smoother experience.
  - Added a persistent search bar (always visible in both views, debounced server-side search on title/body); status and sort selects now use `invisible` CSS to preserve toolbar height in kanban mode instead of `v-if`; wired `search` param in the feedback GET API.

- [x] For the private feedback collection at /feedback, the add feedback button should still work, but if multiple products are selected in the product filter dropdown, it should ask which product the feedback is for when I click the add feedback button.
  - Two-step dialog: scrollable project-card picker (step 1, skipped for single product) → feedback form (step 2); Back button returns to step 1 in multi-product mode.

- [x] Detect between self hosted and cloud based on env variables. if locally hosted, replace the billing tab with a "Status" tab that shows the status of different services (database, storage, etc.) and any errors or warnings related to them. This will help self-hosted users monitor the health of their instance and troubleshoot any issues that arise.
  - Added deployment mode runtime config via `APP_DEPLOYMENT_MODE` (with auto-detection fallback), `SettingsStatus` UI in `components/settings/SettingsStatus.vue`, and service checks in `server/api/system/status.get.ts`. Settings now swaps Billing->Status for self-hosted mode in `pages/settings/index.vue`, with e2e coverage in `tests/e2e/organization-settings.spec.ts`.

---

## Technical Debt

- [x] **#4 — Validate feedback status against project's allowed statuses**
      `server/api/feedback/[id]/status.patch.ts` accepts any string up to 80 chars. Validate that the provided status actually exists in the project's `feedbackStatus` table before applying it.

- [x] **#5 — Tighten rate limiting on anonymous feedback submission**
      `server/api/feedback/index.post.ts` already applies `rateLimits.strict` (5/min) for anonymous requests and `rateLimits.standard` (60/min) for authenticated users.

- [x] **#6 — Require UPLOAD_TOKEN_SECRET as a hard requirement**
      Removed `BETTER_AUTH_SECRET` fallback from `nuxt.config.ts`; added Nitro server plugin `server/plugins/validate-env.ts` that refuses to start if `UPLOAD_TOKEN_SECRET` is missing; updated `.env.example` to document it as required.

- [x] **#7 — Add composite database indexes for common query patterns**
      Added `feedback_project_created_at_idx` on `(projectId, createdAt)` for paginated feedback lists and `comment_feedback_created_at_idx` on `(feedbackId, createdAt)` for threaded comment sorting. Migration `0016_unknown_sentinel.sql`.

- [x] **#8 — Replace `as any` header casts with `getRequestHeaders()`**
      All auth header access already uses `getAuthHeaders(event)` (which wraps `getRequestHeaders`). No `as any` header casts remain in server code.

- [x] **#9 — Replace `console.error()` with structured logging**
      Introduced `server/utils/logger.ts` using `consola` (already shipped with Nuxt). All `console.error()` calls in server and lib code replaced with structured `logger.error()` calls that include context objects (feedbackId, userId, projectName, key, etc.). Each module creates a tagged child logger (e.g. `feedback`, `github`, `db`, `auth`) for easy filtering.

- [ ] **#10 — Sidebar visibility rules are inconsistent between nav items**
      `AppSidebar.vue`'s `personalItems` computed conditionally hides `Dashboard` based on `hasActiveOrganization`, while `Roadmap`/`Changelog` are permanently `disabled: true` regardless of state, and everything else is either always shown or gated on the `hasActiveOrganization === true` block. Three different rules for "should this nav item show" in one component. Surfaced while designing Stage 09b (Home) in the support-platform plan — worth auditing once Home ships, since it adds a fourth item with its own visibility rule.

- [ ] **#11 — Roadmap and Changelog sidebar entries are permanently disabled, not state-gated**
      `feedbackItems` in `AppSidebar.vue` hardcodes `disabled: true` on `Roadmap` and `Changelog` unconditionally — not "disabled until a feature is enabled," just disabled. A user clicking either sees a dead nav item with no explanation of why or whether it will ever work. Either wire them to real state (they are already real, shippable features per `TODO.md`'s MVP section) or remove them until they are.

- [ ] **#12 — No UI to switch between organizations, only teams within one**
      `TeamSwitcher.vue` lets a user switch teams inside the active organization but has no affordance for moving to a _different_ organization the user belongs to. If a user is a member of more than one organization there is currently no visible way to change which one is active from the sidebar. Worth scoping properly (where does org switching live — same picker, a separate control?) rather than folding into the support-platform Home work, since it is a pre-existing gap unrelated to support.

## Support Platform — Stage 00: Foundations

Plan: `docs/plans/2026-08-11-support-platform/stage-00-foundations.md`. Read `design.md` in the same
directory first. Infrastructure only — no support tables, endpoints, or UI in this stage.

- [x] **SUP-00-1** Split `server/database/schema/feedback.ts` into `feedback.ts`, `notifications.ts`, `imports.ts`, `changelog.ts`; add empty `support.ts`; re-export from `index.ts`; verify `yarn db:generate` emits no migration
  - `bd31097`: `notification` extracted to `notifications.ts`, empty `support.ts` added, `yarn db:generate` confirmed to emit no migration.
  - `imports.ts` and `changelog.ts` are **not part of this branch**. The `importRun`/`importRunIssue`/`changelogPost` tables and the feature built on them live on `sleekplan-export`, where that split is already done. Nothing further is owed here.
- [x] **SUP-00-2** Add `server/services/realtime/` with `types.ts`, `redis.ts` (ioredis, separate pub/sub connections), `memory.ts`, and driver selection; versioned thin envelopes; unit tests for envelope routing
  - `26d1847`. Driver written against the Redis wire protocol via `ioredis`, not a vendor SDK, so Upstash and Valkey are the same code behind one `REDIS_URL`. `sanitizeEnvelope()` strips unknown keys, enforcing "identifiers only, never record contents" in code rather than by convention. 18 unit tests.
- [x] **SUP-00-3** Rewrite `server/utils/ws-connections.ts` for channel subscriptions (`team:`, `inbox:`, `conversation:`, `user:`) with subscribe-time authorization; keep existing notification delivery working
  - `cdd56dd`. Authorization in `server/utils/realtime-channels.ts`, checked at subscribe time and failing closed. `inbox:`/`conversation:` deny until Stage 02 supplies the tables. Peers capped at 50 channels. Legacy `sendToUser` retained unchanged — see SUP-00-9.
- [x] **SUP-00-4** Add client realtime helper: reconnect with backoff, resubscribe, refetch-on-reconnect, idle-disconnect after 5 min with refetch-on-focus
  - `lib/realtime-client.ts` (framework-agnostic, injectable socket/timer seams) + `plugins/realtime.client.ts` exposing `this.$realtime`. Reference-counted subscriptions, backoff with jitter, idle disconnect at 5 min, no retry on close code 4001. 13 tests using fake timers. `NotificationBell.vue` deliberately untouched — that is SUP-00-9.
- [x] **SUP-00-5** Add a store adapter to `server/utils/rate-limit.ts` (`memory` | `redis`) reusing the Redis connection; no call-site changes
  - Also delivered delta D-06: `server/services/redis/client.ts` is now the single ioredis factory, shared by the realtime publisher and the limiter, so enabling both does not double connection count. Redis sliding window is a Lua script over a sorted set (atomic, one round trip). **Fails open** — a Redis outage allows requests rather than taking down the public API. All 15 call sites unchanged.
- [x] **SUP-00-6** Add `server/services/scheduler/` with Vercel Cron and Nitro scheduled-task backends behind one registration API; no tasks registered yet
  - Merged from `agent/SUP-00-6-scheduler-r2` (branch name collision with a dead worktree — see delta D-11). Cron endpoints verify `CRON_SECRET` with a length-checked `timingSafeEqual` and fail closed before touching the registry; task name is baked in per route so callers cannot probe for arbitrary tasks. 18 tests.
- [x] **SUP-00-7** Add `Dockerfile` + `.dockerignore`; extend production `docker-compose.yml` with `app`, `valkey`, `minio`, and Caddy on-demand TLS; add `valkey` to dev compose; document the VM path in `README.md`
  - Merged from `agent/SUP-00-7-docker-r2`. Dockerfile deliberately runs `yarn nuxt build`, not `yarn build` — the latter's `postbuild` hook runs `scripts/seed.ts`, which creates fixed-password test accounts that must never reach a production image. Caddy `on_demand_tls` is gated behind an `ask` endpoint. `.gitattributes` forces LF on `*.sh` and `Caddyfile` so a CRLF shebang cannot break `/bin/sh` in the container.
  - `docker build` **independently verified** by the orchestrator: exit 0, image 1.76 GB, `docker inspect` confirms `User=nuxt` (uid 100, non-root), `Entrypoint=[docker-entrypoint.sh]`, `Cmd=[node .output/server/index.mjs]`. Ran the image and confirmed `.output/server/index.mjs`, `server/database/migrations`, and `node_modules/.bin/drizzle-kit` are all present so the entrypoint can actually migrate. Test image removed afterwards.
- [x] **SUP-00-10** Add `GET /api/system/tls-ask` — the Caddy on-demand TLS validation endpoint
  - `032c5b5`. Board entry was stale — the file exists and survived the `sleekplan-export` split untouched.
  - Implement with `findPublicProjectByDomain()` from `server/utils/project-access.ts`: return 200 only for hostnames configured as a project custom domain or a team subdomain, 404 otherwise. Must be unauthenticated (Caddy has no session) and cheap — it is called per unknown-host TLS handshake, so it needs its own rate limit.
- [x] **SUP-00-8** Update `.env.example` (`REDIS_URL`, `REALTIME_DRIVER`, `RATE_LIMIT_STORE`) and `docs/agent/context-map.md`
  - `c1b603a`. Also added `CRON_SECRET`, which SUP-00-6 introduced. Note it is effectively required on cloud: the cron endpoints fail closed, so an unset secret means every scheduled task returns 401 and silently never runs. Docker-specific vars land with SUP-00-7.
- [x] **SUP-00-10** Add `GET /api/system/tls-ask` — the Caddy on-demand TLS validation endpoint
  - `032c5b5`. Allows exactly three cases: the dashboard host, a team subdomain whose team exists, and a public project custom domain. Hostname parsing extracted to `server/utils/tls-ask.ts` with 12 tests covering non-DNS characters, empty labels, suffix matches that are not subdomain boundaries, and nested labels.
- [x] **SUP-00-9** Migrate `NotificationBell.vue` off direct WS payloads onto the channel system: publish a thin envelope on `user:<id>` and have the client refetch the list and unread count instead of unshifting `msg.data`
  - `b6404a9` + `3b0ab10`. Envelopes are now scoped by channel rather than requiring a `teamId`, so `user:<id>` events are expressible; `publishRealtime` also refuses cross-channel publishes, which is stronger than Stage 00 originally specified. Peers auto-subscribe to their own user channel using the id from the validated session, so the client never sends its own id.
  - The legacy per-user path (`sendToUser`, `addConnection`, `removeConnection`, the `userConnections` map) is **deleted**, not deprecated — notifications now cross instances. The 30s polling remains as a connect-failure fallback but is no longer load-bearing.
  - Surfaced during SUP-00-3. `sendToUser()` pushes full notification objects, which the envelope design disallows, so it was left in place unchanged. Its in-memory map is process-local, so notifications still do not cross instances — the component's 30s polling fallback is load-bearing until this lands and must not be removed before then.
  - Needs a decision on scope: the `notification` table has no `teamId`, so either the envelope's `teamId` becomes optional for user-scoped events, or notifications gain a team scope.

## Support Platform — Stage 01: Contact identity

Plan: `docs/plans/2026-08-11-support-platform/stage-01-contacts.md`. Read `design.md` and `deltas.md`
first. Integration branch is **`support-platform`**, not `main` (delta D-17).

**Hard constraint:** `server/database/schema/feedback.ts` gets no `contactId`, no backfill, and no data
migration. The single permitted change is an index on `authorEmail`. See "Why contacts and feedback stay
separate" in `design.md`.

- [x] **SUP-01-1** Add `contact`, `contactIdentity`, `supportCompany`, `contactLink` to `server/database/schema/support.ts` with all indexes; generate migration; add index on `feedback.authorEmail`
- [x] **SUP-01-2** Add `requireContactAccess` to `server/utils/support-access.ts`; unit tests for the 404/403 split
- [x] **SUP-01-3** Add contact CRUD endpoints (list, create, get, update, delete) with team scoping and cursor pagination
- [x] **SUP-01-4** Add `POST /api/support/contacts/[id]/merge` with transactional repointing and tombstone; unit tests for collision and self-merge cases
- [x] **SUP-01-10** Correct Stage 01 integrity and concurrency: validate same-team `companyId` on create/update; use a validated `(createdAt, id)` cursor; lock and revalidate both merge contacts inside one transaction; add PostgreSQL-backed endpoint tests.
  - `3360f98`, `b25525f`, `ab6fdb2`: same-team company checks, opaque stable cursor, locked/revalidated merge and tombstone update guards, plus focused and guarded PostgreSQL E2E coverage. Independent review approved after two fix rounds.
- [x] **SUP-01-5** Add `supportTeamSettings` (`teamId` primary key, `autoLinkFeedback` default `false`, timestamps) and `GET /api/support/contacts/[id]/timeline` returning `linked` and `probableFeedback` separately, plus link/unlink endpoints. Changing this team-scoped setting requires team membership.
  - `d97812f`, merged in `6e30379`. `buildContactTimeline()` in `server/utils/support-timeline.ts` dedupes: a feedback item that is explicitly linked is excluded from `probableFeedback`, so it can never appear in both sections. Link creation locks the contact row and validates the target feedback is in the same team before inserting.
- [x] **SUP-01-6** Add `supportCompany` CRUD endpoints
  - `c3b3060`. Mirrors the contact CRUD conventions; `requireCompanyAccess` added to support-access.ts. `server/utils/list-cursor.ts` extracted so the cursor logic is shared with contacts rather than duplicated.
- [x] **SUP-01-7** Build `/support/contacts` list page (search, pagination, skeletons, error retry)
  - `04e9a8e`. Manual 300ms debounce (no external dep, matches the rest of the codebase), cursor-based Load more, reacts to team switches via the existing `veerify:active-team-changed` event.
- [x] **SUP-01-8** Build `/support/contacts/[id]` detail page: attributes, identities, timeline with visually distinct Linked vs Possible matches, one-click link, merge dialog
  - `04e9a8e`. Possible matches renders in a dashed amber-tinted panel with an explicit "not confirmed" caption — deliberately unmistakable, not merely different, from Linked. Verified end-to-end against a live dev server and database: created a contact, inserted a feedback row with a matching email, confirmed it surfaced as a probable match, linked it, confirmed it moved to Linked and vanished from Possible matches, unlinked, confirmed it reverted, then merged two contacts and confirmed backfill semantics. No browser preview was available in this environment, so this was verified via authenticated curl against the real API plus SSR HTML fetches of both pages — not a visual check.
- [x] **SUP-01-9** Register support contact routes in `server/utils/openapi.ts`
  - `e01ac73`. `openapi.ts` turned out to have no route registry (delta D-23) — hand-transcribed the 9 support path templates into `openapi.json.get.ts` instead, matching the source JSDoc exactly. Verified by fetching `/api/openapi.json` from a running server: valid JSON, all 9 paths present. Real fix (build-time JSDoc scanner, repo-wide) queued as SUP-X-3.

**Stage 01 complete.** All items SUP-01-1 through SUP-01-9 done.

## Support Platform — Cross-cutting

- [x] **SUP-X-1** Add a guarded Redis integration suite (delta D-15). Nothing currently exercises the Redis driver or the Lua rate-limit script against a real server — only the memory driver and fakes. Skip when no `REDIS_URL` is reachable, following the `test:e2e:if-available` pattern
  - `a751c6a`. `tests/integration/redis.test.ts` against real Valkey: cross-instance publish/subscribe, channel isolation, reconnect-and-resubscribe (via `CLIENT KILL TYPE pubsub`), rate-limit atomicity under 25 concurrent requests, window expiry, fail-open. Runs by default whenever Redis is reachable — not restricted to cloud/CI like the Playwright guard. All 6 pass against a real server.
- [x] **SUP-X-2** Gate `scripts/seed.ts` behind an explicit env flag (delta D-13). `yarn build` runs `postbuild` → seed, which creates `test@preview.local` / `password123` in whatever database it points at
  - Board entry was stale. `productionSeedBlockReason()` in `scripts/seed.ts` refuses to run when `NODE_ENV=production` or `VERCEL_ENV=production`, with `ALLOW_PRODUCTION_SEED=true` as a deliberate override. Verified: blocks under both env vars, proceeds with the override set.
- [ ] **SUP-X-3** (repo-wide, not support-specific) Build a build-time scanner that parses the `@openapi` JSDoc blocks already present on 24 endpoint files — auth, github, orgs, and support — and merges them into `server/api/openapi.json.get.ts`'s served `paths`, replacing the hand-maintained duplicate added for support in SUP-01-9 (delta D-23). Must run at build time: a request-time filesystem scan of `server/api/**/*.ts` would work in dev and self-hosted but produce an empty spec on Vercel, where only compiled output ships. Add `js-yaml` as a direct dependency — currently present only transitively via eslint.
- [ ] **SUP-X-4** Restrict module enable/disable in the `/settings` Tools tab to team admins (delta D-28). Deferred deliberately: `teamMember.role` has `admin` and `member` with currently equivalent permissions, and `design.md` freezes those semantics. Would be the first real differentiation of that column. Read D-28 before acting — the freeze was about keeping _support_ permissions off `teamMember.role`, which is arguably a different question from workspace administration.

## Support Platform — Stage 02: Inbox + conversation core

Plan: `docs/plans/2026-08-11-support-platform/stage-02-conversation-core.md`. Read `design.md` and
`deltas.md` first. Integration branch is **`support-platform`**.

UI and configuration model settled 2026-08-14 (deltas D-26, D-27, D-28). Two surfaces, deliberately
separate: the **agent workspace** (`/support`, team-scoped, this stage) and the **customer entry point**
(per-product, public board, deferred to Stage 10).

- [x] **SUP-02-1** Add inbox and conversation tables to `server/database/schema/support.ts` with all indexes, including `supportInboxAddress` and the nullable `conversation.projectId`; generate migration
  - `019cf71`, merged `21ec059`. `supportInbox`, `supportInboxAddress`, `supportInboxMember`, `conversation` (with `projectId`), `supportCounter`, `conversationMessage`, `conversationAttachment`, `conversationParticipant`, `supportTag`/`conversationTag`, `supportEmailEvent` — 11 tables, 22 FKs, 27 indexes, migration `0022_lowly_machine_man.sql`. FK actions verified against `design.md` directly from the generated SQL (`restrict` on `conversation.inboxId`/`contactId`, `cascade` on team-owned rows, `set null` elsewhere). `design.md` had no column/index spec for `supportTag`/`conversationTag` beyond one line — filled in following the file's existing conventions; flagged for confirmation when the tag endpoints are built.
- [x] **SUP-02-2** Extend `server/utils/support-access.ts` with `requireInboxAccess`, `requireConversationAccess`, `resolveInboxByAddress`; unit tests including the team-admin bypass
  - `requireInboxAccess`: 404 if the inbox is missing, else allow on `supportInboxMember` row OR `teamMember.role === 'admin'` on the inbox's team (checks membership first, only queries team-admin if that misses). `requireConversationAccess` resolves the conversation then delegates to `requireInboxAccess` on its `inboxId`. `resolveInboxByAddress` matches `supportInboxAddress.address` case-insensitively and returns `{ inbox, address }` (not just the inbox) so Stage 03 gets the matched address's `projectId` for free without a second query; returns `null` on no match rather than throwing, per the stage doc's "don't 404 a mail provider" requirement. 21 unit tests in `tests/support-access.test.ts`, same queued-select stub pattern as the Stage 01 tests.
- [x] **SUP-02-3** Replace the unconditional deny branch for `inbox:`/`conversation:` in `server/utils/realtime-channels.ts` with real access checks; update `tests/realtime-channels.test.ts` (delta D-04)
  - `ChannelAuthDeps` gained `canAccessInbox`/`canAccessConversation`; the real implementations wrap `requireInboxAccess`/`requireConversationAccess` and collapse their 404/403 split to a boolean — that distinction is API-facing detail, not useful at subscribe time. 6 new tests; `yarn test` (170 tests), typecheck, and lint (0 errors) all green afterward.
- [x] **SUP-02-4** Implement `displayId` allocation via `supportCounter` with `SELECT … FOR UPDATE`; concurrency test with 100 parallel inserts
  - `server/utils/support-counter.ts` exports `allocateConversationDisplayId(tx, teamId)`, taking the transaction as a parameter — it must run inside the same transaction as the conversation insert, so the counter row's lock covers both writes. Existing-row path: `SELECT … FOR UPDATE` then `UPDATE … + 1`, matching the pattern already used in `contacts/[id]/merge.post.ts`. Bootstrap path (no counter row yet): `INSERT … ON CONFLICT DO NOTHING` claims `displayId` 1 outright; a transaction that loses that race falls through to the same `SELECT … FOR UPDATE` path, which Postgres blocks on until the winner commits, so it can't observe a half-written row. 4 unit tests against a hand-rolled fake `tx` (function takes `tx` as a parameter, so no module mock was needed) plus a new guarded Postgres integration test (`tests/integration/support-counter.test.ts`, `yarn test:integration:postgres:if-available`) that runs 100 real concurrent `db.transaction()` calls against a fixture team and asserts the results are exactly `{1..100}` with the counter row landing on 101 — verified live against `docker compose -f docker-compose-dev.yml up -d db`. Added a second dependency guard (`scripts/run-postgres-integration-if-available.mjs`) alongside the Redis one rather than folding into it, since a machine could have one dependency but not the other; both guards now target only their own file under `vitest.integration.config.ts` instead of the whole `tests/integration/` glob. Wired into `harness:verify` and `AGENTS.md`.
- [x] **SUP-02-5** Add inbox CRUD + membership endpoints
  - `GET/POST /api/support/inboxes`, `GET/PUT/DELETE /api/support/inboxes/[id]`, `GET/POST /api/support/inboxes/[id]/members`, `DELETE /api/support/inboxes/[id]/members/[memberId]`. No pagination on the list endpoint — a team's inboxes are a short settings list, not an open-ended feed, unlike contacts/companies. The creator is added as a `supportInboxMember` with role `admin` in the same transaction as inbox creation — otherwise a non-team-admin creator would create an inbox they immediately have no access to. Adding a member requires the target `userId` to already be a `teamMember` of the inbox's team (400 otherwise); who may call the add/remove endpoints is gated only by general inbox access (any role, or the team-admin bypass) — the stage doc does not specify finer-grained RBAC here, matching this stage's team-membership-only permission model elsewhere (delta D-28). Delete added `isForeignKeyViolation` to `support-errors.ts` (mirrors `isUniqueViolation`'s `.cause`-unwrapping) to turn the `conversation.inboxId` restrict FK into a clean 409 rather than a 500. PUT's `defaultAssigneeUserId` and `projectId` are validated same-team before write, matching the contact/company pattern. Channel/provider fields (`emailAddress`, `channelConfig`, auto-reply) are intentionally not in the PUT body — Stage 03 owns those per the stage doc. No unit tests per endpoint file, matching the existing convention for `companies`/`contacts` (covered by E2E once UI exists, SUP-02-17); instead verified live against a running dev server and real Postgres: full inbox lifecycle, duplicate-slug 409, cross-tenant 403, member add/duplicate-409/remove/access-revoked cycle, and the FK-restrict-delete 409 path (confirmed by hand-inserting a fixture conversation row, since conversation CRUD is SUP-02-7).
- [ ] **SUP-02-6** Add receiving-address endpoints with per-address product mapping and same-team `projectId` validation
- [ ] **SUP-02-7** Add conversation list/create/get/patch endpoints with filters (including product) and cursor pagination; emit `activity` messages on every status, priority, assignee, and product change
- [ ] **SUP-02-8** Add message, participant, and tag endpoints; publish thin realtime envelopes on `conversation:` and `inbox:` for every write
- [ ] **SUP-02-9** Build the `/support` three-pane UI: inbox switcher, filtered conversation list, thread pane rendering all four message kinds, contact drawer
- [ ] **SUP-02-10** Build the composer with an unmistakable reply/note toggle; messages stored only, not sent, in this stage
- [ ] **SUP-02-11** Rename the existing `Support` sidebar group to `System`; add a real `Support` group with Inbox and Contacts; add `/support` to `protectedRoutes`
- [ ] **SUP-02-12** Add the per-team Tools tab to `/settings` with module toggles driving sidebar visibility, replacing the hardcoded `disabled: true` Roadmap/Changelog placeholders. Team membership only — no `teamMember.role` check (delta D-28)
- [ ] **SUP-02-13** Implement module disable semantics: hide nav and stop inbound processing while preserving conversations and contacts
- [ ] **SUP-02-14** Build `/support/settings` with inbox name, signature, agent membership, and the receiving-address list with product mapping
- [ ] **SUP-02-15** Add `conversation_assigned` and `conversation_mention` notification types and preference toggles
- [ ] **SUP-02-16** Register support inbox and conversation routes in the OpenAPI spec (hand-transcribe into `openapi.json.get.ts` until SUP-X-3 lands)
- [ ] **SUP-02-17** Add E2E coverage: create conversation, reply, add note, change status, verify activity message and live update
