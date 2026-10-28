# Veerify MCP — Phase 2 (Import) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent gathers feedback from anywhere (Canny, a roadmap page, GitHub issues, Discord), converts it to
`veerify-import/1`, and through MCP tools stages it, previews it, and commits it into a project's product. It
can re-run the import any time. Re-runs add what's new, never duplicate anything, and never overwrite fields the team
edited in Veerify. Imported authors and voters are kept, and they become real users' activity once they verify their email.

**Architecture:**

- **Staging.** An import is a run (`import_run`). Validated batches are staged as jsonb in `import_run_batch`.
- **Preview.** A pure planner (`planImport`) compares the staged records with what is already in the database and
  produces a dry-run plan.
- **Commit.** `advanceImportRun` applies the plan in idempotent, ordered phases under a lease. It runs inline from the
  commit endpoint for small runs, and from a per-minute scheduled task for large ones.
- **Side effects.** The importer writes with Drizzle directly, so none of the route-level side effects run: no emails,
  notifications, GitHub sync or review requests.
- **Imported people.** Authors and voters live in a feedback-side `imported_person` table. When a user verifies a
  matching email, their imported activity is re-pointed to them.
- **Agent surface.** MCP tools are thin `callApi` wrappers over the REST endpoints.

**Tech Stack:** Nuxt 3 / Nitro / h3, Drizzle + PostgreSQL, Better-Auth 1.5 (`databaseHooks`), zod 4
(`z.toJSONSchema`), `@modelcontextprotocol/sdk` 1.32, Vitest (unit + guarded Postgres integration), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-25-veerify-mcp-design.md`, sections _Import_ and _Existing migration
code_. Phase 1 (keys, `/mcp`, universal tools) is merged (PR #91). Phases 3 and 4 get their own plans.

## Global Constraints

- Project rules in `.agents/CLAUDE.md` apply:
  - Options API only (no UI in this phase).
  - `createError()` for all errors, with the envelope from `server/utils/response.ts`.
  - Authenticate with `requireAuth` / `requireProjectBySlug`.
  - Migrations only via `yarn db:generate`.
  - Every new route has an `@openapi` block. `yarn openapi:check` must stay at 0.
- Format identifier: `"format": "veerify-import/1"`. Any other value is a 400.
- Every import endpoint requires **project admin** on the target project: `requireProjectBySlug(event, slug, { admin: true })`.
- **No side effects during commit.** No emails, no `createNotification` / `notifyProject*` / `notifyFeedbackSubscribers`,
  no realtime publish per record, no GitHub calls, no `createAutomaticFeedbackLink`, no changelog published hooks, no
  marketing review enqueue, and no feedback subscriptions created.
- An import **never writes `authorUserId` / `voterUserId`**, even when an imported email matches an existing user. Only
  claiming (Task 7) does that.
- Re-import is an **ongoing sync where Veerify wins**:
  - A field is updated from the source only if its current Veerify value equals the record's `importSnapshot` value.
  - New comments, votes and people are added. Nothing is ever deleted because it is missing from the source.
- `onExisting`: `'sync'` (default) | `'skip'`. `skip` creates only records not seen before.
- Votes:
  - Listed votes become vote rows with `importedPersonId`.
  - `voteCount` without votes becomes `importedVoteBaseline`.
  - When both are given, `baseline = max(0, voteCount − netListed)`, where `netListed` = upvotes − downvotes.
  - `feedback.voteCount` stays the displayed counter. Commit adds `(newBaseline − oldBaseline) + net of newly inserted
vote rows` to it.
- Limits (_plan call_):
  - ≤ 1,000 records per `import_add_records` batch, and the batch must also fit the 4 MiB `/mcp` body cap.
  - ≤ 50,000 records per run.
  - Runs commit inline when they have ≤ 500 records; otherwise the scheduled task finishes them.
- Imported people are never emailed and never become users unless they sign up themselves.
- Feedback-side only: never write the support `contact` / `contact_identity` tables (hard constraint in `TODO.md`).

## Review Focus

1. **Re-running the identical import twice.** The second run creates 0 records, changes no counts, and its preview says
   so. (Task 6)
2. **A field the team edited between imports.** For example, status moved to `in_progress` or the title fixed. A re-run
   keeps the Veerify value and the preview lists the field as "kept". Untouched fields still update. (Tasks 5, 6)
3. **A project with no custom statuses importing "Under review".** The project's existing system status values stay
   valid. The system statuses are seeded as rows first, then the new status is added. (Task 4)
4. **An imported email that belongs to an existing user.** No `authorUserId` / `voterUserId` is written at import. After
   that user verifies an email, their activity is claimed, and a double vote is merged without breaking `voteCount`.
   (Tasks 6, 7)
5. **The same run committed twice at once** (inline commit plus the cron, or a double click). Nothing is inserted twice:
   the lease serializes the commits and the unique indexes are the backstop. (Task 6)

---

## File Structure

| Path                                                                                                                                | Responsibility                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `server/database/schema/imports.ts` (new)                                                                                           | `importedPerson`, `importRun`, `importRunBatch`, `importRunIssue` |
| `server/database/schema/feedback.ts`, `changelog.ts`                                                                                | External id, snapshot, baseline and person columns                |
| `server/services/imports/format.ts`                                                                                                 | zod schema + types for `veerify-import/1`, JSON Schema export     |
| `server/services/imports/runs.ts`                                                                                                   | Run lifecycle: create, add batch, list, get, cancel               |
| `server/services/imports/taxonomy.ts`                                                                                               | Status and category resolution / creation                         |
| `server/services/imports/planner.ts`                                                                                                | Pure field-sync rules + `planImport` dry run                      |
| `server/services/imports/committer.ts`                                                                                              | `advanceImportRun` (phases, lease, counters)                      |
| `server/services/imports/claim.ts`                                                                                                  | `claimImportedActivity`                                           |
| `server/services/imports/converters/{csv,sleekplan}.ts`                                                                             | Ported converters → `veerify-import/1`                            |
| `server/api/projects/[slug]/imports/**`, `server/api/imports/schema.get.ts`                                                         | REST                                                              |
| `server/services/scheduler/tasks/imports-advance.ts` + `server/tasks/imports/advance.ts` + `server/api/cron/imports-advance.get.ts` | Background commit                                                 |
| `server/mcp/tools/imports.ts`                                                                                                       | MCP import tools                                                  |

---

### Task 1: Schema

**Files:**

- Create: `server/database/schema/imports.ts`
- Modify: `server/database/schema/index.ts`, `server/database/schema/feedback.ts`, `server/database/schema/changelog.ts`
- Generated: one migration (`0062_*`)

**Interfaces — Produces** (Drizzle names → SQL names in snake_case):

- `importedPerson`:
  - Columns: `id` text PK; `projectId` → project (cascade) not null; `source` text not null; `externalId` text not
    null; `name` text; `email` text; `avatarUrl` text; `claimedByUserId` → user (set null); `createdAt`; `updatedAt`.
  - Indexes: unique (`projectId`, `source`, `externalId`); index on `email`.
- `importRun`:
  - Columns: `id` PK; `projectId` → project (cascade) not null; `productId` → product (cascade) not null;
    `createdByUserId` → user (set null); `source` not null; `sourceLabel` not null; `onExisting` text not null
    default `'sync'`; `status` text not null default `'draft'`; `recordCount` int not null default 0; `progress`
    jsonb (`{ phase, done, total }`); `summary` jsonb; `error` text; `leaseUntil` timestamp; `committedAt`;
    `completedAt`; `createdAt`; `updatedAt`.
  - `status` values: `draft | committing | completed | failed | canceled`.
  - Indexes: (`projectId`, `createdAt`); (`status`).
- `importRunBatch`:
  - Columns: `id` PK; `runId` → importRun (cascade) not null; `seq` int not null; `payload` jsonb not null (a partial
    `ImportDocument` without `format` and `target`); `recordCount` int not null; `createdAt`.
  - Indexes: unique (`runId`, `seq`).
- `importRunIssue`:
  - Columns: `id` PK; `runId` → importRun (cascade) not null; `severity` text (`warning | error | skipped`);
    `entityType` text; `externalId` text; `message` text not null; `createdAt`.
  - Indexes: (`runId`).
- `feedback` adds:
  - `externalSource` text and `externalId` text, with a unique index `feedback_project_external_idx` on
    (`projectId`, `externalSource`, `externalId`);
  - `importSnapshot` jsonb;
  - `importedVoteBaseline` int not null default 0;
  - `importedPersonId` → importedPerson (set null).
- `feedbackComment` adds `externalSource`, `externalId` (unique on (`feedbackId`, `externalSource`, `externalId`)),
  `importSnapshot` and `importedPersonId` (set null).
- `vote` adds `importedPersonId` → importedPerson (set null), with a unique index on (`feedbackId`, `importedPersonId`).
- `changelogEntry` adds `externalSource`, `externalId` (unique on (`projectId`, `externalSource`, `externalId`)) and
  `importSnapshot`.
- Avoid a circular import: `feedback.ts` must not import from `imports.ts` at module top in a way that cycles. Put
  `importedPerson` in `feedback.ts`, re-exported from `imports.ts`, if drizzle-kit can't resolve it. Record whichever
  you choose.

- [ ] **Step 1:** Add the tables and columns.
- [ ] **Step 2:** Run `yarn db:generate`. Expected: one migration with only these additions (`CREATE TABLE` ×4,
      `ALTER TABLE ADD COLUMN`s, indexes and FKs), and no drops. Review the SQL.
- [ ] **Step 3:** Run `yarn db:migrate`, then `yarn typecheck`. Expected: both clean.
- [ ] **Step 4:** Commit: `feat(db): import runs, imported people and external ids`.

---

### Task 2: Import format

**Files:**

- Create: `server/services/imports/format.ts`, `server/api/imports/schema.get.ts`
- Test: `tests/import-format.test.ts`

**Interfaces — Produces:**

- `IMPORT_FORMAT = 'veerify-import/1'`; `MAX_BATCH_RECORDS = 1000`; `MAX_RUN_RECORDS = 50_000`.
- zod schemas, using the field names from the spec's _Format (v1)_ block exactly:
  - `importStatusSchema`, `importCategorySchema`, `importPersonSchema`, `importVoteSchema`, `importFeedbackSchema`,
    `importCommentSchema`, `importChangelogSchema`.
  - `importBatchSchema`: every section optional, with `.default([])`.
  - `importDocumentSchema`: `importBatchSchema` extended with `format`, `source`, `sourceLabel` and
    `target: { project, product? }`.
  - Their inferred types: `ImportDocument`, `ImportBatch`, `ImportFeedback`, …
- Field rules:
  - `externalId`: string, 1–200 chars.
  - `title`: 1–200 chars.
  - `body`: ≤ 20,000 chars.
  - Dates: ISO strings (`z.iso.datetime({ offset: true })`).
  - `votes[].type`: `'upvote' | 'downvote'`, default `'upvote'`.
  - `voteCount`: int ≥ 0.
  - `changelog.labels`: `string[]`. Unknown labels are dropped later with a warning, not rejected here.
  - `changelog.status`: `'draft' | 'published'`.
  - `email`: `z.email()`.
  - `metadata`: record.
- `countRecords(batch: ImportBatch): number`. Sums the lengths of all sections.
- `type IssueInput = { severity: 'warning' | 'error' | 'skipped'; entityType: string; externalId?: string; message: string }`.
  It is shared by Tasks 3–6 and persisted to `import_run_issue`.
- `importJsonSchema(): object`. Returns `z.toJSONSchema(importDocumentSchema)`.
- `GET /api/imports/schema`. Takes `requireAuth`. Returns `{ data: { format: IMPORT_FORMAT, schema, example } }`, where
  `example` is a small valid document with one status, one person, one feedback with 2 votes and a comment, and one
  changelog entry.

- [ ] **Step 1: Write failing tests.**
  - The example parses.
  - Validation fails for: `format: 'veerify-import/2'`, an empty `externalId`, a 201-char title, `votes[0].type: 'meh'`
    and a negative `voteCount`.
  - `countRecords` of the example equals the hand count.
  - `importJsonSchema()` has `properties.feedback`.
- [ ] **Step 2:** Run `yarn vitest run tests/import-format.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement, including the `@openapi` block on the route (tag `Imports`). Add tag
      `{ name: 'Imports', description: 'Import feedback, roadmap and changelog from other sources' }` to
      `server/api/openapi.json.get.ts`.
- [ ] **Step 4:** Run the test, `yarn openapi:generate` and `yarn openapi:check`. Expected: PASS / 0 undocumented.
- [ ] **Step 5:** Commit: `feat(imports): veerify-import/1 format and schema endpoint`.

---

### Task 3: Run lifecycle and staging

**Files:**

- Create: `server/services/imports/runs.ts`
- Create: routes under `server/api/projects/[slug]/imports/`:
  - `index.post.ts` (create)
  - `index.get.ts` (list, newest first, last 50)
  - `[runId].get.ts` (status + summary + issues, first 200)
  - `[runId]/records.post.ts` (add batch)
  - `[runId]/cancel.post.ts`
- Test: `tests/import-runs.test.ts` (mocked db, `tests/app-key-routes.test.ts` style)

**Interfaces:**

- Consumes: Task 1 tables; `importBatchSchema`, `countRecords`, `MAX_*` (Task 2); `requireProjectBySlug`,
  `requireProductInProject`.
- Produces:
  - `createImportRun({ projectId, productId, userId, source, sourceLabel, onExisting }): Promise<ImportRunRow>`.
  - `addImportBatch(runId, batch: ImportBatch): Promise<{ seq, recordCount, issues: IssueInput[] }>`:
    - Allowed only while the run is `draft` (409 otherwise).
    - Over 1,000 records in the batch, or over 50,000 for the run → 400.
    - Per-record schema validation already happened in the route. This function only records structural issues: a
      duplicate `externalId` within the same section of the run → `skipped` issue, and the later record is dropped.
  - `cancelImportRun(runId)`: only `draft` or `committing` → `canceled` (409 otherwise).
  - `getImportRunForProject(projectId, runId)`: 404 when the run isn't in the project.
- Request bodies:
  - Create: `{ source: string(1–60, /^[a-z0-9_-]+$/), sourceLabel: string(1–60), product?: string (slug or id), onExisting?: 'sync'|'skip' }`.
  - Records: `ImportBatch`. A body with `format` / `target` keys gets 400 with message `'Send format and target to
create the run; records batches carry only sections'`.

- [ ] **Step 1: Write failing tests.**
  - A non-admin gets 403 from `requireProjectBySlug` (mocked) on all five routes.
  - Create stores the default product when `product` is omitted.
  - A 1,001-record batch → 400.
  - A batch pushing the run over 50,000 → 400.
  - Adding to a `completed` run → 409.
  - A duplicate feedback `externalId` across two batches → second record dropped, with a `skipped` issue.
  - Cancel on `completed` → 409.
  - Get returns `{ run, issues }`.
  - A run from another project → 404.
- [ ] **Step 2:** Run `yarn vitest run tests/import-runs.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement services and routes with `@openapi` blocks (tag `Imports`, security cookie + `userApiKeyAuth`).
- [ ] **Step 4:** Run the test, `yarn openapi:generate` and `yarn openapi:check`. Expected: PASS / 0.
- [ ] **Step 5:** Commit: `feat(imports): import runs and record staging`.

---

### Task 4: Status and category resolution

**Files:**

- Create: `server/services/imports/taxonomy.ts`
- Test: `tests/import-taxonomy.test.ts`

**Interfaces — Produces:**

- `resolveTaxonomy(projectId, batch: Pick<ImportBatch,'statuses'|'categories'>, { apply: boolean, tx? }): Promise<TaxonomyResolution>`
  - `TaxonomyResolution = { statusValueByExternalId: Map<string,string>, categoryIdByExternalId: Map<string,string|null>, toCreate: { statuses: {name,value,color?}[], categories: {name,slug,color?}[] }, issues: IssueInput[] }`
- Status rules, in order. Each source status is resolved as follows:
  1. `mapTo` given and it is a valid effective value → use it. "Effective" means the project's `feedback_status` values
     if any rows exist, else `SYSTEM_STATUSES` values. Given but invalid → `warning` issue, then fall through.
  2. `toStatusValue(name)` matches an effective value → use it.
  3. Otherwise create it: `value = toStatusValue(name)`, `sortOrder` after the existing ones.
     - **If the project has no status rows**, first seed rows for every `SYSTEM_STATUSES` entry (`isDefault` on
       `open`), so existing feedback values stay valid. This is Review Focus 3.
- Category rules: match `mapTo` (id or slug) → slug `toCategorySlug(name)` → create. No seeding.
- With `apply: false`, nothing is written; `toCreate` describes what would be written. With `apply: true`, rows are
  inserted inside `tx`.
- `resolveFeedbackStatus(raw: string | undefined, res: TaxonomyResolution, effective: Set<string>): { value: string; issue?: IssueInput }`.
  Lookup order: externalId map → a valid Veerify value → `'open'` with a `warning`.

- [ ] **Step 1: Write failing tests.**
  - **(Review Focus 3)** No status rows, source status "Under review" →
    - `apply:false`: `toCreate.statuses` contains the 5 system statuses plus `under_review`.
    - `apply:true`: those 6 rows are inserted, with `open.isDefault === true`.
  - An existing row `planned` and source "Planned" → maps to `planned` with nothing created.
  - `mapTo: 'nope'` → warning, then falls back to the name.
  - Category "Bug Reports" with existing slug `bug-reports` → maps to its id.
  - `resolveFeedbackStatus('x')` with no match → `'open'` and a warning.
- [ ] **Step 2:** Run `yarn vitest run tests/import-taxonomy.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Reuse `toStatusValue` and `SYSTEM_STATUSES` (`server/utils/project-statuses.ts`) and
      `toCategorySlug` (`server/utils/project-categories.ts`).
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(imports): status and category resolution`.

---

### Task 5: Sync rules and preview

**Files:**

- Create: `server/services/imports/planner.ts`, `server/api/projects/[slug]/imports/[runId]/preview.get.ts`
- Test: `tests/import-planner.test.ts`

**Interfaces:**

- Consumes: `resolveTaxonomy` with `apply:false` (Task 4); run and batches (Task 3).
- Produces:
  - `SYNC_FIELDS`:
    - feedback: `title, body, status, categoryId, isPinned, isLocked, isHidden`
    - comment: `body, isInternal`
    - changelog: `title, body, labels, status, publishedAt`
  - `planFieldSync(current: Record<string,unknown>, snapshot: Record<string,unknown> | null, incoming: Record<string,unknown>, fields: readonly string[]): { apply: Record<string,unknown>; kept: string[]; nextSnapshot: Record<string,unknown> }`. The algorithm:
    ```
    for f in fields where f in incoming:
      if snapshot is null            → (record created by import before snapshots existed: treat as untouched) apply
      else if deepEqual(current[f], snapshot[f]) → apply[f] = incoming[f]; nextSnapshot[f] = incoming[f]
      else                           → kept.push(f); nextSnapshot[f] = snapshot[f]   (team edited; Veerify wins)
    unchanged incoming values (deepEqual(current[f], incoming[f])) are neither applied nor kept
    ```
  - `planImport(runId): Promise<ImportPlan>`. It reads all batches, looks up existing rows by
    (`projectId`, `externalSource`, `externalId`), and resolves taxonomy with `apply:false`.
    - `ImportPlan = { counts: { create, update, unchanged, skip } per section (statuses, categories, people, feedback, votes, comments, changelog), kept: { entity, externalId, fields }[] (first 200), taxonomy: TaxonomyResolution['toCreate'], issues: IssueInput[] }`
  - Reference checks become `skipped` issues, not failures:
    - comment → unknown feedback (not in the run and not previously imported);
    - comment → unknown parent;
    - vote → unknown person;
    - feedback → unknown author.
  - `onExisting: 'skip'` puts every existing record under `unchanged`, with no updates.
  - `GET /api/projects/:slug/imports/:runId/preview` returns `{ data: ImportPlan }`. Admin only.

- [ ] **Step 1: Write failing tests.**
  - `planFieldSync`, the core cases:
    - untouched: current = snapshot ≠ incoming → applied;
    - **edited (Review Focus 2):** current ≠ snapshot → kept, and the snapshot is retained;
    - identical → neither applied nor kept;
    - `snapshot` null → applied.
  - `planImport` with a fixture DB state:
    - **(Review Focus 1)** a run identical to the last commit → all `unchanged`, `create === 0`;
    - a new comment on existing feedback → `comments.create === 1`;
    - a comment with an unknown `feedbackExternalId` → `skipped` issue;
    - `onExisting: 'skip'` → no updates.
- [ ] **Step 2:** Run `yarn vitest run tests/import-planner.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the planner and route (with `@openapi`).
- [ ] **Step 4:** Run the test and `yarn openapi:check`. Expected: PASS / 0.
- [ ] **Step 5:** Commit: `feat(imports): sync rules and dry-run preview`.

---

### Task 6: Commit engine

**Files:**

- Create: `server/services/imports/committer.ts`
- Create: `server/api/projects/[slug]/imports/[runId]/commit.post.ts`
- Create: `server/services/scheduler/tasks/imports-advance.ts`, `server/tasks/imports/advance.ts`,
  `server/api/cron/imports-advance.get.ts`
- Modify: `nuxt.config.ts` (`nitro.scheduledTasks`, every minute, next to `marketing-audit-advance`)
- Test: `tests/integration/imports-commit.test.ts` (real Postgres, guarded like the other `tests/integration/*`) plus
  `tests/import-committer.test.ts` (unit, for the lease and side-effect checks)

**Interfaces:**

- Consumes: Tasks 1–5.
- Produces:
  - `commitImportRun(runId): Promise<ImportRunRow>`:
    - Allowed from `draft` only (409 otherwise). Sets `status: 'committing'` and `committedAt`.
    - When `recordCount ≤ 500`, calls `advanceImportRun(runId, { budgetMs: 20_000 })` inline.
    - Returns the run.
  - `advanceImportRun(runId, { budgetMs }): Promise<{ done: boolean }>`:
    - Claims the run with `UPDATE … SET lease_until = now()+3min WHERE id=$1 AND status='committing' AND (lease_until IS NULL OR lease_until < now()) RETURNING *`.
      If no row comes back, it returns `{done:false}` without working. That is **Review Focus 5**.
    - Runs the phases in order, recording progress in `progress.phase` / `done` so a later call resumes:
      1. taxonomy (`apply:true`);
      2. people (upsert by unique key; name, email and avatar go through `planFieldSync` too);
      3. feedback;
      4. votes;
      5. comments, parents before children;
      6. changelog.
    - Each record is applied in its own small transaction and is idempotent: insert `ON CONFLICT DO NOTHING` on the
      external-id unique index, then sync update.
    - Feedback insert writes:
      - `productId` = the run's product;
      - `status` via `resolveFeedbackStatus`;
      - `createdAt` / `updatedAt` from the source, or now;
      - `authorName` / `authorEmail` / `importedPersonId` from the person;
      - `sourceLabel` = the run's `sourceLabel`;
      - `metadata.import = { runId, url }`;
      - `importSnapshot` = the synced fields;
      - `voteCount = 0` and `importedVoteBaseline = 0` (votes are applied in phase 4).
    - Vote phase, per feedback:
      - insert vote rows (`importedPersonId`, `type`, `createdAt`) with `ON CONFLICT DO NOTHING`;
      - `newBaseline = max(0, (voteCount ?? netListed) − netListed)`;
      - `feedback.voteCount += (newBaseline − oldBaseline) + net(insertedRows)`, and store `newBaseline`.
    - Comment insert: `feedbackComment` with `parentCommentId` resolved by external id. `feedback.commentCount += 1`
      per inserted comment.
    - Changelog:
      - insert directly (not `createEntry`) with `slug` from `generateUniqueSlug`;
      - `status` = given, or `published` if `publishedAt` is set, else `draft`;
      - labels filtered to `CHANGELOG_LABELS` (warning per dropped label);
      - links via `changelogEntryFeedback` (by feedback external id) and `changelogEntryProduct` (by product slug or id);
      - **never** call `publishEntry` or the published hooks.
    - On budget exhaustion: release the lease and return `{done:false}`.
    - On completion: `status: 'completed'`, `completedAt`, `summary` = applied counts, clear the lease.
    - On an unexpected error: `status: 'failed'`, `error` = the message.
  - `advanceImportRuns({ budgetMs = 45_000 }): Promise<{ processed: number }>`: loops over `committing` runs. The
    scheduled task `imports-advance` calls it.
  - `POST /api/projects/:slug/imports/:runId/commit` returns the run. 202 if still `committing`, 200 if `completed`.

- [ ] **Step 1: Write failing tests** (integration, real Postgres, seeded project + product).
  - Commit the spec's example document plus 3 feedback, 2 people, 5 votes (one downvote), 2 comments (one reply) and
    1 changelog entry. Assert:
    - rows exist;
    - `voteCount` = baseline + net;
    - `commentCount = 2`;
    - feedback `authorUserId IS NULL`, even when a person's email equals the seeded user's (**Review Focus 4**);
    - the changelog entry is `published` with the source `publishedAt` and linked to the feedback.
  - **(Review Focus 1)** Commit the identical document in a second run → row counts and `voteCount` / `commentCount`
    unchanged.
  - **(Review Focus 2)** After run 1, update feedback A's `status` to `in_progress` directly. A run 3 with a changed
    title and status for A → title updated, status stays `in_progress`.
  - Baseline change: run 1 `voteCount: 140` with no votes, then add 5 live vote rows by hand (+5), then run 2 with
    `voteCount: 150` → `voteCount === 155`.
  - **(Review Focus 5)** Two concurrent `advanceImportRun` calls on one run (`Promise.all`) → exactly one does the
    work, with no duplicate rows.
  - Side effects (unit): with `server/utils/notifications`, `lib/email`, the changelog hooks and `publishRealtime`
    mocked, a commit calls none of them.
- [ ] **Step 2:** Run `yarn test:integration:postgres:if-available` (or `PLAYWRIGHT_FORCE`-style guard env as the
      script requires) and `yarn vitest run tests/import-committer.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the committer, route, scheduled task (4 files, same pattern as `marketing-audit-advance`)
      and `nuxt.config.ts` entry.
- [ ] **Step 4:** Run both tests and `yarn openapi:check`. Expected: PASS / 0.
- [ ] **Step 5:** Commit: `feat(imports): idempotent commit engine with background advance`.

---

### Task 7: Claim imported activity on verified email

**Files:**

- Create: `server/services/imports/claim.ts`
- Modify: `lib/auth.ts` (`databaseHooks.user.create.after` and `databaseHooks.user.update.after`)
- Test: `tests/integration/imports-claim.test.ts`

**Interfaces — Produces:**

- `claimImportedActivity(userId: string, email: string): Promise<{ people: number; feedback: number; comments: number; votes: number }>`.
  Idempotent. Matches unclaimed `imported_person` rows by `lower(email)` across all projects, and per person, in one
  transaction:
  - `feedback.authorUserId = userId` where `importedPersonId = person` and `authorUserId IS NULL`;
  - the same for `feedbackComment`;
  - for each vote with `importedPersonId = person`:
    - if the user has no vote on that feedback, set `voterUserId = userId`;
    - otherwise delete the imported vote and adjust `feedback.voteCount` by `−(+1 for upvote | −1 for downvote)`;
  - set `person.claimedByUserId = userId`.
- Hook: in `lib/auth.ts`, add `databaseHooks.user.create.after` and `user.update.after`. When the resulting
  `user.emailVerified === true`, call `claimImportedActivity(user.id, user.email)` fire-and-forget, with logged
  errors. This covers email links, magic links and social sign-ups with verified emails. Check the hook names against
  the installed better-auth 1.5.0 types (`@better-auth/core`). If `user.update.after` doesn't exist, use
  `emailVerification.afterEmailVerification` (confirmed present in 1.5.0) together with `user.create.after`.

- [ ] **Step 1: Write failing tests** (integration).
  - Import a person `a@x.com` with one feedback, one comment and one upvote on feedback F.
  - Create user `A@x.com` with `emailVerified: false` → nothing is claimed.
  - Set `emailVerified: true` (via the hook path, or a direct call to `claimImportedActivity`) → feedback and comment
    have `authorUserId`, and the vote has `voterUserId`.
  - **(Review Focus 4)** Second scenario: the user already upvoted F before claiming → the imported vote is deleted,
    `voteCount` drops by exactly 1, and there is no unique-index violation.
  - Running the claim twice → the second returns zeros.
- [ ] **Step 2:** Run the integration test. Expected: FAIL.
- [ ] **Step 3:** Implement the claim and the hook.
- [ ] **Step 4:** Run the test and `yarn typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(imports): claim imported activity when an email is verified`.

---

### Task 8: Erasure covers imported people

**Files:**

- Modify: `server/services/marketing/privacy.ts` (`eraseContact`), or add `eraseImportedPeople(organizationId, email, tx)`
  in `server/services/imports/claim.ts`, called from `eraseContact` inside its transaction
- Test: `tests/integration/imports-erase.test.ts`

**Interfaces — Produces:** `eraseImportedPeople(organizationId, email, tx): Promise<number>`.

- For `imported_person` rows in the org's projects with `lower(email)` matching:
  - null `authorName` and `authorEmail` on their feedback and comments;
  - delete the person rows. The FK set-null keeps votes, so counts stay intact.
- `EraseContactResult` gains `importedPeople: number`.

- [ ] **Step 1: Write the failing test.**
  - After erasing, the person is gone.
  - Their feedback has a null author name and email, and `voteCount` is unchanged.
  - A person in another org with the same email is untouched.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(imports): include imported people in contact erasure`.

---

### Task 9: MCP import tools

**Files:**

- Create: `server/mcp/tools/imports.ts`
- Modify: `server/mcp/server.ts` (register the tools and add an instructions line), `server/mcp/tools/universal.ts`
  (export `defineTool`, `assertOk`, `getData` for reuse)
- Test: `tests/mcp-import-tools.test.ts` (same `InMemoryTransport` + stub `callApi` style as `tests/mcp-server.test.ts`)

**Interfaces:**

- Consumes: Task 2–6 routes.
- Produces `importTools: VeerifyTool[]`:

| name                 | input                                                                                                   | calls                               |
| -------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `import_get_format`  | none                                                                                                    | GET `/api/imports/schema`           |
| `import_create_run`  | `project?: string` (slug; default = active project), `product?`, `source`, `sourceLabel`, `onExisting?` | POST `/api/projects/{slug}/imports` |
| `import_add_records` | `project?`, `runId`, `records: object` (an ImportBatch)                                                 | POST `…/imports/{runId}/records`    |
| `import_preview`     | `project?`, `runId`                                                                                     | GET `…/preview`                     |
| `import_commit`      | `project?`, `runId`                                                                                     | POST `…/commit`                     |
| `import_status`      | `project?`, `runId`                                                                                     | GET `…/imports/{runId}`             |
| `import_cancel`      | `project?`, `runId`                                                                                     | POST `…/cancel`                     |

- When `project` is omitted, resolve the active project slug via GET `/api/projects/active`.
- Annotations:
  - `import_commit`: `destructiveHint: true`;
  - `import_preview`, `import_status`, `import_get_format`: `readOnlyHint: true`;
  - `import_cancel`: `destructiveHint: true`.
- Also register an MCP **resource** `veerify://imports/schema` (mime `application/json`). It returns the same
  payload as `import_get_format`, which the spec requires ("served by the MCP server as a resource").
- Instructions line: "To import, call import_get_format, convert the source to that format, create a run, add
  records in batches of up to 1000, call import_preview and show the user the result, then import_commit."

- [ ] **Step 1: Write failing tests.**
  - `listTools` includes the 7 new names alongside the 6 universal ones.
  - `import_add_records` POSTs the exact records body to the right path.
  - Omitting `project` resolves the slug from `/api/projects/active`.
  - A 409 from the stub → `isError` with the body.
- [ ] **Step 2:** Run `yarn vitest run tests/mcp-import-tools.test.ts tests/mcp-server.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Update the `tools/list` count assertion in `tests/e2e/mcp.spec.ts` (6 → 13).
- [ ] **Step 4:** Run the tests and `yarn typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(mcp): import tools`.

---

### Task 10: Port Sleekplan and CSV converters

**Files:**

- Create: `server/services/imports/converters/csv.ts`, `server/services/imports/converters/sleekplan.ts`,
  `server/services/imports/converters/csv-parse.ts` (ported `parseCsv` / `csvRowsToObjects` / `normalizeCsvHeader`)
- Test: `tests/import-converters.test.ts`. Port the two cases from `origin/sleekplan-export:tests/import-adapters.test.ts`
  and adapt their expectations to the new format. Read the old code with `git show origin/sleekplan-export:<path>`.

**Interfaces — Produces** (pure, no network, no DB):

- `convertCsvToImport(files: { name: string; text: string }[], opts: { source?: string; sourceLabel?: string }): { document: Omit<ImportDocument,'target'>; warnings: string[] }`.
  Handles a generic CSV and the Sleekplan multi-file export, as the old `analyzeCsvImport` detected it.
- `convertSleekplanApiToImport(payloads: { items?, comments?, changelog?, categories?, statuses?, subscriptions? }): { document: Omit<ImportDocument,'target'>; warnings: string[] }`.
  Ports the old mapping. The old fetch is **not** ported.
- Output must parse with `importDocumentSchema.omit({ target: true })`. Subscriptions from the source are dropped with a
  warning, since the format has no subscriptions (spec non-goal: no emails).

- [ ] **Step 1: Write failing tests.**
  - The ported CSV case.
  - The ported Sleekplan case. It takes payload JSON instead of a fetch mock, and still warns for missing sections.
  - Both outputs pass `importDocumentSchema`.
- [ ] **Step 2:** Run `yarn vitest run tests/import-converters.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(imports): port Sleekplan and CSV converters to veerify-import/1`.

---

### Task 11: End-to-end, docs, retire the old branch

**Files:**

- Create: `tests/e2e/mcp-import.spec.ts`
- Modify: `docs/mcp.md` (Import section), `.agents/CLAUDE.md` (Imports in the endpoint table and the
  schema note), `server/.cursor/rules/api.mdc` if it lists endpoint families

- [ ] **Step 1: Write the e2e test.** Create a key, then use raw JSON-RPC to `/mcp`:
  - `import_create_run`;
  - `import_add_records` with 2 feedback, 3 votes and 1 comment;
  - `import_preview` → `feedback.create === 2`;
  - `import_commit` → `completed`;
  - `call_api` GET `/api/feedback?projectId=…` → both titles present, and one has `voteCount` 3;
  - repeat the whole sequence with the same records → preview `feedback.unchanged === 2`, `create === 0`.
- [ ] **Step 2:** Run it against a dev server, following the Phase 1 e2e notes (start `yarn dev --port <p>`, then
      `PLAYWRIGHT_BASE_URL=… npx playwright test tests/e2e/mcp-import.spec.ts --workers 1`). Expected: PASS.
- [ ] **Step 3:** Write the docs. Add a recipe: "Migrate from Canny" → `import_get_format` → (agent fetches and converts)
      → create / add / preview / commit, plus a "re-run weekly from GitHub issues" note explaining the sync rules.
- [ ] **Step 4:** Run `yarn lint && yarn typecheck && yarn test && yarn openapi:check && yarn format:check` (the
      format check on changed files must be clean). Expected: all pass, except the known Windows-only
      `tests/build-lifecycle.test.ts`.
- [ ] **Step 5:** Commit: `docs(imports): agent import guide`.
- [ ] **Step 6: Retire `sleekplan-export`.** This is irreversible, so **ask the user before running it**:
      `git push origin --delete sleekplan-export && git branch -D sleekplan-export` (if the local branch exists).
