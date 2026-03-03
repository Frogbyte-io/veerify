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
- [ ] **Email notification subscription** — Allow users/anonymous submitters to subscribe to a feedback item for state-change and comment notifications; implement notification dispatch on status change and new public comment

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
- [ ] Notifications infrastructure (real-time or polling for in-app notifications)
- [ ] Create embeddable widgets for customers to add to their own website
- [ ] Migrate to Nuxt 4
- [x] Anti-spam: IP-based rate limiting, duplicate content detection, user reputation scoring, CAPTCHA (optional)
  - Implemented sliding-window in-memory rate limiter in `server/utils/rate-limit.ts`; applied strict (5/min) on public feedback submission, relaxed (100/min) on votes, and standard (60/min) on comment posting. Swap the in-memory store for a Redis backend (e.g. Upstash) in multi-instance deployments.
- [ ] Review and harden HTML sanitization for user-submitted content; audit for SQL injection risks

- [ ] Discord Bot — notify on new feedback; submit feedback via `/feedback` slash command
- [ ] Polls / feature suggestions with yay-or-nay vote
- [ ] Integrations with form providers (Tally, Jotform, Google Forms, etc.)
- [ ] Simple form website for collecting feedback publicly and adding it to the board without a public board (for internal use or private feedback collection)
- [ ] For the new product form, add options between what type of product to create, like public feedback board, private feedback collection form, or in the future roadmaps/etc.. Make it a multi-step guide that explains the different options and helps users choose the right one for their needs. Different features can be combined based on the product type (e.g. a public feedback board would have voting and commenting enabled, while a private feedback form would just collect submissions from a third party form without showing them publicly).
- [ ] Export feedback to Google Sheets / Excel / Airtable
- [x] Roadmap page — public timeline view based on feedback status tags
  - Added `/roadmap` sub-page on public boards (e.g. `team.veerify.com/project-slug/roadmap`); new `GET /api/public/t/[teamSlug]/[projectSlug]/roadmap` endpoint returns feedback items grouped by status; `PublicRoadmap.vue` renders a horizontal kanban-style view with status columns; tab navigation added to `PublicFeedbackBoard.vue` linking to the roadmap.
- [ ] Sync roadmaps to GitHub Projects
- [ ] Customizable vote style (thumbs, arrows, ducks, rockets, etc.)
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

- [ ] Add ability on public feedback items to subscribe to a feedback to get notified when there are updates. For anonymous this should open a prompt for email, and for logged in users this should open a modal where they can select between email and app notifications. If app notifications has not been enabled, it should prompt for access before toggling the button.

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
