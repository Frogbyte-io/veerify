# Task 5 report: authenticated feedback auto-linking

## Delivered

- Added `createAutomaticFeedbackLink` with the approved privacy contract: exact same-team `contact.userId`, active contacts only, two-row ambiguity detection, no email/name/anonymous/cross-team/blocked/merged matching, and conflict-safe insertion.
- Both feedback write routes now keep feedback, auto-vote, and optional link creation in one transaction. Anonymous routes skip the helper; direct anonymous calls return before policy access.
- Contact lifecycle operations use a stable, team-scoped row lock before touching contact-owned state. Create, update, block, delete, merge, explicit link/unlink, inbound resolution, and auto-link paths follow team-before-contact ordering; merge locks multiple team IDs in sorted order. This removes the prior global table lock and its row-lock inversion while preserving cross-team concurrency.
- Auto-link takes the team lock before reading policy. Settings writes take the same lock, so once a disable request commits, an older waiting submission cannot create a later automatic link. Setting changes remain future-write-only and never backfill or delete existing links.
- Concurrent duplicate callers use resulting-state semantics: both resolve to the existing linked contact.
- Contact timelines label automatic links and refetch after unlink so the feedback immediately returns to Possible matches.
- Browser fixtures track ownership, clean up independently in foreign-key-safe order, dispose request contexts, and assert restored policy, role, project, and owned rows.

## Verification

- RED: without lifecycle serialization, block/merge/second-contact mutations could leave a stale candidate decision and delete could hit a foreign-key violation. A later policy test also proved an enabled read could link after a disable committed.
- GREEN: the focused real-Postgres suite passes 22/22. It uses backend PIDs, `pg_blocking_pids()`, and `pg_locks` rather than timing guesses; covers both merge acquisition orders, unlink behind auto-link, unlink after merge repoints a link, unrelated-team progress, block/delete/new-ambiguity, policy-disable linearization, exact-one/zero/blocked/merged/ambiguous/cross-team/email-only/anonymous, duplicate callers, preservation on disable, and unlink authorization.
- Focused serial browser previously passed 2/2 against `http://localhost:4913`, isolated `veerify_task5_20260826`, and test-only auth/upload secrets. It proved authenticated auto-linking, email-only/anonymous no-link, the automatic-link label, unlink, and immediate Possible matches reappearance.
- On the final backend-only lock round, a repeat browser run passed the first case but the Nuxt dev server stopped responding to all protected-page navigation before the second case reached its assertions; Postgres was idle and `/login` remained healthy. A fresh dev server reproduced the protected-route render timeout. This runtime limitation is recorded rather than represented as a product assertion failure.
- Unit: 42 files / 458 passed.
- Redis integration: 6/6 passed.
- Postgres integration: 7 files / 64 passed.
- `yarn typecheck`: passed.
- `yarn lint`: 0 errors / 188 warnings (pre-existing repository lint debt; no changed-file warnings).
- `yarn harness:verify`: all validation gates passed. Guarded E2E explicitly skipped because `PLAYWRIGHT_FORCE=1` was not set; the focused serial browser evidence and final runtime limitation are reported separately.
- `yarn build`: client and SSR bundles completed; Nitro final packaging remained CPU-active after 15 minutes and was stopped. Production packaging remains unverified rather than reported as passing.

## Files changed

- `server/utils/support-auto-link.ts`
- `server/utils/contact-lock.ts`
- `server/utils/contact-link-transaction.ts`
- `server/utils/contact-merge-transaction.ts`
- `server/utils/inbound-contacts.ts`
- `server/api/feedback/index.post.ts`
- `server/api/public/t/[teamSlug]/[projectSlug]/feedback.post.ts`
- `server/api/support/contacts/index.post.ts`
- `server/api/support/contacts/[id].put.ts`
- `server/api/support/contacts/[id].delete.ts`
- `server/api/support/contacts/[id]/merge.post.ts`
- `server/api/support/contacts/[id]/links.post.ts`
- `server/api/support/teams/[teamId]/settings.put.ts`
- `pages/support/contacts/[id].vue`
- `tests/integration/support-auto-link.test.ts`
- `tests/e2e/support-contact-timeline.spec.ts`
- This report

## Product gap

There is still no safe operator workflow for binding a contact to a signed-in Veerify user. Fixtures seed `contact.userId` directly; this task intentionally does not add email-based or UI binding because that would weaken the privacy contract.

## Commit series

- `4a97882` (`feat(support): auto-link authenticated feedback`)
- `4ac6380` (`fix(support): close auto-link race windows`)
- The final team-scoped lifecycle fix is included in the next Task 5 commit.
