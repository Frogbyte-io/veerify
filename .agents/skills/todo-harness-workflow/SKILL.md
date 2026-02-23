---
name: todo-harness-workflow
description: Orchestrate TODO.md execution with subagents in a deterministic harness flow. Use when a user asks to run TODO items in parallel but integrate safely one-by-one, keep TODO.md as the source of truth, enforce validation gates, report blocked items, and produce audit-ready completion reports.
---

# TODO Harness Workflow

Use this skill to run a TODO backlog with parallel implementation and sequential integration.

## Runbook

1. Read repo instructions first.
2. Sync `main` and gather context.
3. Parse unchecked TODO items from `TODO.md`.
4. Assign stable IDs:
   - Use existing IDs when present.
   - Else use `TODO-L<line-number>`.
5. Build a work queue with conflict risk:
   - Low risk: separate folders/features.
   - High risk: same files or shared schema/runtime config.
6. Dispatch up to 3 items in parallel, never duplicate an item across subagents.
7. Require each subagent to:
   - Work on `agent/<ITEM-ID>-<slug>` from latest `origin/main`.
   - Avoid `TODO.md`.
   - Run validation commands and report exact results.
   - Push branch and return branch name, commit SHA, changed files, commands, caveats.
8. Integrate sequentially on orchestrator only:
   - `git checkout main`
   - `git pull --rebase origin main`
   - `git fetch origin`
   - `git merge --no-ff origin/<agent-branch>`
9. Verify on `main` after each integration:
   - Prefer `yarn harness:verify`.
   - If e2e is skipped by guard, report the explicit skip reason.
10. Run Prettier formatting before any commit:
   - Format changed files with Prettier before staging/committing.
11. Push `main`.
12. Only after successful integration and verification, check off item in `TODO.md` and push checklist commit.

## Ralph Loop Mode

Use Ralph loop mode for large or ambiguous TODO items that benefit from iterative retries.

### Core Ralph constraints

- Run one primary task per loop iteration.
- Keep the orchestrator as a scheduler, not a worker.
- Re-run with explicit feedback until completion criteria are met or safety limit is hit.

### Ralph iteration recipe (for one TODO item)

1. Define the loop target:
   - Single TODO item (`ITEM-ID`) and explicit completion checks.
2. Decompose into subtasks:
   - `analyze`: inspect existing code and acceptance criteria.
   - `implement`: focused code edits by area.
   - `validate`: tests/lint/typecheck/e2e gate checks.
   - `document`: update docs/tests/TODO note if needed.
3. Dispatch subtasks to subagents with controlled parallelism:
   - Use multiple subagents for search/edit tasks.
   - Reserve validation to one subagent to avoid noisy backpressure.
4. Integrate the best subtask output into the item branch and run verification.
5. Evaluate completion gate:
   - If not complete, inject concrete failure feedback into the next iteration prompt.
6. Repeat until complete or `maxIterations` is reached.
7. If safety limit reached:
   - Mark item blocked with reason + needed decision/input.

### Ralph stop conditions

- Success: item acceptance checks pass and harness verification passes on `main`.
- Stop-safe: maximum loop iterations reached.
- Stop-safe: repeated identical failure (no net diff across 2+ iterations).

## Branch Hygiene

- Keep branches short-lived and focused on one item.
- Integrate frequently to reduce drift and merge pain.
- Do not batch-merge multiple TODO items before verification.

## Definition Of Done Per Item

Mark done only when all are true:

- Implementation matches TODO text and implied acceptance behavior.
- Relevant checks pass on `main`.
- Documentation/tests updated when behavior changed.
- `TODO.md` updated by orchestrator only.

## Blocked Item Protocol

If blocked:

- Do not check off.
- Add under item:
  - `Blocked: <one-line reason>`
  - `Needs: <decision/info needed>` (optional)
- Continue with next non-conflicting item.

## Deterministic Commands

### Build queue

```powershell
rg -n "^- \[ \]" TODO.md
```

### Sync and integrate

```powershell
git checkout main
git pull --rebase origin main
git fetch origin
git merge --no-ff origin/<agent-branch>
yarn harness:verify
git push origin main
```

### Format before commit

```powershell
# Format all changed files before staging
yarn prettier --write .
```

### Check off

```powershell
# Edit TODO.md: - [ ] -> - [x]
yarn prettier --write TODO.md
git add TODO.md
git commit -m "chore(todo): check off <ITEM-ID> <short title>"
git push origin main
```

## Subagent Instruction Template

Use this verbatim when dispatching:

```text
You are a SUBAGENT working on exactly ONE TODO item.

Rules
- DO NOT edit TODO.md.
- DO NOT push to main.
- Create a branch from latest origin/main:
  - git fetch origin
  - git checkout -b agent/<ITEM-ID>-<short-slug> origin/main
- Implement the TODO item with minimal, focused changes.
- Run relevant repo checks (tests/lint/build) and include results.
- Commit your changes on your branch using:
  - feat: <summary> / fix: <summary> / chore: <summary>
- Push the branch to origin:
  - git push -u origin agent/<ITEM-ID>-<short-slug>

Report back with:
- TODO item text
- branch name
- commit SHA(s)
- files changed
- commands run + results
- any assumptions made / blockers
```

## Common Failure Fixes

- `origin/<agent-branch> not something we can merge`: run `git fetch origin` first.
- Missing local dependencies before verify: run `yarn install --frozen-lockfile`.
- Required checks not updating on PR: confirm branch protection required checks and completion state.
- Rebase/merge queue conflicts: re-sync from `origin/main`, re-run verification, then merge.

## Output Format Per Completed Item

- Completed TODO item text
- Subagent branch + commit SHA(s)
- Merge commit SHA on `main`
- Commands run + results
- Files changed
- Follow-ups (if any)

## References

Read `references/best-practices.md` for source-backed rationale and policy defaults.
