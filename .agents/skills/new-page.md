# Skill: /new-page — Scaffold a New Dashboard Page

When the user invokes `/new-page`, follow this process exactly.

## Step 1 — Gather requirements

Ask the user for the following if not already provided:

1. **Route path** — e.g. `/reports/analytics` → file at `pages/reports/analytics/index.vue` (or `pages/reports/analytics.vue`)
2. **Page title** — displayed in the page header
3. **Layout** — `dashboard` (default, protected) or `clean` (auth pages)
4. **Is it protected?** — Yes (requires login) or No (public/auth page)

## Step 2 — Determine the file path

Nuxt file-based routing:

| Desired URL          | File path                           |
|----------------------|-------------------------------------|
| `/reports`           | `pages/reports/index.vue`           |
| `/reports/analytics` | `pages/reports/analytics/index.vue` |
| `/settings/billing`  | `pages/settings/billing/index.vue`  |

Prefer `index.vue` inside a directory over a flat `.vue` file for extensibility.

## Step 3 — Register the route guard (protected pages only)

If the page is protected, open `middleware/auth.global.ts` and add the route prefix to the `protectedRoutes` array:

```typescript
const protectedRoutes = [
  '/dashboard',
  '/settings',
  '/feedback',
  '/reports',      // ← add new prefix here if not already present
  '/help',
]
```

Only add if the prefix is not already covered by an existing entry.

## Step 4 — Scaffold the page file

### Dashboard page (protected, `dashboard` layout)

```vue
<template>
  <div class="flex flex-col gap-6 p-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Page Title</h1>
      <p class="text-muted-foreground text-sm">Brief description of this page.</p>
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="flex flex-col gap-4">
      <Skeleton class="h-32 w-full rounded-lg" />
      <Skeleton class="h-32 w-full rounded-lg" />
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="flex flex-col items-center gap-4 py-12">
      <p class="text-muted-foreground text-sm">Failed to load data.</p>
      <Button variant="outline" @click="load">Retry</Button>
    </div>

    <!-- Content -->
    <div v-else>
      <!-- page content here -->
    </div>
  </div>
</template>

<script>
export default {
  name: 'PageName',

  data() {
    return {
      isLoading: false,
      error: null,
      items: [],
    }
  },

  async mounted() {
    await this.load()
  },

  methods: {
    async load() {
      this.isLoading = true
      this.error = null
      try {
        const data = await $fetch('/api/some-endpoint')
        this.items = data
      } catch (err) {
        this.error = err
      } finally {
        this.isLoading = false
      }
    },
  },
}
</script>
```

### Auth page (public, `clean` layout)

```vue
<template>
  <div class="flex min-h-screen items-center justify-center">
    <Card class="w-full max-w-md">
      <CardHeader>
        <CardTitle>Page Title</CardTitle>
        <CardDescription>Description here.</CardDescription>
      </CardHeader>
      <CardContent>
        <!-- form content -->
      </CardContent>
    </Card>
  </div>
</template>

<script>
export default {
  name: 'PageName',
  layout: 'clean',

  data() {
    return {
      isLoading: false,
      error: null,
    }
  },

  methods: {
    async submit() {
      this.isLoading = true
      this.error = null
      try {
        // action
      } catch (err) {
        this.error = err?.data?.message ?? 'Something went wrong'
      } finally {
        this.isLoading = false
      }
    },
  },
}
</script>
```

## Step 5 — Checklist before finishing

- [ ] File is at the correct path under `pages/`
- [ ] Protected route prefix is in `middleware/auth.global.ts` `protectedRoutes` array (if protected)
- [ ] Layout is set via `layout: 'clean'` for auth pages (dashboard is the default, no need to set explicitly)
- [ ] Options API used — no `<script setup>`, no `ref()`, no `reactive()`
- [ ] Loading state uses `<Skeleton>` — no placeholder/fake data
- [ ] Error state has a retry mechanism
- [ ] Icons use `<Icon name="lucide:*" />` — not imported from `lucide-vue-next`
- [ ] No manual component imports (auto-imported by Nuxt)
