# Agent Workflows

Deterministic workflows for assistants working in this repository.

## Bootstrap Loop
1. Read `CLAUDE.md` and `.agents/CLAUDE.md`.
2. Run `yarn harness:context`.
3. Run `yarn worktree:env` to identify the deterministic app URL for the current worktree.
4. Confirm current branch and uncommitted diff before editing.

## Change Loop
1. Make the smallest complete change.
2. Run `yarn harness:verify`.
3. Use Conventional Commit message format: `type(scope): subject` (or `type: subject`).
4. If a command fails, fix and re-run until all gates pass.

## Required Gates
- `yarn typecheck`
- `yarn test`
- `yarn lint`
- `yarn test:e2e:if-available`

`yarn harness:verify` runs the same gates in order and includes a docs-map check.

## Playwright Conditions
- Playwright runs only in cloud/CI or when `PLAYWRIGHT_FORCE=1`.
- A database connection must be configured and reachable.
- If the guarded e2e command skips, include the skip reason in status updates and final output.

## UI Change Policy
- Update or add Playwright coverage for any user-facing behavior change.
- Re-run Playwright until updated workflow tests pass.

## Chrome MCP Loop
1. Ensure MCP is configured: `yarn codex:mcp:chrome:setup`.
2. Start app for the current worktree: `yarn dev:worktree`.
3. Use Chrome MCP for navigation, DOM snapshots, and screenshots.
4. Apply fix, then re-run the same browser path until behavior is clean.
