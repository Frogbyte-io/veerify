# SUP-05A-7 implementation brief

Implement the Stage 05A keyboard shortcuts on `/support`:

- `j` / `k`: move selection through the currently visible conversation list.
- `r`: switch the composer to reply mode; `n`: switch to internal-note mode.
- `c`: claim the selected conversation to the current agent.
- `e`: resolve the selected conversation.
- `/`: focus the conversation search field.
- `?`: toggle a concise help overlay listing the shortcuts.

Scope keyboard handling strictly to the support page. Never swallow shortcuts while an input, textarea,
select, contenteditable, or other form control is focused. Preserve search/deep links, drafts, read state,
fixed views, and canned-response behavior. Use Options API conventions; add focused tests and forced
Playwright coverage for navigation, composer mode, claim/resolve, search focus, help overlay, and input
focus guard. Do not implement unrelated shortcuts or deferred Stage 05 features. Do not edit TODO.md or
progress.md from the worker branch; write the canonical report to `task-7-report.md`.
