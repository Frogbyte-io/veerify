# Task 5 report: authenticated feedback auto-linking

## Delivered

- Added `createAutomaticFeedbackLink` with the approved privacy contract:
  exact same-team `contact.userId`, active contacts only, two-row ambiguity detection,
  no email/name/anonymous/cross-team/blocked/merged matching, and conflict-safe insert.
- Both feedback write routes now run feedback, auto-vote, and optional link creation in one transaction.
- Public feedback category validation is inside that transaction as well.
- Contact timeline links render an `Automatically linked` label and an accessible removal action.
- Settings remain future-write-only: enabling does not backfill and disabling does not remove existing links.
- Anonymous routes skip the helper; direct anonymous calls return before reading policy settings.
- Candidate selection takes a transaction-level `LOCK TABLE "contact" IN SHARE MODE`, so contact block,
  merge, delete, and new-contact writes cannot race a stale candidate into a link.
- Concurrent duplicate callers use resulting-state semantics: both return the existing linked contact.
- Unlink refetches the timeline so the feedback immediately returns to Possible matches.
- Browser fixtures track ownership, clean up independently in FK-safe order, dispose request contexts, and
  assert restored policy, role, project, and owned rows.

## Verification

- RED (fix round): with the transaction-level contact lock absent, four real-Postgres race tests failed:
  helper completed before block/merge/second-contact mutation, and delete could hit an FK violation after
  candidate selection. This demonstrated the stale-candidate window.
- GREEN: `yarn test:integration tests/integration/support-auto-link.test.ts` — 15/15 passed, covering exact-one,
  zero, blocked, merged, ambiguous, cross-team-only, email-only, anonymous, disabled, concurrent duplicate,
  preserve-on-disable, unlink, and block/merge/delete/new-ambiguity races.
- Focused serial browser: `tests/e2e/support-contact-timeline.spec.ts --workers=1` — 2/2 passed against
  `http://localhost:4913`, isolated `veerify_task5_20260826`, and test-only auth/upload secrets. It proves
  authenticated auto-linking, email-only/anonymous no-link, the Automatically linked label, unlink, and
  immediate Possible matches reappearance. The server was warmed on the dynamic contact route first.
- Unit: 42 files / 457 passed.
- Redis integration: 6/6 passed.
- Postgres integration: 7 files / 57 passed.
- `yarn typecheck`: passed.
- `yarn lint`: 0 errors / 188 warnings (pre-existing repository lint debt; no changed-file errors).
- `yarn harness:verify`: all validation gates passed. Guarded E2E explicitly skipped because `PLAYWRIGHT_FORCE=1`
  was not set; the focused serial browser run above supplied the affected-flow browser evidence.

## Files changed

- `server/utils/support-auto-link.ts`
- `server/api/feedback/index.post.ts`
- `server/api/public/t/[teamSlug]/[projectSlug]/feedback.post.ts`
- `pages/support/contacts/[id].vue`
- `tests/integration/support-auto-link.test.ts`
- `tests/e2e/support-contact-timeline.spec.ts`
- This report

## Product gap

There is still no safe operator workflow for binding a contact to a signed-in Veerify user. Fixtures seed `contact.userId` directly; this task intentionally does not add email-based or UI binding because that would weaken the privacy contract.

## Commit

`4ac6380` (`fix(support): close auto-link race windows`).
