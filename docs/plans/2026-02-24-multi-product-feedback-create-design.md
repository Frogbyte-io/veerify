# Design: Multi-product "Add Feedback" flow

**Date:** 2026-02-24
**Status:** Approved
**File:** `pages/feedback/index.vue`

## Problem

When multiple products are selected in the feedback page product filter, the **Add Feedback** button is disabled (`canCreateFeedback` returns false because `selectedProjectId` is null). The task requires the button to remain usable and ask the user which product they want to create feedback for.

## Solution

A two-step dialog flow. Step 1 is skipped when only one product is selected.

### Step 1 — Select Product _(multi-product only)_

A scrollable list of clickable project cards, one per currently-selected product. Clicking a card:

- Sets `createForm.projectId` to that project's ID
- Loads categories for that project
- Advances the dialog to step 2

### Step 2 — Fill Feedback Form

The existing title / description / category form. When the user arrived from step 1 (multi-product flow), a **Back** button is shown in the footer that returns to step 1. Cancel always closes the dialog.

## State changes

| Field                       | Type                              | Purpose                                    |
| --------------------------- | --------------------------------- | ------------------------------------------ |
| `createDialogStep`          | `'select-project' \| 'fill-form'` | Tracks current dialog step                 |
| `createForm.projectId`      | `string`                          | Project chosen for the new feedback item   |
| `isLoadingDialogCategories` | `boolean`                         | Loading indicator for categories in step 2 |

## Key method changes

- `canCreateFeedback` → `selectedProjectIds.length > 0` (enabled for ≥1 product)
- `openCreateDialog()` — new method replacing inline `showCreateDialog = true`:
  - Single product → set `createForm.projectId`, load categories, go to `fill-form`
  - Multi product → go to `select-project` with blank `createForm.projectId`
- `selectDialogProject(project)` — called when user clicks a card in step 1; loads categories and advances to step 2
- `createFeedback()` — uses `createForm.projectId` instead of `selectedProjectId`
- All `showCreateDialog = true` call sites replaced with `openCreateDialog()`

## Out of scope

- No changes to the API layer
- No new routes or components
- No changes to the product filter dropdown behaviour
