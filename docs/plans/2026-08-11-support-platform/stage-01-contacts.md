# Stage 01 — Contact identity

**Depends on:** Stage 00. **Blocks:** Stage 02.
**Read `design.md` first**, in particular "Why contacts and feedback stay separate".

**Goal:** A customer identity model for support — contacts, the identifiers they are known by, the
companies they belong to, and explicit links to other Veerify entities.

## Scope

**In:** `contact`, `contactIdentity`, `supportCompany`, `contactLink`; CRUD and merge; contact detail
page with a linked-and-probable feedback timeline.

**Out — and this is the important part:** `server/database/schema/feedback.ts` receives **no columns**,
**no `contactId`**, and **no data migration**. There is no backfill script. If an item in this stage
edits `feedback.ts`, it is wrong.

## Work

### 1. Schema

Add `contact`, `contactIdentity`, `supportCompany`, `contactLink` to `server/database/schema/support.ts`
exactly as specified in `design.md` → Data model → Stage 01. Generate the migration with
`yarn db:generate`.

Two constraints worth calling out because they carry the design:

- `contactIdentity` is unique on `(teamId, kind, value)`. This is what makes an email address resolve to
  at most one contact per team, and what makes merge tractable.
- `contactLink` is unique on `(contactId, entityType, entityId)` and lives in the support schema pointing
  outward. Feedback never references a contact.

### 2. Access utilities

Add `requireContactAccess(contactId, userId)` to `server/utils/support-access.ts` (create the file;
Stage 02 extends it). It resolves the contact's team and verifies team membership, throwing 404 if not
found and 403 if no access — matching the shape of `server/utils/project-access.ts`.

### 3. API

| Route                                       | Method         | Notes                                                              |
| ------------------------------------------- | -------------- | ------------------------------------------------------------------ |
| `/api/support/contacts`                     | GET            | Team-scoped, cursor-paginated, search by name/email                |
| `/api/support/contacts`                     | POST           | Creates contact + its primary `contactIdentity` in one transaction |
| `/api/support/contacts/[id]`                | GET            | Includes identities, company, and links                            |
| `/api/support/contacts/[id]`                | PUT            | Name, phone, company, custom attributes                            |
| `/api/support/contacts/[id]`                | DELETE         | Hard delete; cascades identities and links, nothing else           |
| `/api/support/contacts/[id]/merge`          | POST           | Merges another contact into this one                               |
| `/api/support/contacts/[id]/timeline`       | GET            | Linked entities plus probable feedback matches                     |
| `/api/support/contacts/[id]/links`          | POST           | Promote a probable match to a real `contactLink`                   |
| `/api/support/contacts/[id]/links/[linkId]` | DELETE         | Unlink                                                             |
| `/api/support/companies`                    | GET/POST       | Company list and create                                            |
| `/api/support/companies/[id]`               | GET/PUT/DELETE | Company detail                                                     |

**Merge semantics.** Repoint `contactIdentity` and `contactLink` rows to the surviving contact, merge
`attributes` with the survivor winning on key collisions, set `mergedIntoContactId` on the loser, and
retain the loser row as a tombstone so stale references resolve. All in one transaction. Merging a
contact into itself, or into an already-merged contact, is a 400.

**Timeline semantics.** Two clearly separated sections in the response:

- `linked` — real `contactLink` rows. Authoritative.
- `probableFeedback` — computed at query time:
  `WHERE feedback.authorEmail = contact.email OR feedback.authorUserId = contact.userId`, scoped to
  projects in the contact's team. **Suggestions only.** The response must not present them as confirmed.

Auto-linking is a per-team setting stored on `team`-scoped support settings and is **off by default**.
When off, `contactLink` rows are created only by explicit agent action (`source: 'agent'`).

Add an index on `feedback.authorEmail` to keep the probable-match query cheap. This is an index-only
change to the feedback table — permitted, and the sole exception to "no feedback changes".

### 4. UI

- `/support/contacts` — list with search and pagination.
- `/support/contacts/[id]` — detail: attributes, identities, company, and the timeline with _Linked_ and
  _Possible matches_ sections. Each possible match gets a one-click **Link** action. The visual
  distinction between the two sections must be unmistakable; an agent should never mistake a heuristic
  match for a confirmed one.
- Merge dialog with a search-and-select target and an explicit preview of what will move.
- Skeletons while loading, error states with retry, Options API throughout.

Contacts are not in the sidebar yet — Stage 02 adds the `/support` nav entry. Reach them by URL in this
stage.

## Acceptance criteria

1. `git diff` on `server/database/schema/feedback.ts` shows **only** the added `authorEmail` index.
2. Creating a contact with an email already used in the team returns 409, not a duplicate.
3. Merging A into B moves every identity and link, leaves B's colliding attribute values intact, and
   leaves A resolvable via `mergedIntoContactId`.
4. The timeline separates linked entities from probable matches, and probable matches are never returned
   as `contactLink` rows.
5. Deleting a contact removes its identities and links and leaves all feedback rows untouched.
6. A user outside the team gets 403 on every contact endpoint. Cross-tenant isolation is tested.
7. `yarn harness:verify` green on `main`.

## TODO items

Item 1 blocks the rest. Items 4 and 5 can run in parallel once 1–3 land.

- [ ] Add `contact`, `contactIdentity`, `supportCompany`, `contactLink` to `server/database/schema/support.ts`; generate migration; add index on `feedback.authorEmail`
- [ ] Create `server/utils/support-access.ts` with `requireContactAccess`; unit tests for the 404/403 split
- [ ] Add contact CRUD endpoints (`list`, `create`, `get`, `update`, `delete`) with team scoping and cursor pagination
- [ ] Add `POST /api/support/contacts/[id]/merge` with transactional repointing and tombstone; unit tests for collision and self-merge cases
- [ ] Add `GET /api/support/contacts/[id]/timeline` returning `linked` and `probableFeedback` separately, plus link/unlink endpoints; per-team auto-link setting defaulting to off
- [ ] Add `supportCompany` CRUD endpoints
- [ ] Build `/support/contacts` list page (search, pagination, skeletons, error retry)
- [ ] Build `/support/contacts/[id]` detail page with attributes, identities, timeline with visually distinct Linked vs Possible matches, one-click link, and merge dialog
- [ ] Register support contact routes in `server/utils/openapi.ts`

## Risks

- **Drift back into coupling.** The temptation to "just add `contactId` to feedback while we're here" is
  the exact thing this design rejected, for privacy and erasure reasons documented in `design.md`.
  Acceptance criterion 1 is the guard.
- **Probable matches presented as fact.** If the UI renders both sections identically, agents will treat
  heuristic matches as confirmed identity and the privacy argument collapses. Treat the visual
  distinction as a requirement, not polish.
- **Merge under concurrency.** Two agents merging overlapping contacts simultaneously must not
  half-repoint. One transaction, row locks on both contacts.
