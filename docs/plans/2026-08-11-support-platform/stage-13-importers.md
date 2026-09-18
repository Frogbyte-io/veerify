# Stage 13 — Migration importers

**Depends on:** Stages 02 and 09. **Blocks:** nothing.
**Can start after Stage 09's status-event foundation is available.** The importer framework described
below is not present on `support-platform` yet, so this stage must establish that foundation before
adding source adapters.

**Goal:** Import existing support history from Zendesk, Freshdesk, Intercom, and Chatwoot, so switching
to Veerify does not mean abandoning years of tickets.

> Outline-level detail. Refine when unblocked.

## Foundation required before adapters

The current branch does not yet contain `importRun`, `importRunIssue`, the staged
draft → analyzing → ready → importing → completed flow, progress tracking, or
`ProductSettingsImport.vue`. Build that framework and its project-scoped UI first, then generalize it
to support inbox-scoped imports. Follow the existing adapter shape once the foundation lands; do not
build a second import system.

Once the foundation lands, keep source adapters under `server/services/imports/` and shared import
helpers under `server/utils/imports/`. Follow that adapter shape; do not build a second import system.

## Work

- **Build and then generalize `importRun`** to target an inbox as well as a project. Add a nullable
  `inboxId` alongside `projectId` and a `targetType` discriminator, while keeping existing project
  imports working unchanged.
- **Source adapters** — Zendesk, Freshdesk, Intercom, Chatwoot. Each provides: credential validation,
  an analysis pass producing counts and a mapping preview, and a paged import pass.
- **Entity mapping** — tickets → conversations, comments → messages (preserving public versus internal),
  end users → contacts, organizations → companies, tags → tags, agents → users matched by email with
  an explicit unmatched-agent resolution step.
- **Idempotent, resumable import.** Record source ids on imported rows (in `metadata`) so re-running
  skips what already landed. Imports of tens of thousands of tickets will be interrupted; resuming must
  not duplicate.
- **Preserve original timestamps.** `createdAt` on imported conversations and messages must be the
  source timestamp, not the import time, or every reporting number in Stage 09 is wrong for historical
  data.
- **Preserve status history.** Import each source's available status/audit events as append-only
  `conversationStatusEvent` rows with their original `occurredAt`, so Stage 09 reporting includes
  historical resolved and reopened transitions rather than only the current ticket status.
- **Attachment migration** — download from the source and re-upload to storage, with per-file failure
  recorded as an `importRunIssue` rather than aborting the run.
- Rate-limit against source APIs and honour their `Retry-After` headers.

## Acceptance criteria

1. Importing a Zendesk export produces conversations, messages, contacts, and companies with correct
   relationships, original timestamps, and imported status history.
2. Internal notes import as `kind: 'note'`, not as customer-visible messages.
3. Re-running a completed import creates no duplicates.
4. Interrupting an import and resuming completes without duplicating or skipping.
5. An unmatched agent is surfaced for explicit resolution rather than silently dropped.
6. A failed attachment download is recorded as an issue and the run continues.
7. Imported status/audit events produce ordered `conversationStatusEvent` rows with source timestamps.
8. `yarn harness:verify` green on `support-platform`.

## TODO items

- [ ] Add `inboxId` and `targetType` to `importRun`; generate migration; keep existing project imports working unchanged
- [ ] Implement the Zendesk source adapter: credential validation, analysis pass, paged import
- [ ] Implement the Freshdesk source adapter
- [ ] Implement the Intercom source adapter
- [ ] Implement the Chatwoot source adapter
- [ ] Implement entity mapping with agent matching by email and an unmatched-agent resolution step
- [ ] Implement idempotent resumable import keyed on source ids recorded in `metadata`
- [ ] Implement attachment migration with per-file failure recorded as `importRunIssue`
- [ ] Implement source API rate limiting honouring `Retry-After`
- [ ] Extend the import UI to target inboxes and show the conversation mapping preview

## Risks

- **Timestamp loss.** Importing with `now()` silently corrupts all historical reporting. Explicit
  acceptance criterion.
- **Internal notes imported as public messages.** Would expose internal commentary if the customer portal
  in Stage 10 is enabled. Check this specifically.
- **Duplicate imports.** Long-running imports get interrupted. Idempotency is a requirement, not a
  refinement.
- **Building a second import system.** The framework exists. Extend it.
