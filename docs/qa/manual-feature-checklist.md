# Manual Feature QA Checklist

This checklist is maintained outside TODO.md to keep backlog tracking focused.

## Implemented Feature Inventory (QA scope)

This is a practical inventory of implemented features you can test right now.

### Authentication and accounts

- Email/password sign up
- Email/password sign in
- Magic link sign in
- GitHub social sign in/sign up
- Forgot password flow
- Profile update (name/email)
- Password change
- Two-factor authentication (enable/verify/disable/backup codes)
- Anonymous session merge into authenticated account after login

### Workspace, organization, and team management

- Personal account dashboard view (no workspace)
- Workspace dashboard view (has organization)
- Onboarding flow (create workspace, invite members, finish)
- Workspace settings (name, slug, logo)
- Workspace members list and role management
- Workspace invitation management
- Workspace delete flow (owner only)
- Team creation
- Team switching (sidebar/settings sync)
- Team settings (name, slug)
- Team member list and team invites
- Team member removal and team delete
- Billing contacts (extra receipt/invoice CC emails)
- Appearance settings (light/dark/system for dashboard app)
- Notification preferences page (UI toggles)

### Products and project settings

- Product list and create flow
- Product settings tabs (General, Categories, Appearance, GitHub, Domain, Embed, Danger Zone)
- Product general settings (name, slug, description, public/private)
- Category CRUD (name, icon, color, description, default handling, reassignment on delete)
- Public board appearance customization (banner, theme mode, footer toggles, custom footer)
- GitHub integration (connect account, select repo, sync toggles, auto-create issue options)
- Custom domain setup and DNS verification
- Embed iframe snippet generation and live preview
- Product delete flow

### Feedback and public board

- Internal feedback board (kanban by status)
- Internal feedback create, filter, sort, paginate, delete
- Feedback detail page (vote, comment, status update, delete)
- Token-based feedback edit page for submitters
- Public team page listing products
- Public board page per project (subdomain and custom domain support)
- Public feedback submit (anonymous or with email)
- Public feedback filtering/sorting/category selection
- Public vote toggle with localStorage/cookie persistence
- Own anonymous submissions highlighting
- Public footer variants (default/footer toggles/custom footer links)
- Public board login/signup links with redirect target back to board

### Developer and platform features

- OpenAPI JSON endpoint (`/api/openapi.json`)
- API docs UI (`/api-docs`)
- Transactional mail pipeline (verification, password reset, feedback/domain notifications)
- Multi-tenant access control on feedback/project APIs

### Placeholder pages currently present

- Reports/Analytics page (mostly static placeholder data)
- Help Center page (static content)

## Manual Feature Test Checklist

Use this as a pass/fail checklist for a manual regression run.

### Pre-flight

- [ ] App starts and loads without console/runtime errors
- [ ] Can sign in with a seed/test account
- [ ] Mailpit (or SMTP sink) is available for email-related checks

### Authentication

- [ ] Sign up with email/password creates account and lands on dashboard
- [ ] Login with email/password succeeds
- [ ] Login with wrong password shows error
- [ ] Magic link email can be requested
- [ ] GitHub login button starts OAuth flow
- [ ] Forgot password request shows success state
- [ ] Profile name/email can be updated and persisted
- [ ] Password can be changed from Security tab
- [ ] 2FA can be enabled, verified with TOTP, and disabled again

### Personal/workspace routing

- [ ] Logged-out user visiting `/dashboard` is redirected to `/login`
- [ ] Root route redirects to `/dashboard` when logged in
- [ ] Personal account sees personal dashboard widgets/submissions view
- [ ] Workspace account sees workspace dashboard layout

### Onboarding and workspace

- [ ] Onboarding can create a workspace with unique slug
- [ ] Onboarding invite step sends at least one invitation
- [ ] Workspace settings save name/slug/logo correctly
- [ ] Workspace members list loads
- [ ] Workspace invite dialog sends invite with selected role
- [ ] Workspace invitation cancel works
- [ ] Workspace delete requires confirmation slug and enforces owner-only behavior

### Teams

- [ ] Create team from Settings -> Teams
- [ ] New team appears in sidebar switcher
- [ ] Switching teams updates active context across pages
- [ ] Team slug update saves and reflects in preview URL
- [ ] Team members list loads for non-default team
- [ ] Team invite sends successfully
- [ ] Team member removal works
- [ ] Team delete flow works with confirmation

### Products

- [ ] Create product from Products page
- [ ] Product card opens settings page
- [ ] General tab saves name/slug/description/public toggle
- [ ] Categories tab can create/edit/delete category
- [ ] Deleting category can reassign existing feedback
- [ ] Appearance tab saves banner/theme/footer options
- [ ] Custom footer renders on public board when enabled
- [ ] GitHub tab loads integration state and repo selector
- [ ] GitHub connect button initiates OAuth connect flow
- [ ] GitHub settings save (sync/auto-create toggles)
- [ ] Domain tab saves custom domain and verify check runs
- [ ] Embed tab copy snippet works and iframe preview loads
- [ ] Danger zone delete product removes product from list

### Feedback management (internal)

- [ ] Feedback page loads selected project and status columns
- [ ] Create feedback item from dashboard modal
- [ ] Created feedback appears in expected kanban column
- [ ] Feedback detail page opens and loads metadata
- [ ] Status change updates item state
- [ ] Comment can be added to feedback
- [ ] Vote toggle works on feedback detail
- [ ] Delete feedback removes item from board/list

### Public board and anonymous flows

- [ ] Public team root page lists products
- [ ] Public project board loads from subdomain URL
- [ ] Anonymous user can submit feedback without account
- [ ] Anonymous submission with optional email works
- [ ] Anonymous user can vote and unvote
- [ ] Vote state persists after page refresh
- [ ] Anonymous submissions are highlighted for same browser/session
- [ ] Public filters (status/category/sort) apply correctly
- [ ] Category icon shows on feedback item when configured
- [ ] Public login/signup links preserve redirect back to board
- [ ] Public footer toggle settings (powered by/GitHub/custom) apply correctly

### Submissions and docs

- [ ] `/submissions` shows user submissions with filters and pagination
- [ ] `/api/openapi.json` returns valid JSON
- [ ] `/api-docs` loads interactive API docs UI

### Optional API authorization smoke checks

- [ ] `GET /api/feedback` without `projectId` returns validation error
- [ ] Private-project feedback creation blocks unauthorized users
- [ ] Public-project feedback creation allows anonymous users
- [ ] Voting endpoint rejects private project feedback
- [ ] Cross-team/project access is denied as expected
