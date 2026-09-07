# SDD ledger — plan: docs/plans/2026-08-11-support-platform/stage-05a-agent-speed.md

Base: `56484fe65f87838497ae97fa50f5b6763e9dc777`

## Global constraints

- Integration target is `support-platform`, never `main`.
- Options API only; no Composition API or hand edits under `components/ui/`.
- Use TDD and run `yarn harness:verify` after each sequential integration.
- Schema changes use `yarn db:generate`; migrations are never handwritten.
- UI behavior changes require Playwright coverage.
- Keep Stage 05's deferred scope out: no round-robin, availability, macros, saved views, bulk actions, merge/split, snooze, undo-send, presence, message-body search, or feedback bridge.
- Search must never query `conversationMessage`.
- Keyboard shortcuts are implemented last.

## Pre-flight dependency and conflict scan

| Tasks              | Producer / consumer or shared surface                                       | Ruling                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1 and 2            | Assignment and outgoing replies determine handled/unread state              | Task 1 establishes ownership behavior; Task 2 consumes it without changing claim semantics.                                      |
| 1 and 3            | Assignment affects fixed-view membership; both touch conversation list/page | Integrate Task 1 first; Task 3 rebases on it and owns navigation/filter presentation.                                            |
| 1 and 8            | E2E must prove auto-claim and note exclusion                                | Task 1 adds focused coverage; Task 8 supplies the broad acceptance flow.                                                         |
| 2 and 3            | Read-state counts attach only to Unassigned and Assigned-to-me views        | Task 2 owns unread computation/API; Task 3 owns view navigation and renders returned counts.                                     |
| 2 and 8            | E2E must prove handled-ness across agents                                   | Task 8 consumes Task 2's final API/UI contract.                                                                                  |
| 3 and 6            | View filtering and search share list queries, but search is global          | Task 6 explicitly bypasses the selected view while preserving it for when search clears.                                         |
| 3 and 7            | Keyboard navigation operates on the visible fixed-view list                 | Task 7 consumes final list/view behavior and remains last.                                                                       |
| 4 and 5            | Draft text/mode and canned insertion share composer state                   | Task 4 owns persistence keys/lifecycle; Task 5 inserts through the same input state and cursor without altering draft semantics. |
| 4 and 8            | E2E must prove reply/note drafts coexist                                    | Task 8 consumes the storage-key and composer-mode contract from Task 4.                                                          |
| 5 and schema       | Canned responses add the only planned canned-response table/migration       | Schedule after read-state schema work to avoid migration collisions; rebase before generating.                                   |
| 6 and 8            | E2E must find resolved conversations globally                               | Task 8 consumes Task 6's final search contract.                                                                                  |
| 7 and all UI tasks | Shortcuts touch the settled page/list/composer surfaces                     | Build last as required, after Tasks 1–6 are integrated.                                                                          |

## Progress

- Task 1 dispatched to `/root/sup_05a_1` from base `56484fe` on branch `agent/SUP-05A-1-claim-assignment`.
- Task 1 review round 1: atomic explicit claim and UI workflow coverage required fixes.
- Task 1: complete — commits `20df161`, `b94c2e7`; task review approved; merged as `c02e2d2`.
- Task 1 integrated verification: `yarn harness:verify` passed with 583 unit, 6 Redis, and 105 Postgres tests; one nested realtime test skipped because `REDIS_URL` was unset. Focused forced Chromium workflows passed 2/2. Broad E2E guard skipped because the environment is not cloud/CI and `PLAYWRIGHT_FORCE` was not set for the harness run.
