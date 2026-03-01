# Design: Public Board Pinning Feature

**Date:** 2026-02-25
**Status:** Approved

## Problem

The `isPinned` field, `PATCH /api/feedback/[id]/pin` API, and `adminTogglePin()` UI method all exist, but:

1. The feedback list query does not sort pinned items to the top.
2. No visual pin indicator appears on pinned cards in the public board list.
3. After toggling pin, the list is updated in-place without reloading, so sort order is not corrected.

## Scope

Two files change:

- `server/api/feedback/index.get.ts`
- `components/public/PublicFeedbackBoard.vue`

## Design

### API (`index.get.ts`)

Add `isPinned DESC` as the leading ORDER BY clause so pinned items always float to the top within any sort mode:

```
ORDER BY feedback.is_pinned DESC, <sortColumn> <sortOrder>
```

Also filter out hidden items for non-admin callers (items where `isHidden = true` should not appear on the public board).

### Frontend (`PublicFeedbackBoard.vue`)

**Pin indicator on cards:** Show a small `lucide:pin` icon next to the title when `item.isPinned` is true. Use `text-primary` colour so it is clearly intentional.

**Reload after toggle:** Replace the local-state-only update in `adminTogglePin()` with a call to `loadFeedback()` so the list re-fetches from the server and reflects the new sort order. Close the details dialog first so the UX is clean.

**Admin access:** `isAdmin` is already set correctly via the `/api/teams/list-user` check. The Pin/Unpin dropdown item in the admin dropdown in the details dialog is already gated by `v-if="isAdmin"`, so logged-in board owners already see it. No additional auth changes needed.

## Files Changed

| File                                        | Change                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `server/api/feedback/index.get.ts`          | Add `desc(feedback.isPinned)` as first ORDER BY; add `eq(feedback.isHidden, false)` to conditions |
| `components/public/PublicFeedbackBoard.vue` | Pin icon on card, reload after toggle                                                             |

## Testing

- Run existing test suite (`yarn test`)
- Run linter (`yarn lint`)
