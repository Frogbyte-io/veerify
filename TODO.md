MVP


### Customers (Dashboard)

- [x] **Banner customization** — Add banner image/URL field to `ProductSettingsAppearance` and render it on the public board header
- [ ] **Dark/Light mode toggle for public board** — Add theme mode setting (dark/light/system) to `ProductSettingsAppearance`; apply it to the public feedback board page
- [ ] **GitHub issue creation from feedback** — `POST /api/github/issues` is a 501 stub; implement full flow: verify feedback, get GitHub token, create issue with labels, store link in `githubIssueLink` table
- [ ] **GitHub settings in product settings** — Add a "GitHub" tab to `pages/products/[slug].vue`; allow user to connect a GitHub repo (OAuth token, owner/repo); save to `githubIntegration` table
- [ ] **Auto-create GitHub issues toggle** — UI toggle in GitHub product settings that sets `githubIntegration.autoCreateIssues`; wire up the feedback creation flow to create an issue automatically when enabled
- [ ] **Auto-add labels on GitHub issue close** — Finish `server/api/github/webhook.post.ts`: when an issue is closed, update feedback status to `completed` and add the configured label back to the issue if needed

### Users (Public Board)

- [ ] **Feedback submission confirmation email** — Send a confirmation email to the submitter when they submit feedback (if email provided), including a tokenized edit link
- [ ] **Edit feedback from confirmation email** — Create a token-based edit endpoint (`GET/PUT /api/feedback/[id]/edit?token=...`) and edit page so submitters can update their feedback via email link
- [ ] **File/image/log attachments** — Add file upload support to the feedback submission form; store files (S3/local) and reference them from the feedback record
- [ ] **Email notification subscription** — Allow users/anonymous submitters to subscribe to a feedback item for state-change and comment notifications; implement notification dispatch on status change and new public comment

### Implementation

- [ ] **Anti-spam: cookie/localStorage vote tracking** — Supplement the anonymous session with a cookie/localStorage record on the client so a page refresh doesn't allow re-voting before the session expires
- [ ] **GitHub OAuth repo-selection flow** — In the GitHub product settings tab, trigger GitHub OAuth (with `repo` or `public_repo` scope), exchange for a token, and let the user pick which repo to link
- [x] **Iframe embed** — Generate an embeddable `<iframe>` snippet for the public board and display it in product settings (domain tab or a new "Embed" tab)

### Infrastructure

- [ ] Set up full test infrastructure
- [ ] Send email when custom domain has been verified/connected
- [ ] Allow users to create an account or log in directly from the public feedback board (top-right button)
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
