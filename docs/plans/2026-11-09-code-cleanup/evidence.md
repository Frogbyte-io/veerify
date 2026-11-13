# Evidence before deletion

Baseline: a4b9e8c. Searches below ran before source edits over tracked repository source, tests and docs. Nuxt-generated declarations advertise exports automatically; declarations alone do not call them. No namespace import or string dispatch referencing the removed modules/symbols was found.

1. `rg -n 'notifyProjectTeam' --hidden -g '!.git' -g '!node_modules' -g '!.nuxt'`
   - notifications.ts:198: alias declaration.
   - feedback/[id]/status.patch.ts:48,121; feedback/[id]/comments.post.ts:55,209; feedback/index.post.ts:61,385: three imports and three calls.
   - Two historical design/plan documents also mention the old name. These remain historical records.
   - Migrate all callers to the identical underlying function before removing the alias. Notification recipient/preferences logic is untouched.
2. `rg -n 'defineOpenAPIRoute|OpenAPIOperation|OpenAPIParameter|OpenAPIRequestBody|OpenAPIResponse|OpenAPISchema|openapiCommonSchemas|commonResponses'`
   - Definitions/self-references only in server/utils/openapi.ts; one historical spec mentions defineOpenAPIRoute.
   - No source caller or test. scripts/openapi-scanner.ts:18,25 reads @openapi JSDoc directly; server/generated/openapi-routes.ts supplies the actual spec.
   - Remove obsolete helper module, preserving scanner, route comments and generated output.
3. `rg -n '\b(requireOrganizationRole|hasOrganizationRole)\b'`
   - auth-middleware.ts:123,145,152 only: two definitions and the internal call between them.
   - No entry point or test calls either; active routes use requireOrganizationRoleBySlug (different function), requireOrganizationAdmin and project access utilities.
   - Remove pair and imports used only by them; preserve requireAuth and requireInteractiveSession.
4. `rg -n '\bresolveCompletedLabel\b'`
   - github-webhook.ts:51 definition only; no test references.
   - Active routes use resolveStatusLabel, covered by tests/github-webhook-utils.test.ts. Remove obsolete resolver, preserve active one.

## Kept

- getPeerChannels: no current call, but explicitly exposed for diagnostics; retained conservatively.
- auth-schema.ts: required Better Auth reference by project contract.
- components/ui, pages, server/api, plugins, middleware and tasks: convention-loaded/generated entry points cannot be classified by import count.
- Constants and functions with only one referencing file: many are called internally. File-count heuristics are insufficient evidence.
- Legacy redirects, crypto fallbacks and sender policies: compatibility behavior remains in use.
- Similar roadmap/changelog access guards: intentionally separate policies with dedicated tests; avoid creating an abstraction solely to reduce a few lines.

The map is a static import/component view. It cannot establish runtime HTTP, event, database or dynamically loaded reachability; these limitations are explicit in the HTML.
