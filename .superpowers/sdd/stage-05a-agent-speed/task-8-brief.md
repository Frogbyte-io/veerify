# SUP-05A-8 implementation brief

Add focused Playwright acceptance coverage for the final Stage 05A cross-feature workflows:

- An outgoing reply auto-claims an unassigned conversation, while an internal note does not claim it.
- Reply and internal-note drafts restore their own text and mode independently for the same conversation.
- A resolved conversation can be found from another fixed view through global search and remains deep-linkable.

Use the existing seeded auth/database helpers and current support UI/API contracts. Keep the spec deterministic,
clean up all created rows in `finally`, and do not change production behavior unless a test exposes a real Stage 05A
defect. Add only focused Playwright coverage (plus minimal test helpers if required); do not edit `TODO.md` or
`progress.md` on the worker branch. Write the canonical worker report to `task-8-report.md`.
