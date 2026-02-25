# Public Board Pinning Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make pinned feedback items sort to the top of the public board list, show a visual pin indicator on cards, and reload the list after an admin toggles pin.

**Architecture:** Two-file change. The API adds `isPinned DESC` as the first ORDER BY clause and filters out hidden items. The Vue component adds a pin badge to cards and reloads the list (instead of patching local state) after a pin toggle.

**Tech Stack:** Nuxt 3, Vue 3 Options API, Drizzle ORM (`drizzle-orm`), TypeScript, Tailwind CSS, shadcn-vue icons via `lucide:*`.

---

### Task 1: Update the feedback list API to sort pinned items first and hide hidden items

**Files:**
- Modify: `server/api/feedback/index.get.ts`

**Step 1: Understand current sort logic**

Open `server/api/feedback/index.get.ts` and find the `orderBy` call (around line 94). Currently it is:

```typescript
.orderBy(orderFn(sortColumn))
```

**Step 2: Add `isPinned DESC` as the leading sort key**

Replace:

```typescript
.orderBy(orderFn(sortColumn))
```

with:

```typescript
.orderBy(desc(feedback.isPinned), orderFn(sortColumn))
```

`desc` is already imported from `drizzle-orm` on line 2. No new import needed.

**Step 3: Filter out hidden items**

In the conditions block (around line 43–54), add a condition to exclude hidden items so they never appear on the public board:

```typescript
conditions.push(eq(feedback.isHidden, false))
```

Add this line after the existing `conditions.push(...)` calls and before the `whereClause` assignment. `eq` is already imported.

**Step 4: Run the linter**

```bash
yarn lint
```

Expected: no errors.

**Step 5: Commit**

```bash
git add server/api/feedback/index.get.ts
git commit -m "feat(feedback):sort pinned items first and hide hidden from public feed"
```

---

### Task 2: Show a pin indicator on pinned cards in the public board

**Files:**
- Modify: `components/public/PublicFeedbackBoard.vue`

**Step 1: Locate the feedback card title row**

In `PublicFeedbackBoard.vue`, find the `<h3>` that renders the feedback title (around line 228):

```html
<h3 class="font-medium">{{ item.title }}</h3>
```

**Step 2: Add a pin icon next to the title for pinned items**

Replace:

```html
<h3 class="font-medium">{{ item.title }}</h3>
```

with:

```html
<h3 class="font-medium flex items-center gap-1.5">
  <Icon
    v-if="item.isPinned"
    name="lucide:pin"
    class="w-3.5 h-3.5 text-primary shrink-0"
    data-testid="public-feedback-pinned-icon"
  />
  {{ item.title }}
</h3>
```

**Step 3: Run the linter**

```bash
yarn lint
```

Expected: no errors.

---

### Task 3: Reload the list after toggling pin

**Files:**
- Modify: `components/public/PublicFeedbackBoard.vue`

**Step 1: Locate `adminTogglePin` method**

Find the method around line 1123:

```javascript
async adminTogglePin() {
  try {
    const response = await $fetch(`/api/feedback/${this.selectedFeedbackId}/pin`, { method: 'PATCH' })
    const updated = response?.data
    if (updated && this.selectedFeedback) {
      this.selectedFeedback.isPinned = updated.isPinned
    }
    const listItem = this.feedbackItems.find((item) => item.id === this.selectedFeedbackId)
    if (listItem && updated) listItem.isPinned = updated.isPinned
  } catch (err) {
    console.error('Error toggling pin:', err)
  }
},
```

**Step 2: Replace local state patch with a list reload**

Replace the entire `adminTogglePin` method with:

```javascript
async adminTogglePin() {
  try {
    const response = await $fetch(`/api/feedback/${this.selectedFeedbackId}/pin`, { method: 'PATCH' })
    const updated = response?.data
    if (updated && this.selectedFeedback) {
      this.selectedFeedback.isPinned = updated.isPinned
    }
    await this.loadFeedback()
  } catch (err) {
    console.error('Error toggling pin:', err)
  }
},
```

The `loadFeedback()` method already exists on the component and handles pagination state correctly.

**Step 3: Run the linter**

```bash
yarn lint
```

Expected: no errors.

**Step 4: Run the test suite**

```bash
yarn test
```

Expected: all tests pass (no existing tests cover this specific code path directly, but regressions should not occur).

**Step 5: Commit**

```bash
git add components/public/PublicFeedbackBoard.vue
git commit -m "feat(public-board):show pin indicator on cards and reload list after pin toggle"
```

---

### Task 4: Mark the TODO item as done and commit the design doc

**Files:**
- Modify: `TODO.md`
- Already created: `docs/plans/2026-02-25-public-board-pinning-design.md`

**Step 1: Mark the TODO item as done**

In `TODO.md`, find:

```markdown
- [ ] For the public feedback board, please add a pinning feature, so that product admins can pin important feedback items to the top of the board. This will allow them to highlight key feedback and ensure it gets the attention it deserves.
```

Replace `- [ ]` with `- [x]` and add an implementation note below it:

```markdown
- [x] For the public feedback board, please add a pinning feature, so that product admins can pin important feedback items to the top of the board. This will allow them to highlight key feedback and ensure it gets the attention it deserves.
  - Pinned items now sort to top via `isPinned DESC` in `server/api/feedback/index.get.ts`; pin icon indicator added to cards; list reloads after pin toggle in `components/public/PublicFeedbackBoard.vue`. Hidden items also filtered from public feed.
```

**Step 2: Commit**

```bash
git add TODO.md docs/plans/2026-02-25-public-board-pinning-design.md docs/plans/2026-02-25-public-board-pinning.md
git commit -m "chore(docs):mark public board pinning as done and add design+plan docs"
```
