# Task 5 review: authenticated feedback auto-linking

## Scope and evidence

Reviewed `task-5-brief.md`, `task-5-report.md`, the binding
`stage-01-04-hardening-design.md`, the complete
`review-f4d3f47..4a97882.diff`, all changed source and tests, the feedback
and public-feedback routes, the support settings/access/link-delete routes,
the contact/timeline schema and helper, and the relevant authentication and
project/team access utilities.

The reported focused real-Postgres suite (9/9), focused serial Playwright
flow (1/1), unit/Redis/Postgres gate results, typecheck, and lint are accepted
as evidence. The guarded E2E skip and the deliberately non-green broad
parallel shared-fixture run are correctly distinguished from focused proof.
The integration test is genuinely wired to the real Drizzle/Postgres client,
but one of its claimed isolation cases is not actually discriminating.

**Verdict: Request changes — Task 5 is not complete.** No Critical finding was
found. The core exact-user/team/active-contact filtering, `limit(2)` ambiguity
check, conflict-safe insert, setting behavior, public category transaction,
and feedback/vote/link transaction boundaries are directionally correct.

## Important findings

### 1. Anonymous submissions still call the auto-link helper

The brief explicitly says not to call the helper for anonymous submissions.
Both routes call it unconditionally: `server/api/feedback/index.post.ts:242-247`
and `server/api/public/t/[teamSlug]/[projectSlug]/feedback.post.ts:95-100`
pass `authorUserId: null` for anonymous writes. The helper does avoid contact
matching after its settings query (`server/utils/support-auto-link.ts:18-30`),
but that is not the specified short-circuit: anonymous writes still read the
team auto-link policy and, when enabled, execute helper logic. The resulting
reason can also be `disabled` rather than `anonymous` when the policy is off.

Call the helper only when `session?.user` exists (the helper should retain its
anonymous result for direct callers/tests), and keep the email-only public
path on the no-helper branch.

### 2. Candidate matching is not safe against concurrent contact changes

`server/utils/support-auto-link.ts:43-65` selects active matches and then
inserts the link without locking or rechecking the selected contact. Under
Postgres's default `READ COMMITTED` behavior, a contact can be blocked or
merged after the select but before the insert, leaving a link to a contact that
is no longer active. A second active same-user contact can also commit after
the `limit(2)` query and before the insert, so the final state is ambiguous
even though a link was created. A concurrent contact delete can instead turn
the optional link insert into an FK error and roll back an otherwise valid
feedback submission.

The only concurrency test (`tests/integration/support-auto-link.test.ts:187-193`)
tests duplicate inserts for one already-stable contact; it does not cover
contact block/merge/delete or a second matching contact racing the write.
Serialize the candidate lifecycle for this operation (for example, lock and
revalidate candidate rows plus an explicit strategy for preventing/rechecking
new same-user candidates, or use an appropriate serializable/advisory-lock
boundary), and add real-Postgres race coverage.

### 3. Browser fixture cleanup is not partial-failure safe and uses the wrong FK order

The new test's `finally` block runs a long sequence of awaited cleanup calls
without isolating failures (`tests/e2e/support-contact-timeline.spec.ts:281-306`).
If settings restoration at `:282-296` fails, role restoration, link cleanup,
feedback cleanup, project restoration, and request-context disposal never run.
The link is also deleted after its parent contact (`:298-299`), contrary to
the task's required reverse-FK cleanup order; it currently relies on the
contact cascade and makes the explicit cleanup ineffective. A failed focused
run can therefore leak a contact, feedback, policy state, or team role into
later tests.

Track owned rows as setup succeeds, run each cleanup step independently (or
with nested `try/finally`/settled cleanup), delete `contactLink` before
`contact`, and assert the owned rows/settings/role are restored afterward.

### 4. The integration test does not prove cross-team isolation

`tests/integration/support-auto-link.test.ts:162-169` creates two active
same-team contacts for `ids.user` and then adds a cross-team contact for the
same user. The expected `ambiguous` result is explained entirely by the two
same-team rows, so an implementation that ignored `teamId` would still see
three rows and pass the test. The declared `otherTeamUser` fixture is unused
(`:17`, `:61`).

Split this into an ambiguity case containing only two same-team matches and a
separate cross-team case containing only a matching contact in the other team;
assert the latter returns `none` and leaves zero final `contactLink` rows.

### 5. Unlinking leaves the removed feedback missing from the Possible matches UI

The binding design requires unlinking to move the item back to the suggestion
section immediately. `pages/support/contacts/[id].vue:286-290` only filters
the deleted row out of `linked`; it does not reload `probableFeedback` or add
the feedback back locally. The API would return it after unlink, but the open
page continues to show neither a linked item nor a possible match until a full
reload. The focused browser assertion only checks that the badge disappears
(`tests/e2e/support-contact-timeline.spec.ts:271-280`), so it misses this
workflow regression.

Refetch the timeline after a successful unlink (as `linkFeedback` already does)
and assert that the removed feedback reappears in `probableFeedback`.

## Minor findings

### 1. Conflict-safe duplicate results are indistinguishable from no match

When `onConflictDoNothing` wins the race for an existing link,
`server/utils/support-auto-link.ts:76-81` returns `{ linked: false,
contactId: null, reason: 'none' }`, the same result used for zero active
matches. The concurrent test only counts one `linked` result and the final row
(`tests/integration/support-auto-link.test.ts:191-193`); it does not assert the
loser's result semantics. If the exact five-value reason union is binding,
document that `none` means “no new row was created” (including a duplicate),
or revise the internal contract and test an explicit already-linked outcome.

### 2. The Linked section copy is inaccurate for automatic links

`pages/support/contacts/[id].vue:80-84` labels the whole section
“Confirmed by an agent”, while `:96-104` now renders automatically-created
links in that same section. The row badge and removal label are useful and
accessible, but the section subtitle contradicts them for every auto-linked
row. Change the subtitle to distinguish confirmed and automatic links, or use
copy that does not claim agent confirmation.

## What is correct

- `support-auto-link.ts:18-61` checks the team setting, exact `contact.userId`,
  `blockedAt IS NULL`, `mergedIntoContactId IS NULL`, and two-row ambiguity;
  it never uses email/name matching.
- The insert uses the intended `source: 'auto'` and `createdByUserId: null`
  and is conflict-safe at the database uniqueness boundary.
- Both feedback routes place feedback, the auto-vote, and optional link in one
  transaction; the public route moved category validation into that transaction
  and keeps project/category ownership validation.
- Settings changes remain future-write-only: no backfill is performed and
  disabling does not delete existing links. The existing team-admin settings
  route remains in force.
- The automatic-link badge and conditional `aria-label="Remove automatic
  link"` are accurate for the newly-created automatic rows, and the normal
  link-delete endpoint remains authorized and usable for unlinking.
- The private route's pre-existing GitHub issue creation has a rollback path
  around local transaction failure; this task did not move external GitHub
  work into the database transaction or weaken that behavior.

## Completion gate

Request changes until anonymous paths avoid the helper, candidate/contact
concurrency is made explicit and tested, the browser fixture is cleanup-safe,
the integration tests separately prove cross-team isolation and ambiguity,
and unlinking refreshes the possible-match state. Then rerun the focused
serial browser flow and relevant real-Postgres tests; continue to report the
known broad parallel stress failures separately from the affected flow.
