# Stage 07 — Automation rules

**Depends on:** Stages 02, 04. **Blocks:** nothing.
**Runs in parallel with Stages 05, 06, 08.**

**Goal:** Teams define their own triage — "tag anything from an enterprise company urgent and assign it
to the escalations agent" — without code.

> Outline-level detail. Refine when unblocked. The engine shape is settled; the condition and action
> vocabularies will grow and should be treated as extensible from the start.

## Schema

- **`automationRule`** — `id`, `teamId`, `inboxId` (nullable, null = all inboxes), `name`, `trigger`
  (`conversation_created` | `conversation_updated` | `message_created` | `time_based`), `conditions`
  (jsonb), `actions` (jsonb, ordered), `isEnabled`, `sortOrder`, `runCount`, `lastRunAt`, timestamps.
- **`automationRuleRun`** — `id`, `ruleId`, `conversationId`, `status` (`applied` | `skipped` |
  `failed`), `matchedConditions` (jsonb), `appliedActions` (jsonb), `error`, `createdAt`. The audit
  trail; without it, debugging a misbehaving rule is guesswork.

## Condition and action vocabulary

**Conditions** — inbox, status, priority, tag, assignee, contact, company, subject or body match,
channel, hours since last activity, SLA state. Combined with `all` / `any` groups, nested one level.

**Actions** — set status, set priority, assign to agent, assign via round-robin, add or remove tag,
send a canned reply, run a macro, add a private note, call a webhook.

Both vocabularies are registries, not switch statements, so Stage 12's channels add conditions without
touching the engine.

## Engine

- Event-triggered rules evaluate synchronously after the triggering write commits, ordered by
  `sortOrder`.
- Time-based rules run on the Stage 00 scheduler.
- **Loop guard, required:** a rule action that triggers another rule must not recurse indefinitely. Cap
  the cascade depth per originating event (default 3) and record the truncation in `automationRuleRun`.
  Automation loops in a support tool send real email to real customers.
- **Dry-run mode** evaluates against recent conversations and reports what _would_ have happened, without
  acting. Teams will not trust a rule builder they cannot test.
- A failing action is recorded and skipped; it does not abort the remaining actions or the triggering
  request.

## UI

- Rule list with enable/disable, ordering, and run counts.
- Condition and action builder with grouping.
- Dry-run panel showing matched conversations and the actions that would apply.
- Per-rule run history from `automationRuleRun`.

## Acceptance criteria

1. A rule matching on company and priority applies its actions to a newly created conversation.
2. Two rules whose actions trigger each other terminate at the configured depth, and the truncation is
   recorded.
3. Dry-run produces the correct action list and mutates nothing — verified by comparing table state
   before and after.
4. A failing webhook action is recorded as `failed` and the remaining actions still apply.
5. A disabled rule never runs and never appears in dry-run results.
6. `yarn harness:verify` green on `main`.

## TODO items

- [ ] Add `automationRule` and `automationRuleRun` tables; generate migration
- [ ] Implement the condition evaluator with `all`/`any` grouping and one level of nesting, as a pure unit-tested module
- [ ] Implement the action executor as an extensible registry with per-action error isolation
- [ ] Wire event-triggered evaluation after commit for create, update, and message events, ordered by `sortOrder`
- [ ] Implement time-based rule evaluation on the Stage 00 scheduler
- [ ] Implement the cascade-depth loop guard with truncation recorded in `automationRuleRun`
- [ ] Implement dry-run evaluation that reports without mutating
- [ ] Build the rule list UI with enable/disable, reordering, and run counts
- [ ] Build the condition and action builder UI with grouping
- [ ] Build the dry-run panel and per-rule run history view

## Risks

- **Automation loops send real email.** The loop guard is a correctness requirement, not a nicety, and
  ships with the engine rather than after it.
- **Untestable rules go unused.** Dry-run is what makes the feature adoptable.
- **Synchronous evaluation on the request path.** Keep rule evaluation bounded; if it grows, move it
  behind the scheduler rather than letting it slow inbound mail processing.
