MVP


### Customers (Dashboard)

- [x] **Banner customization** — Add banner image/URL field to `ProductSettingsAppearance` and render it on the public board header
- [x] **Dark/Light mode toggle for public board** — Add theme mode setting (dark/light/system) to `ProductSettingsAppearance`; apply it to the public feedback board page
- [ ] **GitHub issue creation from feedback** — `POST /api/github/issues` is a 501 stub; implement full flow: verify feedback, get GitHub token, create issue with labels, store link in `githubIssueLink` table
- [ ] **GitHub settings in product settings** — Add a "GitHub" tab to `pages/products/[slug].vue`; allow user to connect a GitHub repo (OAuth token, owner/repo); save to `githubIntegration` table
- [ ] **Auto-create GitHub issues toggle** — UI toggle in GitHub product settings that sets `githubIntegration.autoCreateIssues`; wire up the feedback creation flow to create an issue automatically when enabled
- [ ] **Auto-add labels on GitHub issue close** — Finish `server/api/github/webhook.post.ts`: when an issue is closed, update feedback status to `completed` and add the configured label back to the issue if needed

### Users (Public Board)

- [x] **Feedback submission confirmation email** — Send a confirmation email to the submitter when they submit feedback (if email provided), including a tokenized edit link
- [x] **Edit feedback from confirmation email** — Create a token-based edit endpoint (`GET/PUT /api/feedback/[id]/edit?token=...`) and edit page so submitters can update their feedback via email link
- [ ] **File/image/log attachments** — Add file upload support to the feedback submission form; store files (S3/local) and reference them from the feedback record
- [ ] **Email notification subscription** — Allow users/anonymous submitters to subscribe to a feedback item for state-change and comment notifications; implement notification dispatch on status change and new public comment

### Implementation

- [x] **Anti-spam: cookie/localStorage vote tracking** — Supplement the anonymous session with a cookie/localStorage record on the client so a page refresh doesn't allow re-voting before the session expires
- [ ] **GitHub OAuth repo-selection flow** — In the GitHub product settings tab, trigger GitHub OAuth (with `repo` or `public_repo` scope), exchange for a token, and let the user pick which repo to link
- [x] **Iframe embed** — Generate an embeddable `<iframe>` snippet for the public board and display it in product settings (domain tab or a new "Embed" tab)

### Infrastructure

- [ ] Set up full test infrastructure
- [ ] Send email when custom domain has been verified/connected
- [x] Allow users to create an account or log in directly from the public feedback board (top-right button)
- [ ] Add REST API docs UI (`/api/openapi.json` exists; add Scalar or Swagger UI)
- [ ] Notifications infrastructure (real-time or polling for in-app notifications)
- [ ] Create embeddable widgets for customers to add to their own website
- [ ] Migrate to Nuxt 4
- [ ] Anti-spam: IP-based rate limiting, duplicate content detection, user reputation scoring, CAPTCHA (optional)
- [ ] Review and harden HTML sanitization for user-submitted content; audit for SQL injection risks


- [ ] Discord Bot — notify on new feedback; submit feedback via `/feedback` slash command
- [ ] Polls / feature suggestions with yay-or-nay vote
- [ ] Integrations with form providers (Tally, Jotform, Google Forms, etc.)
- [ ] Export feedback to Google Sheets / Excel / Airtable
- [ ] Roadmap page — public timeline view based on feedback status tags
- [ ] Sync roadmaps to GitHub Projects
- [ ] Customizable vote style (thumbs, arrows, ducks, rockets, etc.)
- [x] When creating a feedback item, it should be automatically upvoted by the submitter (if anonymous, use the session; if logged in, use their user ID) so it appears in the board without needing a second click
- [ ] Add a "Feedback" tab to the product settings page that shows a list of all feedback items with filters (status, tags, etc.) and search
- [ ] Allow product admins to add and change status tags (e.g. "planned", "in progress", "completed")
- [ ] Show icon besides the feedback category on the public board (e.g. a bug icon for bug reports, a lightbulb for feature requests, etc.) when icon is added to the category
- [ ] In public feedback board, it should be possible to click a feedback to see more details (description, comments, etc.) in a modal or separate page without leaving the board
- [x] Move powered by verify to the very bottom of the page and make it smaller. Change domain to veerify.io
- [ ] Add a GitHub mention link to the footer of the public board for users to easily report issues with the board itself, and to see the source code. Mention that it is open source and contributions are welcome.
- [ ] Add a link to veerify's own public feedback board in the footer of the public board, so users can see an example of a feedback board and submit feedback about veerify itself. 

- [x] When refreshing in a personal account, the sidebar renders the items for the organization instead of the personal account. This is because the sidebar is rendered before we fetch the user data and determine if it's a personal or org account. We should either fetch the user data earlier or make the sidebar more resilient to this case.

- [x] Add hover effect to products in products page to indicate they are clickable