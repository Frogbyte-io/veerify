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

## Platform Services

- `server/services/realtime/`: realtime transport. `types.ts` holds the envelope
  contract and channel helpers; drivers are `redis` (ioredis, wire protocol — works
  against Upstash or Valkey) and `memory` (single instance only).
- `server/utils/ws-connections.ts`: WebSocket peer registry and channel fan-out.
- `server/utils/realtime-channels.ts`: subscribe-time channel authorization.
- `server/services/redis/client.ts`: shared ioredis factory. Both realtime and the
  rate limiter take connections from here.
- `server/services/rate-limit/`: rate limiter store adapter (`memory` | `redis`).
- `server/services/scheduler/`: scheduled tasks behind one API, backed by Vercel Cron
  on cloud and Nitro tasks when self-hosted.
- `server/services/domains/`: custom domain provider adapter.
- `lib/realtime-client.ts` + `plugins/realtime.client.ts`: browser realtime client.

## Operational Context

- `.env.example`: required runtime configuration keys.
- `docker-compose-dev.yml`: local PostgreSQL and Mailpit setup.
- `README.md`: bootstrap and high-level repository usage.

## Planning + Decisions

- `docs/plans/`: implementation plans and historical design decisions.
- `docs/plans/2026-08-11-support-platform/`: the support platform program. Read
  `design.md` before touching support code, and `deltas.md` for what the plan got
  wrong once implementation started.
