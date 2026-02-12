# Agent Memory

## Startup rule
- Before starting any task, read `CLAUDE.md` in full.
- Treat `CLAUDE.md` as the repository's authoritative agent instruction file (`AGENTS.md` equivalent).

## Post-change validation checklist
- Run `yarn typecheck`.
- Run `yarn test`.
- Run `yarn lint`.
- Run `yarn test:e2e:if-available`.

## Playwright execution rule
- `yarn test:e2e:if-available` must run Playwright only when the environment is available (cloud/CI or explicitly forced with `PLAYWRIGHT_FORCE=1`) and a database connection is configured.
- If the guarded Playwright command skips, include the skip reason in the update/final response.

## UI change policy
- For any task that adds or changes user-facing UI behavior, create or update Playwright coverage for the affected workflow before considering the task complete.
- Run Playwright repeatedly until the updated UI workflow tests pass (not just a single run).
