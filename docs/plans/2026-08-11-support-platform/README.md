# Support Platform — Plan Index

This directory retains the durable architecture and implementation notes for the support platform.
Detailed plans for completed stages and speculative future stages were removed after implementation;
`TODO.md` remains the task/status record.

## Current status

- Stages 00–08 are implemented. Stage 05 was intentionally narrowed to the 1–3 agent MVP; do not
  reintroduce deferred features such as macros or round-robin assignment.
- Stage 09 reporting foundations and Wave 1 are implemented. The remaining reporting work is
  deferred and is not an MVP launch prerequisite; see [remaining reporting](stage-09-delivery-plan.md)
  and [reporting scope](stage-09-reporting.md).
- Deployment readiness is tracked in the [Coolify staging/cutover plan](../2026-09-21-coolify-deployment.md).
  No live migration or production cutover has occurred.
- Real-provider email/storage validation is still pending. Use the
  [provider checklist](stage-01-04-provider-checklist.md); automated tests do not prove provider
  interoperability.

## Durable references

- [Architecture and data model](design.md)
- [Implementation deviations and decisions](deltas.md)
- [Active reporting delivery plan](stage-09-delivery-plan.md)
- [Reporting scope/status](stage-09-reporting.md)
- [External provider validation checklist](stage-01-04-provider-checklist.md)

## Operational constraints

- Keep support metrics behind `server/utils/support-observability.ts`. Metric names and fields are
  allowlisted; never log customer content, filenames, storage keys, or provider credentials.
- Realtime authentication resolves the session row directly. Do not pass session tokens through a
  global bearer-auth plugin or log WebSocket query strings.
- Use the support access helpers for protected support endpoints and the established migration,
  scheduler, and test conventions in `.agents/CLAUDE.md`.
- The Coolify path is planned but not deployed. Do not imply production cutover or real-provider
  validation from local verification alone.
