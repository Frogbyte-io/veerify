# Stage 09 CSAT reporting hardening

Status: **COMPLETE** (commits `c74ff2b` and `88d4b4f`; Luna review and re-review passed)

The existing CSAT summary is a prerequisite for reporting rollups, but two definitions are unsafe:
thumbs ratings are stored as `1`/`2` while normalization treats `1` as the maximum, and a team-level
reader does not restrict results to inboxes accessible to the caller.

## Task 1: Correct CSAT score semantics and inbox authorization

1. Normalize each supported scale explicitly. For thumbs, `1` is 0% and `2` is 100%; preserve raw
   average ratings and existing CSAT 5 / NPS 10 behavior.
2. Keep team admins' cross-inbox access, but constrain non-admin team members to their support inbox
   memberships. If `inboxId` is supplied, require access to that inbox and reject an inbox belonging
   to another team.
3. Add unit coverage for scale-specific percentages and authorization-focused route coverage for
   explicit and implicit inbox scopes. Preserve response shape and date filtering.
4. Run focused tests, typecheck, and the full harness. Do not add rollups, UI, or schema changes in
   this slice.

## Constraints

- Use the existing support-access helpers; do not duplicate membership policy.
- Do not change public survey rating values or stored raw ratings.
- Do not expose unauthorized inbox names, agent names, or response counts through errors.
