# Skill: /db-change — Guide a Schema Change + Migration End-to-End

When the user invokes `/db-change`, follow this process exactly.

## Step 1 — Gather requirements

Ask the user for the following if not already provided:

1. **What needs to change?** — add a column, add a table, modify a column type, add an index, etc.
2. **Which table(s)?** — existing table name(s) or name of the new table
3. **Column details** — name, type, nullable/not-null, default value, foreign keys

## Step 2 — Edit the schema file

The single source of truth for the database schema is:

```
server/database/schema/auth.ts
```

All tables are defined with `pgTable` from `drizzle-orm/pg-core`. Common column types:

```typescript
import {
  pgTable,
  text,
  boolean,
  timestamp,
  integer,
  varchar,
  uuid,
} from 'drizzle-orm/pg-core'
```

### Adding a column to an existing table

```typescript
export const myTable = pgTable('my_table', {
  // existing columns...
  newColumn: text('new_column'),                        // nullable text
  requiredColumn: text('required_column').notNull(),    // not-null text
  withDefault: boolean('with_default').notNull().default(false),
  foreignKey: text('other_id').references(() => otherTable.id),
})
```

### Adding a new table

Follow the pattern of existing tables. Always include `id` as the primary key:

```typescript
export const newTable = pgTable('new_table', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})
```

### Also update `server/database/schema/index.ts`

If adding a new table, export it from the index:

```typescript
export * from './auth'
// export * from './new-module'  ← add if creating a new schema file
```

### Also update `auth-schema.ts` at the project root

This file mirrors the schema for BetterAuth. If the change involves auth-related tables (`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, `twoFactor`), update `auth-schema.ts` to match.

## Step 3 — Generate the migration

After saving the schema file, run:

```bash
yarn db:generate
```

This creates a new SQL file in `server/database/migrations/`. The filename will be timestamped.

## Step 4 — Review the generated SQL

Open the new migration file and verify:

- [ ] The correct table(s) are being altered
- [ ] Column types match what was intended
- [ ] No unintended `DROP` or `ALTER` statements
- [ ] Foreign key references are correct

**Never edit the generated SQL file manually.**

## Step 5 — Apply the migration

```bash
yarn db:migrate
```

This runs all pending migrations against the database. Verify there are no errors.

## Step 6 — Update TypeScript usages

After the schema change, update any server API routes or utilities that query the affected table(s):

- Import the new column/table where needed
- Update Drizzle queries (`select`, `insert`, `update`) to include/exclude the new field
- If a new table was added, create the corresponding API endpoints (use `/new-api`)

## Step 7 — Checklist before finishing

- [ ] `server/database/schema/auth.ts` has the schema change
- [ ] `server/database/schema/index.ts` exports any new table
- [ ] `auth-schema.ts` (root) is updated if auth tables were changed
- [ ] `yarn db:generate` was run and migration file was reviewed
- [ ] `yarn db:migrate` was run successfully
- [ ] Server code that queries affected tables is updated
- [ ] `.env.example` updated if any new env var was introduced

## Important rules

- **Never hand-write migration files** — always use `yarn db:generate`
- **Never use `yarn db:push` in production** — only in local dev for rapid iteration
- **Never drop columns** without checking all usages in the codebase first
