# SUP-X-3 implementation report

## Outcome

Implemented a build-time OpenAPI route scanner and replaced the hand-maintained route-path block in
`server/api/openapi.json.get.ts` with a generated TypeScript artifact import.

The scanner found all 68 current route files carrying `@openapi` JSDoc. Those files merge into 46 path
entries and 68 operations, including auth, GitHub, organization, system, cron, team, and support routes.
Numeric response status keys are preserved as JSON string keys as required by OpenAPI.

## Implementation

- `scripts/openapi-scanner.ts` recursively scans `server/api/**/*.ts`, extracts standard swagger-jsdoc YAML
  blocks, validates path items, merges methods deterministically, rejects conflicting operations, and emits
  `server/generated/openapi-routes.ts`.
- `yarn openapi:generate` is invoked explicitly before `nuxt build`, `nuxt generate`, and `vercel-build`.
- The served endpoint retains its existing metadata, tags, security scheme, and shared schemas, while using
  the generated path map. No request-time filesystem or source-route scan remains.
- `js-yaml` is a direct runtime dependency and `@types/js-yaml` is a development dependency.
- Focused scanner tests cover YAML extraction, deterministic method merging, duplicate-operation rejection,
  complete current route coverage, numeric response keys, generated-artifact parity, and the endpoint's lack
  of source filesystem reads.

## Validation

- `yarn openapi:generate` — passed; 46 paths / 68 operations generated.
- `yarn test --run` — passed; 599 tests across 56 files.
- `yarn typecheck` — passed.
- Focused Prettier check for changed source/test files — passed. The generated TypeScript artifact is intentionally
  ignored by Prettier because it is derived output; repository-wide format check still reports pre-existing violations.
- `yarn lint` — passed with 0 errors and 206 existing warnings.
- `yarn build` — passed; Nitro production bundle built successfully after running the generator.
- Built runtime smoke check — `/api/openapi.json` returned OpenAPI 3 with 46 paths / 68 operations and retained
  shared schemas and support search metadata.

## Blockers

None.
