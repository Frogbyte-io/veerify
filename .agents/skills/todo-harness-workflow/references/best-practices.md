# Best Practices (Source-Backed)

## 1) Keep mainline healthy with required checks

- Use branch protection with required status checks before merge.
- Rationale: prevents unverified code from entering mainline.
- Source: GitHub Docs, "About protected branches"  
  https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches

## 2) Troubleshoot check states explicitly

- If merges are blocked by checks, inspect why checks are pending/skipped/stale.
- Source: GitHub Docs, "Troubleshooting required status checks"  
  https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/troubleshooting-required-status-checks

## 3) Keep branches short-lived and integrate often

- Use short-lived branches and merge to trunk frequently to reduce conflicts and risk.
- Source: Trunk-Based Development, "Short-lived Feature Branches"  
  https://trunkbaseddevelopment.com/short-lived-feature-branches/

## 4) Rebase/pull safely and predictably

- Synchronize from remote before integrating branches; prefer explicit `fetch` + `pull --rebase`.
- Source: Git documentation, `git-pull` manual  
  https://git-scm.com/docs/git-pull

## 5) Limit WIP for faster flow and fewer collisions

- Cap concurrent items (for example, max 3) to reduce context switching and conflict rate.
- Source: Atlassian, "What are WIP limits?"  
  https://www.atlassian.com/agile/kanban/wip-limits

## 6) Enforce Definition of Done before checkoff

- Do not mark TODO complete until quality gates and acceptance conditions are met.
- Source: Scrum.org, "Definition of Done"  
  https://www.scrum.org/resources/blog/what-definition-done

## 7) Keep CI fast, reliable, and always run

- Continuous integration reduces integration risk and catches issues early.
- Source: Martin Fowler, "Continuous Integration"  
  https://martinfowler.com/articles/continuousIntegration.html

## 8) Apply Ralph loop for iterative task solving with subagents

- Run one main task at a time, and keep the orchestrator in scheduler mode.
- Decompose complex work into subtasks and delegate to subagents; keep verification as a strict loop gate.
- Feed concrete failure feedback back into the next iteration until completion or iteration cap.
- Sources:
  - Geoffrey Huntley, "How To Ralph Wiggum"  
    https://ghuntley.com/ralph/
  - `open-ralph-wiggum` task mode and completion checks (`maxIterations`, completion prompts, feedback loop)  
    https://github.com/Th0rgal/open-ralph-wiggum
  - Vercel Labs `ralph-loop-agent` iterative loop (`runTask` + `verifyCompletion` + feedback retries)  
    https://github.com/vercel-labs/ralph-loop-agent
  - `how-to-ralph-wiggum` practical guidance for parallel agent usage and a single validating gate  
    https://github.com/ghuntley/how-to-ralph-wiggum

## Recommended Defaults For TODO Harness

- TODO source of truth: `TODO.md`.
- Parallel implementation: up to 3 subagents.
- Sequential integration: always one item at a time on `main`.
- Verification gate: run full harness verification after each integration.
- Checkoff point: only after successful merge + verification + push.
- Ralph loop cap per item: 3-5 iterations before marking blocked.
