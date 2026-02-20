# Agent Context Map

Use this as the fast path for task context before editing code.

## Primary Sources

- `CLAUDE.md`: repository entrypoint for assistants.
- `.agents/CLAUDE.md`: full project conventions and architecture rules.
- `AGENTS.md`: harness map and validation contract.
- `docs/agent/chrome-mcp.md`: Chrome DevTools MCP setup and verification loop.

## Product + UI

- `pages/`: route-level UI workflows.
- `components/`: reusable UI and feature modules.
- `layouts/`: app shells (`clean`, `dashboard`).
- `middleware/auth.global.ts`: route protection categories.

## Server + Data

- `server/api/`: Nuxt server routes.
- `server/database/drizzle.ts`: database client and defaults.
- `server/database/schema/`: Drizzle schema.
- `server/utils/project-access.ts`: project/feedback authorization checks.
- `lib/auth.ts`: Better Auth server config.

## Testing + Quality

- `tests/`: unit and end-to-end coverage.
- `playwright.config.ts`: browser test config.
- `scripts/run-playwright-if-available.mjs`: guarded Playwright runner.
- `scripts/worktree-env.mjs`: deterministic per-worktree port/base URL derivation.
- `scripts/worktree-run.mjs`: run commands with worktree-specific runtime env.
- `scripts/setup-codex-chrome-mcp.mjs`: idempotent Codex Chrome MCP setup.
- `.github/workflows/ci.yml`: enforced checks in CI.

## Operational Context

- `.env.example`: required runtime configuration keys.
- `docker-compose-dev.yml`: local PostgreSQL and Mailpit setup.
- `README.md`: bootstrap and high-level repository usage.

## Planning + Decisions

- `docs/plans/`: implementation plans and historical design decisions.
