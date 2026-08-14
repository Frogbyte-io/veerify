# Agent Harness: Veerify

This file is the agent entrypoint and map, not the full manual.

## Startup

- Read `CLAUDE.md` first.
- Follow the chain to `.agents/CLAUDE.md` and treat it as the authoritative instruction set.
- Run `yarn harness:context` to collect current repository and git context.

## Knowledge Map

- Authoritative project conventions: `.agents/CLAUDE.md`
- Context and file map: `docs/agent/context-map.md`
- Deterministic workflows and validation loop: `docs/agent/workflows.md`
- Chrome MCP browser verification workflow: `docs/agent/chrome-mcp.md`
- Active implementation plans and design notes: `docs/plans/`
- CI truth for enforced checks: `.github/workflows/ci.yml`

## Required Validation Gates

Run these after every change:

- `yarn typecheck`
- `yarn test`
- `yarn lint`
- `yarn test:e2e:if-available`
- `yarn test:integration:if-available`

Or run the harness command:

- `yarn harness:verify`

## UI Legibility Runtime

- Set up Chrome DevTools MCP: `yarn codex:mcp:chrome:setup`
- Start app with deterministic worktree runtime: `yarn dev:worktree`
- Inspect resolved worktree URL/port: `yarn worktree:env`

## Commit Format

- Use Conventional Commits: `type(scope): subject` (or `type: subject` when no scope is needed).
- Preferred types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`, `build`, `perf`, `revert`.

## Playwright Guard

- `yarn test:e2e:if-available` must run Playwright only when environment is cloud/CI or `PLAYWRIGHT_FORCE=1`, and a database is configured and reachable.
- If the guarded Playwright command skips, report the skip reason in updates/final output.

## Redis Integration Guard

- `yarn test:integration:if-available` runs the real Redis driver and rate-limit suite only when Redis is
  reachable at `REDIS_URL` (defaults to `redis://localhost:6379`). Start it with
  `docker compose -f docker-compose-dev.yml up -d valkey`.
- Unlike the Playwright guard, this one is not restricted to cloud/CI — it runs locally by default
  whenever Redis is up.
- If it skips, report the skip reason in updates/final output.

## UI Change Rule

- Any user-facing UI behavior change requires Playwright coverage updates for the affected workflow.
- Re-run Playwright until the updated UI workflow tests pass, not just once.

## Maintenance Rule

- Keep `AGENTS.md` short and stable.
- Move detailed guidance into `docs/agent/*` and link from here.
