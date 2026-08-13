# Support Platform — Plan Index

**Goal:** Build a Zendesk/Freshdesk-class support platform into Veerify, presented in a Chatwoot-style
conversation UI, so that support and product feedback live on one platform.

**Created:** August 11, 2026

**Read `design.md` first.** It holds the architecture, data model, and the reasoning behind decisions
that individual stage docs assume without re-arguing. Then read `deltas.md` — it records what the plan
got wrong once implementation started, and several entries contradict the original stage docs.

---

## Current state — updated August 13, 2026

**Integration branch: `support-platform`.** Not `main`. See delta D-17. Every stage validates here
until the program is deliberately integrated into `main`.

|                    |                                                                   |
| ------------------ | ----------------------------------------------------------------- |
| Stage 00           | **Complete** — 10/10 items                                        |
| Stage 01           | **In progress** — SUP-01-1 … SUP-01-4 done; next is **SUP-01-10** |
| Gates              | `yarn harness:verify` green — 138 tests, 0 lint errors            |
| Open cross-cutting | SUP-X-1 (Redis integration suite, delta D-15)                     |

**Related branches.** `sleekplan-export` holds an unrelated changelog + Sleekplan/CSV import feature
that was recovered from the working tree. Both branches define a migration `0019`, so merging them
requires regenerating one side's migration. Keep them apart unless you deliberately reconcile that.

**Before starting, verify your base** — several dispatched agents have silently begun on a stale commit:

```
git branch --show-current          # expect: support-platform
ls docs/plans/2026-08-11-support-platform/
ls server/services/realtime/
ls server/api/support/contacts/
```

---

## Stage map

| Stage                                | Title                     | Depends on | Status  |
| ------------------------------------ | ------------------------- | ---------- | ------- |
| [00](stage-00-foundations.md)        | Foundations               | —          | DONE    |
| [01](stage-01-contacts.md)           | Contact identity          | 00         | ACTIVE  |
| [02](stage-02-conversation-core.md)  | Inbox + conversation core | 00, 01     | Next    |
| [03](stage-03-inbound-email.md)      | Inbound email             | 02         | Blocked |
| [04](stage-04-outbound-replies.md)   | Outbound replies          | 03         | Blocked |
| [05](stage-05-agent-productivity.md) | Agent productivity        | 02, 04     | Blocked |
| [06](stage-06-sla.md)                | Business hours + SLA      | 02, 04     | Blocked |
| [07](stage-07-automation.md)         | Automation rules          | 02, 04     | Blocked |
| [08](stage-08-csat.md)               | CSAT                      | 04         | Blocked |
| [09](stage-09-reporting.md)          | Reporting                 | 02, 06     | Blocked |
| [10](stage-10-customer-portal.md)    | Customer portal           | 02         | Blocked |
| [11](stage-11-live-chat.md)          | Live chat                 | 00, 02     | Blocked |
| [12](stage-12-social-channels.md)    | Social channels           | 03, 11     | Blocked |
| [13](stage-13-importers.md)          | Migration importers       | 02         | Blocked |

**Deferred, not planned:** Knowledge base / help center. Dropped from this program on August 11, 2026.
Stage 10 (customer portal) ships its ticket list and submit form without KB integration; wire the two
together if and when the KB is revived.

## Dependency graph

```
00 Foundations
 └─→ 01 Contacts
      └─→ 02 Conversation core ──┬─→ 03 Inbound email ─→ 04 Outbound replies ─┬─→ 05 Agent productivity
                                 │                                            ├─→ 06 SLA ─→ 09 Reporting
                                 │                                            ├─→ 07 Automation
                                 │                                            └─→ 08 CSAT
                                 ├─→ 10 Customer portal
                                 ├─→ 13 Importers
                                 └─→ 11 Live chat ─→ 12 Social channels
                                                       ↑
                                                    also needs 03
```

**Stage 00 is a hard barrier** — every later stage touches the realtime adapter or the schema split.
Nothing else starts until it is merged and verified on `main`.

**What can run in parallel:**

- 00 → 01 → 02 is a strict chain. There is no parallelism available until Stage 02 lands.
- After 02: stages 10, 13, and 11 are all independent of the 03→04 email chain and of each other.
- After 04: stages 05, 06, 07, and 08 are mutually independent. This is the widest fan-out in the program
  — up to four agents.
- Stage 09 needs 06. Stage 12 needs both 03 and 11.

**First usable product is Stage 04.** At that point a team can run real email support end to end.
Stages 05–07 make it competitive with Freshdesk. 08–10 close the gap. 11–13 are expansion.

## Dispatch protocol

This program uses the existing harness in `.agents/skills/todo-harness-workflow/SKILL.md`. No GitHub
Issues, no new tooling.

1. **One stage at a time enters `TODO.md`.** When a stage becomes unblocked, the orchestrator appends
   that stage's `## TODO items` block to `TODO.md` as `- [ ]` lines. Do not front-load all stages —
   it produces an unreadable backlog and invites agents to pick up blocked work.
2. Each item is dispatched to one subagent on `agent/<ITEM-ID>-<slug>` **cut explicitly from
   `support-platform`** — never `main`, and never whatever the worktree happens to default to.
   Every agent dispatched so far that was not given an explicit base ref started on a stale commit
   and could not read its own spec (deltas D-08, D-11).
3. Subagents never edit `TODO.md`, and never push to `main` or `support-platform`.
4. The orchestrator merges sequentially, running `yarn harness:verify` after each merge.
5. Items are checked off only after merge + verification on `support-platform`.

**Before reusing an item id**, delete any abandoned `agent/*` branch and prune dead worktrees —
a stale branch name silently forces the replacement agent onto a different one (delta D-11).

**Stage exit criteria.** A stage is done when all its items are checked off, its acceptance criteria in
the stage doc are demonstrated, `docs/qa/manual-feature-checklist.md` has been updated, and
`yarn harness:verify` is green on `support-platform`.

## Conventions for every stage

- Options API only. No `<script setup>`, no Composition API. See `.agents/CLAUDE.md`.
- `createError()` for all server errors.
- Schema changes go through `yarn db:generate`. Never hand-write a migration.
- New protected routes must be registered in `middleware/auth.global.ts`.
- New env vars must be added to `.env.example`.
- Skeleton loaders while fetching, real error states with retry. No placeholder data.
- New support endpoints must use `server/utils/support-access.ts`, never a bare id check.
