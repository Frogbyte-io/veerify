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
| -------------------- | ----------------------------------- |
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
  '/reports', // ← add new prefix here if not already present
  '/help',
]
```

Only add if the prefix is not already covered by an existing entry.

## Step 4 — Scaffold the page file

### Dashboard page (protected, `dashboard` layout)

```vue
<template>
  <!-- The dashboard layout comes from route meta (nuxt.config.ts). Never wrap the page in <NuxtLayout>. -->
  <PageContainer>
    <PageHeader title="Page Title" description="Brief description of this page.">
      <template #actions>
        <!-- Render actions from the first paint; disable them while loading -->
        <Button :disabled="isLoading">Action</Button>
      </template>
    </PageHeader>

    <!-- Loading state: shaped like the content. One element per branch. -->
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
  </PageContainer>
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
  <NuxtLayout name="clean">
    <AuthCard title="Page Title" description="Description here.">
      <!-- form content -->
    </AuthCard>
  </NuxtLayout>
</template>

<script>
export default {
  name: 'PageName',

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
- [ ] Dashboard page: its top-level folder is in `DASHBOARD_PAGE` in `nuxt.config.ts`, and it has no `<NuxtLayout>` wrapper
- [ ] Dashboard page uses `PageContainer` + `PageHeader` (width `narrow` for detail/editor pages, `full` for boards)
- [ ] Clean page wraps its content in `<NuxtLayout name="clean">` and uses `AuthCard`
- [ ] Options API used — no `<script setup>`, no `ref()`, no `reactive()`
- [ ] Loading state uses `<Skeleton>` — no placeholder/fake data
- [ ] Error state has a retry mechanism
- [ ] Icons use `<Icon name="lucide:*" />` — not imported from `lucide-vue-next`
- [ ] No manual component imports (auto-imported by Nuxt)
