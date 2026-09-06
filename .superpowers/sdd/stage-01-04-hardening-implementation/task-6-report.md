# Task 6 report: bounded contact feedback timelines

## Delivered

- Added canonical version-1 opaque `(createdAt,id)` list cursors while preserving the existing decoded `{ createdAt: Date; id: string }` shape. Malformed, non-canonical, and unsupported-version cursors return the standard 400 validation error. Legacy cursors are deliberately rejected; pagination is transient, so older clients restart from the first page.
- Added independent `limit` (default 25, maximum 100), `linkedCursor`, and `probableCursor` handling. Both feedback sections query `limit + 1` in descending deterministic order with timestamp/id tie-breaks and independent `hasMore`/`nextCursor` metadata.
- Kept the timeline feedback-only. Linked rows require the requested contact and `entityType = feedback`; probable feedback is team-scoped, matches the existing email or exact user identity policy, and excludes feedback linked to any contact.
- Updated the contact detail page and inbox contact panel with independent rows, first-page/load-more loading and error state, retry affordances, and controls. Per-section request generations reject overlapping stale work without cancelling the other section; a full link/unlink refresh invalidates both. Load-more failures preserve loaded rows. Automatic links retain the `Automatically linked` label.
- Added an optional `section=linked|probable` query so each UI control performs only its section's database work. Updated OpenAPI with its validation errors and concrete link response schema.

## RED evidence

- Before implementation, `tests/contact-cursor.test.ts` failed because encoded cursors had no `v: 1` field.
- Before implementation, `tests/support-timeline.test.ts` failed because the timeline helper returned no independent page metadata.
- The first real-Postgres pagination attempt failed on a nondeterministic test fixture tie-breaker; the fixture was corrected to use deterministic link IDs, then the same test passed.

## GREEN evidence

- Focused cursor/timeline/route validation after review fixes: 3 files, 23 tests passed. The route tests cover omitted/max/invalid limits, invalid sections, malformed/non-v1 cursors, and one-query linked/probable section requests.
- Focused real Postgres: `tests/integration/support-timeline-pagination.test.ts`, 1 test passed against local Postgres.
- `yarn typecheck`: passed.
- Changed-file ESLint: 0 errors, 0 warnings.
- `yarn harness:verify`: passed against the isolated migrated database; 42 unit files / 471 tests, Redis 6/6, Postgres 8 files / 65 tests, typecheck and lint. The guarded E2E command skipped because `PLAYWRIGHT_FORCE=1` was not set; the focused serial browser run below was forced separately.
- Focused serial Playwright against the warmed isolated runtime at `http://localhost:4913`: 3/3 passed. This proves tenant scoping, authenticated auto-link/unlink, both independent Load more controls with 51 rows per section, preservation and manual retry after both automatic GET attempts return 503, and rejection of a delayed stale page after unlink/reset.

## Runtime notes

- Direct SSR navigation to protected routes can lock this Windows Nuxt development runtime after warm-up. The browser spec therefore loads the public login shell and uses the hydrated Nuxt client router, which exercises the same authenticated route middleware and page behavior without the dev-only SSR lock.
- `yarn build` completed the client and SSR application bundles, then failed during Nitro packaging in third-party Scalar/VueUse code: Rollup reported invalid transformed syntax in `node_modules/@vueuse/core/dist/index.js`. The source dependency file is valid on disk. This packaging/toolchain issue is separate from the Task 6 feature and remains to be isolated before release readiness.

## Files

See the Task 6 brief's exact scoped file list. No unrelated files were changed.
