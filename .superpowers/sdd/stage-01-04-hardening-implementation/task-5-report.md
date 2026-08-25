# Task 5 report: authenticated feedback auto-linking

## Delivered

- Added `createAutomaticFeedbackLink` with the approved privacy contract:
  exact same-team `contact.userId`, active contacts only, two-row ambiguity detection,
  no email/name/anonymous/cross-team/blocked/merged matching, and conflict-safe insert.
- Both feedback write routes now run feedback, auto-vote, and optional link creation in one transaction.
- Public feedback category validation is inside that transaction as well.
- Contact timeline links render an `Automatically linked` label and an accessible removal action.
- Settings remain future-write-only: enabling does not backfill and disabling does not remove existing links.

## Verification

- RED: `yarn test:integration tests/integration/support-auto-link.test.ts` failed before implementation because `server/utils/support-auto-link.ts` did not exist.
- GREEN: focused real-Postgres suite: 9 tests passed, including exact-one, zero, ambiguous, blocked, merged, anonymous, email-only, disabled, same-team/cross-team, concurrent duplicate, preserve-on-disable, and unlink behavior.
- Focused serial Playwright with `http://localhost:4913`, isolated `veerify_task5_20260826`, and test-only secrets: 1 passed; the pre-existing timeline test skipped because the seeded fixture has no second team.
- The explicit forced full Playwright guard did start and exercised the 98-test parallel matrix, but was stopped after the known shared-fixture contention produced timeouts/failures; it is not a release result. The affected Task 5 flow remains proven by the focused serial run above.
- Unit: 42 files / 457 passed.
- Redis integration: 6 passed.
- Postgres integration: 7 files / 51 passed.
- `yarn typecheck`: passed.
- `yarn lint`: 0 errors / 188 existing warnings.
- `yarn harness:verify`: all gates passed; guarded E2E explicitly skipped because the harness invocation did not receive complete `PG*` configuration and `PLAYWRIGHT_FORCE=1`.

## Product gap

There is still no safe operator workflow for binding a contact to a signed-in Veerify user. Fixtures seed `contact.userId` directly; this task intentionally does not add email-based or UI binding because that would weaken the privacy contract.

## Commit

`438e695` (`feat(support): auto-link authenticated feedback`).
