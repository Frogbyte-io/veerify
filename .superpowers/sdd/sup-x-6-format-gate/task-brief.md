# SUP-X-6 implementation brief

Make formatting a real cross-platform validation gate. The repository currently has `yarn format:check` in CI but
not in `yarn harness:verify`, and Prettier's default line-ending behavior creates false Windows failures when
`core.autocrlf=true`.

Requirements:

- Configure Prettier with an explicit cross-platform line-ending policy (`endOfLine: auto` or an equivalent policy
  justified by tests).
- Add `format:check` to `scripts/harness-verify.mjs` with clear output and failure handling.
- Add/update focused tests or harness assertions for the new gate where practical; preserve the existing CI command.
- Verify repo-wide format check, typecheck, unit tests, lint, guarded integrations, and the harness on the integration
  branch. Do not mass-reformat unrelated files unless the chosen policy requires it and the diff is reviewed.

Do not edit `TODO.md` or the progress ledger on the worker branch. Write the canonical report to
`.superpowers/sdd/sup-x-6-format-gate/task-report.md`.
