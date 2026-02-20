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
- [ ] **Auto-add labels on GitHub issue close** — Finish `server/api/github/webhook.post.ts`: when an issue is closed, update feedback status to `completed` and add the configured label back to the issue if needed

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
- [ ] Anti-spam: IP-based rate limiting, duplicate content detection, user reputation scoring, CAPTCHA (optional)
- [ ] Review and harden HTML sanitization for user-submitted content; audit for SQL injection risks

- [ ] Discord Bot — notify on new feedback; submit feedback via `/feedback` slash command
- [ ] Polls / feature suggestions with yay-or-nay vote
- [ ] Integrations with form providers (Tally, Jotform, Google Forms, etc.)
- [ ] Simple form website for collecting feedback publicly and adding it to the board without a public board (for internal use or private feedback collection)
- [ ] For the new product form, add options between what type of product to create, like public feedback board, private feedback collection form, or in the future roadmaps/etc.. Make it a multi-step guide that explains the different options and helps users choose the right one for their needs. Different features can be combined based on the product type (e.g. a public feedback board would have voting and commenting enabled, while a private feedback form would just collect submissions from a third party form without showing them publicly).
- [ ] Export feedback to Google Sheets / Excel / Airtable
- [ ] Roadmap page — public timeline view based on feedback status tags
- [ ] Sync roadmaps to GitHub Projects
- [ ] Customizable vote style (thumbs, arrows, ducks, rockets, etc.)
- [x] When creating a feedback item, it should be automatically upvoted by the submitter (if anonymous, use the session; if logged in, use their user ID) so it appears in the board without needing a second click
- [ ] Add a "Feedback" tab to the product settings page that shows a list of all feedback items with filters (status, tags, etc.) and search
- [ ] Allow product admins to add and change status tags (e.g. "planned", "in progress", "completed")
- [x] Show icon besides the feedback category on the public board (e.g. a bug icon for bug reports, a lightbulb for feature requests, etc.) when icon is added to the category
  - Rendered category icons in `components/public/PublicFeedbackBoard.vue` and added e2e coverage in `tests/e2e/anonymous-feedback.spec.ts`.
- [ ] In public feedback board, it should be possible to click a feedback to see more details (description, comments, etc.) in a modal or separate page without leaving the board
- [x] Move powered by verify to the very bottom of the page and make it smaller. Change domain to veerify.io
- [x] Add a GitHub mention link to the footer of the public board for users to easily report issues with the board itself, and to see the source code. Mention that it is open source and contributions are welcome.
- [x] Add a link to veerify's own public feedback board in the footer of the public board, so users can see an example of a feedback board and submit feedback about veerify itself.
  - Added footer link in `components/public/PublicFeedbackBoard.vue` (`public-footer-veerify-board`) with coverage updates in `tests/e2e/anonymous-feedback.spec.ts`.

- [x] When refreshing in a personal account, the sidebar renders the items for the organization instead of the personal account. This is because the sidebar is rendered before we fetch the user data and determine if it's a personal or org account. We should either fetch the user data earlier or make the sidebar more resilient to this case.

- [x] Add hover effect to products in products page to indicate they are clickable

- [x] For the billing page, please add a contacts section where it is possible to add additional emails that will be on copy when the bill/receipt is sent out.
  - Added editable billing contact emails in `components/settings/SettingsBilling.vue`, persisted to organization `settings.billingCcEmails` via `server/api/orgs/[slug].put.ts`, with e2e coverage in `tests/e2e/organization-settings.spec.ts`.

- [x] Workspace icon for when the sidebar is collapsed is not centered in the sidebar. Please center it.

- [ ] When on a public board on a custom domain or subdomain but I am logged in to the dashboard on the main domain, it should show that I am logged in and allow me to access the dashboard from the public board. Currently, it shows that I am not logged in and when I click the login button, it takes me to the main domain login page instead of showing a login modal on the public board. We should either show a login modal on the public board or redirect to the main domain login page and then back to the public board after login.

- [x] The toggle in product settings to show or not show the powered by veerify badge on the public board is currently updating on public boards. It should hide the badge when toggled off and show it when toggled on. Please also add option to toggle Github footer as well.

- [x] Add option to create a custom footer for public feedback boards, where customers can add their own text, links, and branding instead of the default "Powered by Veerify" badge. This would allow customers to fully white-label the public board experience if they choose to.
  - Added custom footer settings and rendering in `components/products/ProductSettingsAppearance.vue` and `components/public/PublicFeedbackBoard.vue`, with API validation in `server/api/projects/[slug].put.ts` and e2e coverage in `tests/e2e/anonymous-feedback.spec.ts`.

- [x] Feedback page for a product should default to a Kanban style board instead
  - Replaced list rendering in `pages/feedback/index.vue` with a Kanban-first board and updated e2e selectors/assertions in `tests/e2e/helpers/selectors.ts` and `tests/e2e/admin-feedback.spec.ts`.

- [x] We want to have a home page for the entire project, hosted on veerify.io. Please change the main domain for the dashboard to app.veerify.io, so we can host a separate site for the homepage.
  - Added dedicated dashboard-domain config (`APP_DASHBOARD_DOMAIN`) and runtime usage in `nuxt.config.ts`, `server/middleware/subdomain.ts`, and `components/public/PublicFeedbackBoard.vue`, plus env/docs updates in `.env.example` and `README.md`.
