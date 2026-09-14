# SUP-X-3 implementation brief

Replace the hand-maintained OpenAPI `paths` duplication with a build-time scanner for route files that carry
`@openapi` JSDoc blocks. Parse the existing standard Swagger/OpenAPI YAML comment blocks with a direct `js-yaml`
dependency, merge them into the served OpenAPI 3 document, and ensure the generated spec is available in the
production build output without scanning source files at request time.

Requirements:

- Preserve the existing top-level metadata, tags, security schemes, and shared schemas unless the scanner needs a
  compatible merge.
- Cover all current `@openapi` route files, including auth, GitHub, orgs, system, teams, cron, and support routes.
- Resolve Nitro/Nuxt build output paths deterministically; production runtime must not depend on source `.ts` files.
- Remove or stop relying on the duplicated hand-written route paths, while retaining equivalent served output.
- Add focused unit/build/API-doc tests and update package metadata/lockfile through the package manager.
- Run typecheck, unit tests, lint, format checks as applicable, and the harness gate.

Do not edit `TODO.md` or the progress ledger on the worker branch. Write the canonical report to
`.superpowers/sdd/sup-x-3-openapi-scanner/task-report.md`.
