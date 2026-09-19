# SUP-05A-6 implementation brief

Implement global scoped search for the Stage 05A support inbox.

Requirements:

- Search conversations by `displayId`, subject, and contact name/email.
- Subject/contact fields use substring matching; a bare numeric query additionally matches `displayId` exactly (do not make numeric substring matching ambiguous).
- Search must be global across the current inbox's fixed views: it must bypass the selected Unassigned/Assigned-to-me/Resolved/All view filter while retaining inbox access/tenant scoping.
- Never query `conversationMessage`, use no message-body search, and do not introduce full-text/macro/deferred scope.
- Add the search control to the support UI with debounced/robust loading, preserve existing view/deep-link behavior when search clears, and use Options API conventions.
- Add focused API/unit and forced Playwright coverage, including finding a resolved conversation from Unassigned by contact email and bare ticket number.

Use generated schema tooling only if schema changes are truly needed (none should be needed), preserve drafts/read state/fixed views/canned responses, do not edit `TODO.md` or the progress ledger from the worker branch, and write the canonical report to `task-6-report.md`.
