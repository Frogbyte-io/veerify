# Stage 13 — Migration importers

**Depends on:** Stage 02. **Blocks:** nothing.
**Can start any time after Stage 02** — it is fully independent of the 03→09 chain and is a good
parallel assignment.

**Goal:** Import existing support history from Zendesk, Freshdesk, Intercom, and Chatwoot, so switching
to Veerify does not mean abandoning years of tickets.

> Outline-level detail. Refine when unblocked.

## Why this is largely already built

`importRun` and `importRunIssue` already exist, along with the staged
draft → analyzing → ready → importing → completed flow, the progress tracking, the issue log, and the
`ProductSettingsImport.vue` UI. This stage adds source adapters to an existing framework and generalizes
it from project-scoped to also inbox-scoped.

Read `server/services/imports/` and `server/utils/imports/` before designing anything new. Follow the
existing adapter shape; do not build a second import system.

## Work

- **Generalize `importRun`** to target an inbox as well as a project. Add a nullable `inboxId` alongside
  the existing `projectId` and a `targetType` discriminator. This is the only schema change expected.
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
- **Attachment migration** — download from the source and re-upload to storage, with per-file failure
  recorded as an `importRunIssue` rather than aborting the run.
- Rate-limit against source APIs and honour their `Retry-After` headers.

## Acceptance criteria

1. Importing a Zendesk export produces conversations, messages, contacts, and companies with correct
   relationships and original timestamps.
2. Internal notes import as `kind: 'note'`, not as customer-visible messages.
3. Re-running a completed import creates no duplicates.
4. Interrupting an import and resuming completes without duplicating or skipping.
5. An unmatched agent is surfaced for explicit resolution rather than silently dropped.
6. A failed attachment download is recorded as an issue and the run continues.
7. `yarn harness:verify` green on `main`.

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
