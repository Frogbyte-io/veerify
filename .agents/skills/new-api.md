# Skill: /new-api — Scaffold a Protected Server API Endpoint

When the user invokes `/new-api`, follow this process exactly.

## Step 1 — Gather requirements

Ask the user for the following if not already provided:

1. **Route path** — e.g. `teams/[teamId]/members` → file will be `server/api/teams/[teamId]/members.<method>.ts`
2. **HTTP method** — GET, POST, PUT, PATCH, or DELETE
3. **Auth requirement** — Required (session must exist) or Optional (anonymous allowed)
4. **Brief description** — what the endpoint does (used to scaffold comments)

## Step 2 — Determine the file path

Nuxt server routes follow this convention:

| Method | File suffix |
|--------|------------|
| GET    | `.get.ts`  |
| POST   | `.post.ts` |
| PUT    | `.put.ts`  |
| PATCH  | `.patch.ts`|
| DELETE | `.delete.ts`|

File location: `server/api/<route-path>.<method>.ts`

Dynamic segments use bracket notation: `[id]`, `[teamId]`, `[slug]`, etc.

## Step 3 — Scaffold the file

Use this template. Adapt imports to only what is actually needed.

```typescript
import { auth } from '~/lib/auth'
import { db } from '~/server/database/drizzle'
// import { tableName } from '~/server/database/schema/auth'
// import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  // 1. Validate session
  const session = await auth.api.getSession({
    headers: event.node.req.headers as any,
  })
  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  // 2. Read route params / query / body
  // const { id } = getRouterParams(event)
  // const query = getQuery(event)
  // const body = await readBody(event)

  // 3. Validate inputs
  // if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing id' })

  // 4. Query / mutate with Drizzle
  // const result = await db.select().from(tableName).where(eq(tableName.id, id))

  // 5. Return structured response
  return { success: true }
})
```

### If auth is Optional (anonymous allowed):

Replace the hard session guard with a soft check:

```typescript
  // Session is optional — anonymous requests are allowed
  const session = await auth.api.getSession({
    headers: event.node.req.headers as any,
  })
  const userId = session?.user?.id ?? null
```

### If the endpoint touches a project or feedback:

Always use utilities from `server/utils/project-access.ts`. Never rely on bare `projectId` param:

```typescript
import { requireProjectAccess } from '~/server/utils/project-access'

// For authenticated access:
await requireProjectAccess(projectId, session.user.id)

// For public/anonymous access:
await requirePublicProject(projectId)
```

## Step 4 — Error handling rules

Always `createError()`, never `throw new Error()`:

```typescript
throw createError({ statusCode: 400, statusMessage: 'Validation failed' })
throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
throw createError({ statusCode: 404, statusMessage: 'Not found' })
throw createError({ statusCode: 500, statusMessage: 'Internal server error' })
```

## Step 5 — Checklist before finishing

- [ ] Session validated (or intentionally optional)
- [ ] Route params / body read with correct Nuxt helpers (`getRouterParams`, `getQuery`, `readBody`)
- [ ] Project/feedback access checked via utilities if applicable
- [ ] All error paths use `createError()`
- [ ] File is in the correct `server/api/` location with the correct method suffix
- [ ] No unused imports left in the file
