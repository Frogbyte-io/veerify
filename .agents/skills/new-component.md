# Skill: /new-component — Scaffold an Options API Vue Component

When the user invokes `/new-component`, follow this process exactly.

## Step 1 — Gather requirements

Ask the user for the following if not already provided:

1. **Component name** — PascalCase, e.g. `FeedbackCard`, `TeamMemberList`
2. **Location** — which `components/` subfolder, e.g. `components/feedback/`, `components/settings/`
3. **Purpose** — brief description of what it renders or does
4. **Props** — list of props it should accept (name, type, required/optional)
5. **Emits** — any events it should emit upward to a parent

## Step 2 — Determine the file path

```
components/<subfolder>/<ComponentName>.vue
```

Examples:

- `components/feedback/FeedbackCard.vue`
- `components/settings/SettingsBilling.vue`
- `components/sidebar/NavTeam.vue`

Do **not** place files in `components/ui/` — that folder is managed by the shadcn-vue CLI.

## Step 3 — Scaffold the component

```vue
<template>
  <div>
    <!-- Loading state (if component fetches its own data) -->
    <div v-if="isLoading" class="flex flex-col gap-3">
      <Skeleton class="h-12 w-full rounded-md" />
      <Skeleton class="h-12 w-full rounded-md" />
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="flex flex-col items-center gap-3 py-8">
      <p class="text-muted-foreground text-sm">Failed to load.</p>
      <Button variant="outline" size="sm" @click="load">Retry</Button>
    </div>

    <!-- Content -->
    <div v-else>
      <!-- component content -->
    </div>
  </div>
</template>

<script>
export default {
  name: 'ComponentName',

  props: {
    // exampleProp: {
    //   type: String,
    //   required: true,
    // },
    // optionalProp: {
    //   type: Number,
    //   default: 0,
    // },
  },

  emits: [
    // 'update',
    // 'delete',
  ],

  data() {
    return {
      isLoading: false,
      error: null,
    }
  },

  computed: {
    // derivedValue() {
    //   return this.exampleProp.toUpperCase()
    // },
  },

  async mounted() {
    // await this.load()
  },

  methods: {
    async load() {
      this.isLoading = true
      this.error = null
      try {
        // const data = await $fetch('/api/...')
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

## Step 4 — Key conventions

### Omit sections that are not needed

- If the component does **not** fetch data, remove `isLoading`, `error`, `load()`, and the skeleton/error states.
- If there are **no props**, remove the `props` block entirely.
- If there are **no emits**, remove the `emits` array.
- If there are **no computed** properties, remove that block.
- Keep the component lean — do not add boilerplate that won't be used.

### Emitting events

```vue
<Button @click="$emit('delete', item.id)">Delete</Button>
```

Or in a method:

```js
this.$emit('update', { id: this.item.id, name: this.name })
```

### Using shadcn-vue components

All shadcn-vue components (`Button`, `Card`, `Input`, `Badge`, `Skeleton`, etc.) are auto-imported — no import statement needed.

### Icons

```vue
<Icon name="lucide:trash-2" class="h-4 w-4" />
```

Never import from `lucide-vue-next`.

### Class merging

```js
import { cn } from '~/lib/utils'
// Then in template:
// :class="cn('base-class', { 'conditional-class': condition })"
```

## Step 5 — Checklist before finishing

- [ ] Options API only — no `<script setup>`, `ref()`, `reactive()`, or `computed()` from Vue
- [ ] Component name is PascalCase and matches the `name` property
- [ ] File is in the correct `components/<subfolder>/` location (not in `components/ui/`)
- [ ] Unused blocks (props, emits, computed, lifecycle) are removed
- [ ] Loading state uses `<Skeleton>` if data is fetched
- [ ] Error state includes a retry button if data is fetched
- [ ] Icons use `<Icon name="lucide:*" />`
- [ ] No manual imports for auto-imported components
