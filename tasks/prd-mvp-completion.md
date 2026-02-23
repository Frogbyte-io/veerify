# PRD: MVP Completion — Veerify

## Introduction

This PRD covers the highest-priority unchecked items required to complete the Veerify MVP. It focuses on product-facing features that directly impact usability for both dashboard users (product admins) and public board visitors (end users). Infrastructure work like full Nuxt 4 migration and embeddable widgets are deferred.

---

## Goals

- Complete core feedback interaction flows (file attachments, status tags, subscriptions)
- Fix the cross-domain login UX gap on public boards
- Improve admin productivity with drag-and-drop sorting and a unified feedback tab
- Polish visual presentation on the public board (banner, logo, file picker)
- Lay notifications infrastructure as the foundation for email/app subscription

---

## User Stories

### US-001: Public feedback page — banner image and logo
**Description:** As a public board visitor, I want to see the product's banner and logo so that the board feels branded and trustworthy.

**Acceptance Criteria:**
- [ ] If the project has a banner image URL set, render it as the header background image on the public feedback board
- [ ] If the project has a logo URL set, render it as an avatar/logo in the public board header
- [ ] If neither is set, fall back to the current default look (no regression)
- [ ] Banner and logo are responsive and render correctly on mobile
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-002: Improve file picker in product settings Appearance
**Description:** As a product admin, I want a polished file picker with image preview so that uploading a banner or logo feels professional.

**Acceptance Criteria:**
- [ ] Replace the plain `<input type="file">` in `ProductSettingsAppearance` with a styled component (shadcn if available, otherwise custom)
- [ ] After selecting an image, a preview thumbnail is shown inline before saving
- [ ] Existing uploaded image is shown as the current preview on page load
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-003: Allow product admins to add and change status tags
**Description:** As a product admin, I want to create and rename status tags (e.g. "Planned", "In Progress", "Completed") so that I can customise the workflow for my product.

**Acceptance Criteria:**
- [ ] In product settings, there is a "Status Tags" section (or existing tab) where admins can view all current status tags
- [ ] Admin can add a new status tag with a name and optional colour
- [ ] Admin can rename an existing status tag
- [ ] Admin can delete a status tag (with a confirmation prompt; feedbacks using that tag are untagged or reassigned)
- [ ] Changes persist to the database and reflect immediately on the feedback kanban board
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-004: Add a "Feedback" tab to product settings
**Description:** As a product admin, I want a Feedback tab in product settings that lists all feedback items with filters and search so that I can manage feedback without leaving settings.

**Acceptance Criteria:**
- [ ] A "Feedback" tab is added to `pages/products/[slug].vue`
- [ ] The tab shows a compact list/table of all feedback items for the product
- [ ] Filters available: status, category, date range
- [ ] Search by title/description is supported
- [ ] Each row links to the full feedback detail view
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-005: Kanban view — drag and drop sorting of items
**Description:** As a product admin, I want to drag feedback cards between kanban columns so that I can update status without opening each item individually.

**Acceptance Criteria:**
- [ ] Feedback cards in the kanban board are draggable using a library (e.g. `vue-draggable-plus` or `@dnd-kit`)
- [ ] Dropping a card into a different column updates its status to that column's status tag
- [ ] The change persists to the database via an API call
- [ ] Optimistic UI update occurs immediately; API failure reverts the card
- [ ] Drag handle is visible on hover
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-006: Feedback categories — drag and drop sorting
**Description:** As a product admin, I want to drag-reorder feedback categories in product settings so that the most relevant categories appear first on the public board.

**Acceptance Criteria:**
- [ ] Feedback category rows in product settings are draggable
- [ ] Dragging a row to a new position reorders it
- [ ] Order is persisted to the database (a `sortOrder` or `position` field on the category)
- [ ] The public board renders categories in the saved order
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-007: Organization avatar image
**Description:** As an organization admin, I want to upload an avatar/logo for my organization so that it appears in the sidebar and settings pages.

**Acceptance Criteria:**
- [ ] Organization settings page has an avatar upload field
- [ ] File upload uses S3 (or local storage fallback) consistent with how other images are stored
- [ ] Uploaded avatar is displayed in the sidebar `TeamSwitcher` component next to the org name
- [ ] If no avatar is uploaded, the current initials-based fallback is retained
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-008: Notifications infrastructure
**Description:** As a developer, I need a base notifications infrastructure (polling or real-time) so that in-app and email notification features can be built on top of it.

**Acceptance Criteria:**
- [ ] A `notification` table is added to the schema with fields: `id`, `userId`, `type`, `payload` (jsonb), `read` (boolean), `createdAt`
- [ ] A `POST /api/notifications` internal utility function exists to create a notification record
- [ ] A `GET /api/notifications` endpoint returns unread notifications for the authenticated user
- [ ] A `PUT /api/notifications/[id]/read` endpoint marks a notification as read
- [ ] A notification bell icon is added to the dashboard header with an unread count badge
- [ ] Clicking the bell opens a dropdown listing recent notifications
- [ ] Typecheck passes

---

### US-009: File/image/log attachments on feedback submission
**Description:** As a public board user, I want to attach files or images when submitting feedback so that I can provide richer context (screenshots, logs, etc.).

**Acceptance Criteria:**
- [ ] The feedback submission form has a file upload field (accepts images, text files, PDFs; max 10 MB each, max 5 files)
- [ ] Uploaded files are stored in S3 (or local storage in dev) and their URLs are linked to the feedback record via a `feedbackAttachment` table
- [ ] Attached files are shown in the feedback detail view (images rendered inline; other files as download links)
- [ ] The edit-feedback flow (token-based) also allows adding/removing attachments
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-010: Email notification subscription on public board
**Description:** As a public board visitor, I want to subscribe to a feedback item so that I receive email updates when its status changes or new comments are posted.

**Acceptance Criteria:**
- [ ] Each feedback item on the public board shows a "Subscribe" button
- [ ] For anonymous users: clicking Subscribe opens an email prompt; submission stores the email in a `feedbackSubscription` table linked to the feedback item
- [ ] For logged-in users: clicking Subscribe opens a modal to choose email and/or in-app notification (in-app only available if notifications infrastructure is enabled)
- [ ] When a feedback item's status changes, a notification email is dispatched to all subscribers
- [ ] When a new public comment is added, a notification email is dispatched to all subscribers
- [ ] Unsubscribe link is included in every notification email
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-011: Login flow on public board with custom domain
**Description:** As a logged-in dashboard user visiting a public board on a custom domain, I want to be recognized as logged in (or easily log in) so that I can access dashboard features from the public board without being redirected incorrectly.

**Acceptance Criteria:**
- [ ] When a user is authenticated on `app.veerify.io` and visits a custom-domain public board, their session is detected and the "Log in" button in the top-right is replaced with their avatar / a "Go to Dashboard" link
- [ ] If not authenticated, clicking "Log in" on a custom-domain public board either (a) shows a login modal directly on the public board, or (b) redirects to `app.veerify.io/login?redirect=<current-url>` and returns after successful login
- [ ] The chosen approach handles cross-domain cookies correctly (document cookies or a token redirect flow)
- [ ] No regression on same-domain subdomains (e.g. `<slug>.veerify.io`)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

## Functional Requirements

- FR-1: Banner image and logo from project settings render on the public board header (US-001)
- FR-2: File picker in Appearance settings shows image preview before save (US-002)
- FR-3: Product admins can CRUD status tags per product; deletions handle existing feedback gracefully (US-003)
- FR-4: A Feedback tab in product settings lists all feedback with filter + search (US-004)
- FR-5: Kanban cards are draggable; dropping updates feedback status via API with optimistic UI (US-005)
- FR-6: Feedback category order is persisted and reflected on the public board (US-006)
- FR-7: Organization avatar is uploadable, stored, and displayed in the sidebar (US-007)
- FR-8: A `notification` table and CRUD endpoints exist; header shows unread count (US-008)
- FR-9: Feedback submission accepts file attachments; files stored and displayed in detail view (US-009)
- FR-10: Users can subscribe/unsubscribe to feedback items; notifications are dispatched on status change and new comments (US-010)
- FR-11: Login/session state is correctly detected and actionable on public boards served from custom domains (US-011)

---

## Non-Goals

- Full Nuxt 4 migration
- Discord bot integration
- Roadmap page / GitHub Projects sync
- Polls / yay-or-nay voting
- Form provider integrations (Tally, Jotform, Google Forms)
- Feedback export (Google Sheets, Excel, Airtable)
- Anti-spam (IP rate limiting, CAPTCHA) — deferred to a separate security pass
- HTML sanitization audit — deferred to a separate security pass
- Embeddable widgets for third-party websites
- Customizable vote styles

---

## Technical Considerations

- **File storage:** Use an `S3_BUCKET` env var + `@aws-sdk/client-s3` for production; fall back to local `/public/uploads/` in dev. Keep file handling in a reusable `server/utils/storage.ts` helper.
- **Drag and drop:** Prefer `vue-draggable-plus` (Vue 3 compatible, wraps SortableJS) to avoid heavy bundle additions. Check if already in `package.json` before installing.
- **Notifications:** Start with polling (`setInterval` every 30s) on the dashboard; avoid WebSocket complexity for MVP. Can upgrade to SSE later.
- **Cross-domain session (US-011):** Evaluate using a short-lived signed redirect token generated by `app.veerify.io` and consumed by the custom domain to establish a session cookie, or rely on `sameSite=none; secure` cookies if both domains are on the same TLD.
- **Status tags:** Check if a `feedbackStatus` or similar table already exists. If statuses are currently hardcoded, this requires a schema migration to make them dynamic per-project.
- **Feedback categories sort order:** Add a `sortOrder integer` column to the categories table via a Drizzle migration.

---

## Success Metrics

- Public board always displays banner + logo when configured (zero blank-header reports)
- Admins can reorder kanban cards and categories without a page reload
- File attachments accepted and visible in feedback detail with no upload errors
- Subscription emails sent within 60 seconds of a status change
- Logged-in dashboard users are not shown a "Log in" button on custom-domain public boards

---

## Open Questions

1. Is there an existing `feedbackStatus` table, or are statuses currently hardcoded? (affects US-003 scope)
2. For file storage in dev, is there an existing S3 integration in the codebase, or should we start from scratch?
3. For the custom-domain login flow (US-011): does the team prefer a login modal on the public board, or a redirect-back flow via the main domain?
4. Should notification emails (US-010) use the existing `sendEmail` infrastructure, or is a new queue/worker needed for reliability at scale?
5. For drag-and-drop (US-005, US-006): is `vue-draggable-plus` already a dependency?
