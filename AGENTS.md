# Agent Memory

## Post-change validation checklist
- Run `yarn typecheck`.
- Run `yarn test`.
- Run `yarn lint`.
- Run `yarn test:e2e:if-available`.

## Playwright execution rule
- `yarn test:e2e:if-available` must run Playwright only when the environment is available (cloud/CI or explicitly forced with `PLAYWRIGHT_FORCE=1`) and a database connection is configured.
- If the guarded Playwright command skips, include the skip reason in the update/final response.
