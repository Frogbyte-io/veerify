# Multi-Product Feedback Create Flow — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When multiple products are selected on `/feedback`, enable the Add Feedback button and show a step-1 project-picker (scrollable card list) before the step-2 feedback form.

**Architecture:** All changes are contained in `pages/feedback/index.vue` (Options API). A `createDialogStep` state field drives which view the single Dialog renders. Step 1 is a scrollable list of project cards; clicking one sets `createForm.projectId`, loads categories, and advances to step 2. Single-product flow skips step 1.

**Tech Stack:** Nuxt 3, Vue 3 Options API, shadcn-vue (Dialog, Card, Button), Tailwind CSS v4, Playwright for E2E tests.

---

### Task 1: Extend component state and fix `canCreateFeedback`

**Files:**
- Modify: `pages/feedback/index.vue` — `data()` and `canCreateFeedback` computed

**Step 1: Add new state fields in `data()`**

In the `data()` return object, add next to the existing `createForm`:

```js
createDialogStep: 'select-project', // 'select-project' | 'fill-form'
isLoadingDialogCategories: false,
```

Also add `projectId: ''` to the existing `createForm` object:

```js
createForm: { title: '', body: '', categoryId: null, projectId: '' },
```

**Step 2: Fix `canCreateFeedback` computed**

Replace:
```js
canCreateFeedback() {
  return Boolean(this.selectedProjectId)
},
```
With:
```js
canCreateFeedback() {
  return this.selectedProjectIds.length > 0
},
```

**Step 3: Run linter to confirm no errors**

```bash
yarn nuxi typecheck 2>&1 | head -30
```

Expected: no new errors related to `canCreateFeedback`.

---

### Task 2: Add `openCreateDialog` and `selectDialogProject` methods

**Files:**
- Modify: `pages/feedback/index.vue` — `methods`

**Step 1: Add `openCreateDialog()` method**

Add after `loadGithubIntegrations`:

```js
openCreateDialog() {
  this.createForm = { title: '', body: '', categoryId: null, projectId: '' }
  if (this.selectedProjectIds.length === 1) {
    this.createForm.projectId = this.selectedProjectIds[0]
    this.createDialogStep = 'fill-form'
    this.loadDialogCategories()
  } else {
    this.createDialogStep = 'select-project'
  }
  this.showCreateDialog = true
},
```

**Step 2: Add `selectDialogProject(project)` method**

```js
selectDialogProject(project) {
  this.createForm.projectId = project.id
  this.createForm.categoryId = null
  this.createDialogStep = 'fill-form'
  this.loadDialogCategories()
},
```

**Step 3: Add `loadDialogCategories()` method**

```js
async loadDialogCategories() {
  const project = this.products.find((p) => p.id === this.createForm.projectId)
  if (!project?.slug) {
    this.categories = []
    return
  }
  this.isLoadingDialogCategories = true
  try {
    const response = await $fetch(`/api/projects/${project.slug}/categories`)
    this.categories = response?.data || []
  } catch (err) {
    console.error('Error loading categories for dialog:', err)
    this.categories = []
  } finally {
    this.isLoadingDialogCategories = false
  }
},
```

**Step 4: Update `createFeedback()` to use `createForm.projectId`**

Replace the guard and body line:
```js
// Old:
if (!this.selectedProjectId || !this.createForm.title || !this.createForm.body) return
// ...
projectId: this.selectedProjectId,

// New:
if (!this.createForm.projectId || !this.createForm.title || !this.createForm.body) return
// ...
projectId: this.createForm.projectId,
```

---

### Task 3: Replace all `showCreateDialog = true` call sites with `openCreateDialog()`

**Files:**
- Modify: `pages/feedback/index.vue` — template

There are three places in the template that set `showCreateDialog = true` directly:

1. Header "Add Feedback" button: `@click="showCreateDialog = true"` → `@click="openCreateDialog()"`
2. Empty feedback state "Add Feedback" button: `@click="showCreateDialog = true"` → `@click="openCreateDialog()"`
3. Dialog close/reset when `open` changes — no change needed there (it's `@update:open="showCreateDialog = $event"`).

Also update the `onDialogClose` reset — when dialog closes, reset `createDialogStep`:

In the `@update:open` handler on the Dialog, wrap it:

```html
@update:open="(v) => { showCreateDialog = v; if (!v) createDialogStep = 'select-project' }"
```

---

### Task 4: Update the Create Feedback Dialog template

**Files:**
- Modify: `pages/feedback/index.vue` — the Create Feedback `<Dialog>` block (lines ~422–459)

**Step 1: Replace the static DialogHeader description**

Replace the hardcoded description that references `selectedProject` with one that reacts to `createForm.projectId`:

```html
<DialogDescription>
  {{ createDialogStep === 'select-project'
    ? 'Choose which product to submit feedback for.'
    : `Create a new feedback item for ${products.find(p => p.id === createForm.projectId)?.name || 'this product'}.`
  }}
</DialogDescription>
```

**Step 2: Replace the dialog body with conditional steps**

Replace the `<div class="space-y-4 py-4">` block with:

```html
<!-- Step 1: Project picker (multi-product only) -->
<div v-if="createDialogStep === 'select-project'" class="py-2">
  <div class="max-h-[320px] overflow-y-auto space-y-2 pr-1">
    <button
      v-for="p in products.filter(prod => selectedProjectIds.includes(prod.id))"
      :key="p.id"
      :data-testid="`feedback-create-project-${p.id}`"
      type="button"
      class="w-full text-left rounded-lg border bg-card p-4 hover:border-primary hover:bg-primary/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      @click="selectDialogProject(p)"
    >
      <div class="flex items-center gap-3">
        <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon name="lucide:package" class="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <p class="text-sm font-medium leading-none">{{ p.name }}</p>
          <p v-if="p.description" class="mt-1 text-xs text-muted-foreground line-clamp-1">{{ p.description }}</p>
        </div>
        <Icon name="lucide:chevron-right" class="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
    </button>
  </div>
</div>

<!-- Step 2: Feedback form -->
<div v-else class="space-y-4 py-4">
  <div class="space-y-2">
    <Label for="feedback-title">Title</Label>
    <Input id="feedback-title" v-model="createForm.title" data-testid="feedback-create-title"
      placeholder="Brief summary of the feedback" />
  </div>
  <div class="space-y-2">
    <Label for="feedback-body">Description</Label>
    <textarea id="feedback-body" v-model="createForm.body" data-testid="feedback-create-body"
      placeholder="Provide details about the feedback" rows="4"
      class="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
  </div>
  <div v-if="isLoadingDialogCategories" class="space-y-2">
    <Skeleton class="h-4 w-20" />
    <Skeleton class="h-10 w-full" />
  </div>
  <div v-else-if="categories.length > 0" class="space-y-2">
    <Label for="feedback-category">Category</Label>
    <select id="feedback-category" v-model="createForm.categoryId" data-testid="feedback-create-category"
      class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      <option :value="null">No category</option>
      <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
    </select>
  </div>
</div>
```

**Step 3: Update the DialogFooter**

Replace the existing footer:

```html
<DialogFooter>
  <!-- Back button — only shown in fill-form step when there were multiple products -->
  <Button
    v-if="createDialogStep === 'fill-form' && selectedProjectIds.length > 1"
    variant="ghost"
    class="mr-auto"
    @click="createDialogStep = 'select-project'"
  >
    <Icon name="lucide:arrow-left" class="w-4 h-4 mr-2" />
    Back
  </Button>
  <Button variant="outline" @click="showCreateDialog = false">Cancel</Button>
  <Button
    v-if="createDialogStep === 'fill-form'"
    data-testid="feedback-create-submit"
    :disabled="isCreating || !createForm.title || !createForm.body"
    @click="createFeedback"
  >
    <Icon v-if="isCreating" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
    Add Feedback
  </Button>
</DialogFooter>
```

---

### Task 5: Write E2E test for multi-product project picker

**Files:**
- Modify: `tests/e2e/admin-feedback.spec.ts`

**Step 1: Add a test that creates two products, selects both, and verifies the picker appears**

Append a new `test` block inside the existing `test.describe('Admin feedback workflow', ...)`:

```ts
test('UI: multi-product picker shown when 2 products selected, skipped for single', async ({ page, request }) => {
  const sessionCookie = await signInAndGetSessionCookie(request)
  const teamId = await getActiveTeamId(request, sessionCookie)

  const slugA = `e2e-picker-a-${Date.now()}`
  const slugB = `e2e-picker-b-${Date.now()}`
  const projectIdA = await createTestProject(request, sessionCookie, teamId, slugA)
  const projectIdB = await createTestProject(request, sessionCookie, teamId, slugB)

  try {
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await page.fill('[data-testid="login-email"]', TEST_EMAIL)
    await page.fill('[data-testid="login-password"]', TEST_PASSWORD)
    await page.click('[data-testid="login-submit"]')
    await page.waitForURL('**/dashboard', { timeout: 30_000 })

    await gotoWithRetry(page, '/feedback')
    await page.waitForSelector('[data-testid="feedback-page-title"]', { timeout: 30_000 })

    // Select both products using the filter
    await page.click('[data-testid="feedback-products-filter-trigger"]')
    await page.click(`[data-testid="feedback-products-filter-item-${projectIdA}"]`)
    await page.click(`[data-testid="feedback-products-filter-item-${projectIdB}"]`)
    await page.keyboard.press('Escape')

    // Button should now be enabled
    const addBtn = page.getByTestId('feedback-add-button')
    await expect(addBtn).toBeEnabled()

    // Click — step 1 (project picker) should appear
    await addBtn.click()
    await expect(page.getByTestId(`feedback-create-project-${projectIdA}`)).toBeVisible()
    await expect(page.getByTestId(`feedback-create-project-${projectIdB}`)).toBeVisible()

    // Click project A card — should advance to step 2 (form)
    await page.getByTestId(`feedback-create-project-${projectIdA}`).click()
    await expect(page.getByTestId('feedback-create-title')).toBeVisible()

    // Back button should exist
    await expect(page.locator('button:has-text("Back")')).toBeVisible()

    // Cancel
    await page.getByRole('button', { name: 'Cancel' }).click()

    // Now select only one product and verify step 1 is skipped
    await page.click('[data-testid="feedback-products-filter-trigger"]')
    // Deselect project B
    await page.click(`[data-testid="feedback-products-filter-item-${projectIdB}"]`)
    await page.keyboard.press('Escape')

    await addBtn.click()
    // Should jump straight to form
    await expect(page.getByTestId('feedback-create-title')).toBeVisible()
    // No project cards visible
    await expect(page.getByTestId(`feedback-create-project-${projectIdA}`)).not.toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
  } finally {
    await deleteTestProject(request, sessionCookie, teamId, projectIdA)
    await deleteTestProject(request, sessionCookie, teamId, projectIdB)
  }
})
```

---

### Task 6: Mark TODO as done and commit

**Step 1: Mark the item done in `TODO.md`**

Find the line:
```
- [ ] For the private feedback collection at /feedback, the add feedback button should still work, but if multiple products are selected in the product filter dropdown, it should ask which product the feedback is for when I click the add feedback button.
```
Change `- [ ]` to `- [x]` and add a note below:
```
  - Two-step dialog: scrollable project-card picker (step 1) → feedback form (step 2); single-product flow skips step 1.
```

**Step 2: Stage only touched files**

```bash
git add pages/feedback/index.vue tests/e2e/admin-feedback.spec.ts TODO.md docs/plans/2026-02-24-multi-product-feedback-create-design.md docs/plans/2026-02-24-multi-product-feedback-create.md
```

**Step 3: Commit**

```bash
git commit -m "feat(feedback):show project picker when multiple products selected for add feedback"
```
