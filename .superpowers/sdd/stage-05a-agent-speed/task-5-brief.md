# SUP-05A-5 implementation brief

Implement the Stage 05A canned-response MVP on `support-platform`.

Scope:

- Add the team-scoped `cannedResponse` table with `id`, `teamId`, `shortcode`, `title`, `body`, `createdByUserId`, timestamps, and a unique `(teamId, shortcode)` constraint. Do not add `inboxId`.
- Add authenticated CRUD routes and settings UI. Any agent on the team can create and edit; enforce tenant scoping and input validation.
- Add `/shortcode` insertion in the reply/note composer at the cursor, preserving text on both sides of the cursor.
- Substitute only `{{contact.name}}` and `{{agent.name}}` from the active conversation/current agent. Do not implement macros, deferred variables, or server-side expansion beyond this requirement.
- Preserve existing drafts, read state, fixed views, and Options API conventions.

Required evidence: focused unit/API/UI tests, generated migration via the repository DB tooling, and a report at `task-5-report.md`. Do not modify `TODO.md` or the progress ledger from the worker branch.
