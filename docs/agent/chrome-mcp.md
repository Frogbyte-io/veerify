# Chrome MCP Verification

Use Chrome DevTools MCP to make UI behavior directly legible to Codex.

## What This Enables
- DOM snapshots before/after an action.
- Screenshots for visual verification.
- Direct navigation and interaction loops against the running app.
- Repeatable bug reproduction and fix validation.

## One-Time Setup (per machine)
```bash
yarn codex:mcp:chrome:setup
```

This adds a `chrome-devtools` MCP server to Codex via:
- `codex mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest --headless --isolated --no-sandbox`

## Worktree Runtime
Run the app with deterministic per-worktree ports:
```bash
yarn dev:worktree
```

Inspect computed runtime context:
```bash
yarn worktree:env
```

The worktree scripts set:
- `WORKTREE_PORT`
- `PLAYWRIGHT_PORT`
- `PLAYWRIGHT_BASE_URL`
- `BETTER_AUTH_URL`

## Agent Validation Loop
1. Start app: `yarn dev:worktree`
2. Run Codex with Chrome MCP available.
3. Use MCP tooling to snapshot current DOM + screenshot.
4. Reproduce UI path and collect runtime evidence.
5. Apply fix.
6. Re-run snapshots/screenshots to verify state changes.
7. Run `yarn harness:verify`.
