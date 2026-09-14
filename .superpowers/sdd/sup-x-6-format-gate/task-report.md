# SUP-X-6 report: format gate + CRLF-safe Prettier policy

## Changes

- Added `endOfLine: auto` to `.prettierrc.json`, so Prettier follows the existing file line ending and does not report CRLF-only differences on Windows checkouts.
- Added a named `Format check` step running `yarn format:check` to `scripts/harness-verify.mjs`.
- Added `format:check` to the validation script inventory in `scripts/harness-context.mjs`.
- Preserved the existing CI `yarn format:check` command unchanged.
- Did not edit `TODO.md` or the progress ledger.

## Validation

The focused gate changes passed these checks before the unrelated format-only churn was reverted:

- `yarn format:check`: passed after normalizing the 26 existing files reported by the repo-wide check.
- `yarn typecheck`: passed.
- `yarn test`: 596/596 tests passed across 55 files.
- `yarn lint`: passed, 0 errors and 206 existing warnings.
- `REDIS_URL=redis://localhost:6379 yarn test:integration:if-available`: 6/6 passed.
- `PGHOST=localhost PGPORT=5432 PGUSER=veerify PGPASSWORD=veerifypassword PGDATABASE=veerifydb yarn test:integration:postgres:if-available`: 114 passed, 1 guarded realtime two-process test skipped because `DATABASE_URL` was unset.
- `yarn test:e2e:if-available`: skipped by the local guard because `PLAYWRIGHT_FORCE=1` and a configured database were not set.
- The full harness with explicit Redis/Postgres variables passed all gates, including the new format step, while the reviewed formatting normalization was present.

## Final normalization

The repository baseline had 26 pre-existing Prettier differences unrelated to this gate. In the follow-up commit, Prettier was run only on the exact 26 paths emitted by the failing `yarn format:check` command:

```text
docs/plans/2026-08-11-support-platform/reviews/task-5-initial-review.md
docs/plans/2026-08-11-support-platform/stage-05-decisions.md
scripts/profile-build.mjs
server/api/support/attachments/[id].get.ts
server/api/support/attachments/[uploadId]/complete.post.ts
server/services/scheduler/tasks/attachment-cleanup.ts
server/services/scheduler/tasks/outbound-delivery.ts
server/utils/contact-merge-transaction.ts
server/utils/delivery-events.ts
server/utils/storage/provider-local.ts
server/utils/storage/provider-s3.ts
server/utils/support-attachments.ts
tests/attachment-cleanup-scheduler.test.ts
tests/build-lifecycle.test.ts
tests/delivery-route-control.test.ts
tests/e2e/helpers/support-permissions.ts
tests/e2e/support-inbound-email.spec.ts
tests/integration/support-attachment-cleanup.test.ts
tests/integration/support-attachment-finalization.test.ts
tests/integration/support-timeline-pagination.test.ts
tests/storage-provider-contract.test.ts
tests/support-attachment-read-routes.test.ts
tests/support-attachment-routes.test.ts
tests/support-attachments.test.ts
tests/support-keyboard-shortcuts.test.ts
tests/support-timeline.test.ts
```

The resulting diff is formatting-only (whitespace, wrapping, quote normalization, or Markdown table alignment), and the final repo-wide `yarn format:check` passes.
