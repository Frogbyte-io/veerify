# SUP-05A-3 — Fixed support views

Implement the four fixed support views with `Unassigned` as the landing view.

## Binding behavior

- Views are exactly `Unassigned`, `Assigned to me`, `Resolved`, and `All`.
- Unassigned is the default landing view.
- No saved views, snoozed view, closed view, round-robin, bulk actions, or other deferred Stage 05 scope.
- View selection must drive the conversation list query and stay scoped to the selected inbox/team.
- Preserve SUP-05A-1 assignment and SUP-05A-2 unread/badge semantics; only Unassigned and Assigned to me
  receive unread badges.
- Existing API callers using explicit status/assignee/contact/tag/project filters must not break unless the
  new fixed-view contract intentionally supersedes the support navigation filter surface.
- User-facing behavior requires focused Playwright coverage.
- Options API only; use real loading/error/retry states; do not edit components/ui.

## Verification

- Use TDD and observe a failing fixed-view test before implementation.
- Run focused forced Playwright, then `yarn harness:verify` on a fresh migrated DB and report guarded skips.
