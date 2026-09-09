# SUP-05A-4 — Local composer drafts

Implement local draft persistence keyed by `(conversationId, mode)` that restores composer mode, clears on
send, and shows an unsaved-draft indicator in the list.

## Binding behavior

- Reply and note drafts coexist independently for the same conversation.
- Restoring a draft restores its own reply/note mode; never load note text into reply mode.
- Clear only the matching mode draft after a successful send; failed sends retain the draft.
- Show an unsaved-draft indicator on the conversation row when either mode has text.
- Client-local only: no expiry, server sync, undo-send, or other deferred Stage 05 scope.
- Preserve the existing Options API composer and unmistakable reply/note styling.
- UI behavior requires focused forced Playwright coverage.
