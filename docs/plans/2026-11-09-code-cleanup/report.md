# Dead-code cleanup

Baseline: `a4b9e8c`. One source file deleted and six edited: 315 lines removed, 6 added (309 net lines removed).

- Remove obsolete OpenAPI metadata helpers; API documentation uses route JSDoc and the existing scanner.
- Remove the unreachable organization-role helper pair and old GitHub completed-label resolver.
- Migrate three feedback routes to `notifyProjectMembers` and remove its identical deprecated alias.

Search evidence and deliberately retained code: [evidence.md](./evidence.md). Before/after diagram: [comparison.png](./comparison.png). Large generated dependency snapshots remain local review artifacts and are excluded from the commit.

## Validation

On November 9, the full harness and production build passed: 3,394 unit tests and 481 Postgres integration tests. Playwright skipped because local execution was not enabled and the seed user was absent; Redis integration skipped because Redis was unavailable. Postgres was tested against migrated disposable local databases. The first batch was restored when integration failed on outdated scratch schemas, then retried successfully after those test schemas were migrated.

Claude Opus 5.5 reviewed the source on November 12 and found no source blockers. Its artifact-size and stale-documentation findings are addressed for the PR. Current PR checks provide the validation for the submitted commit.

The diagnostic export, Better Auth schema reference, framework entry points, and active compatibility behavior remain intact. This is a conservative cleanup pass rather than a repository-wide architectural rewrite.
