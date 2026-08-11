# Plan Deltas

Things the plan got wrong, missed, or that changed once implementation started. Append as you go; fold
the settled ones back into `design.md` and the stage docs at each stage boundary.

Format: what was found, why it matters, what to do.

---

## Stage 00

### D-01 — `sendToUser` payloads conflict with thin envelopes

**Found:** SUP-00-3. **Status:** deferred to SUP-00-9.

Stage 00 asked for both "envelopes carry no record contents" and "existing notification delivery must
keep working unchanged". Those are incompatible: `NotificationBell.vue` is a live WebSocket consumer
whose wire contract is `{type:'notification', data:{…}}` — the server pushes the full notification
object and the client unshifts it straight into the list.

Worse, the obvious conversion does not fit: a thin envelope requires `teamId`, and the `notification`
table has no team scope (only `userId`, `projectId`, `feedbackId`).

**Decision:** leave `sendToUser` unchanged and process-local. Notifications remain multi-instance-broken
exactly as they were — no regression, no fake fix. `NotificationBell`'s 30-second polling fallback is
**load-bearing** until SUP-00-9 lands and must not be removed as dead weight.

**Open question for SUP-00-9:** either `teamId` becomes optional on the envelope for user-scoped events
(weakening the always-tenant-scoped invariant that the isolation argument rests on), or notifications
gain a team scope via migration. Not yet decided.

### D-02 — Frame type and envelope type collide

**Found:** SUP-00-3, caught by `yarn typecheck`. **Status:** fixed in `cdd56dd`.

`{ type: 'event', channel, ...envelope }` silently overwrote the frame type with the envelope's own
`type`, so clients would have received `type: 'conversation.updated'` at the frame level and failed
dispatch entirely.

**Convention going forward:** never spread an envelope into a wire frame. Nest it: `{ type, channel,
event }`. Any new frame type must be added with this in mind.

### D-03 — Peer channel cap was not in the plan

**Found:** SUP-00-3. **Status:** implemented (`MAX_CHANNELS_PER_PEER = 50`).

A peer subscribing to unbounded channels forces one authorization query per request and one broker
subscription per channel — a cheap denial-of-service. The plan specified subscribe-time authorization
but no bound on subscription count.

**Fold into `design.md`** under Realtime.

### D-04 — Stage 02 must replace the support-channel deny branch

**Found:** SUP-00-3. **Status:** needs a Stage 02 TODO item.

`server/utils/realtime-channels.ts` denies `inbox:` and `conversation:` unconditionally because those
tables do not exist yet. It fails closed, and there is a test asserting the denial — so Stage 02 has to
consciously replace that branch with `requireInboxAccess` / `requireConversationAccess` rather than
discovering it at runtime.

**Action:** add an explicit item to `stage-02-conversation-core.md`.

### D-05 — Stage 00's internal dependency note was wrong

**Found:** SUP-00-1/2/3. **Status:** correct the stage doc.

`stage-00-foundations.md` says "Item 1 must merge before 2–4 to avoid schema conflicts". That is not
true — items 2, 3, and 4 do not touch `server/database/schema/**` at all. The real dependency is
2 → 3 → 4 (adapter, then WS layer, then client), with 1 fully independent.

**Action:** fix the ordering note in the stage doc.

### D-06 — Redis connection needs to be shared, not per-subsystem

**Found:** planning SUP-00-5. **Status:** open, assigned to SUP-00-5.

`server/services/realtime/drivers/redis.ts` constructs its own publisher and subscriber internally. The
rate limiter needs Redis too, and the plan says "reusing the Redis connection" without saying where that
connection lives. Two subsystems each constructing their own clients doubles connection count for no
reason and gives two places to configure retry behaviour.

**Action:** extract `server/services/redis/client.ts` as the single place that builds an `ioredis`
client from `REDIS_URL`, and have both the realtime driver and the rate limiter take clients from it.
The realtime subscriber still needs its own dedicated connection — a Redis connection in subscriber mode
cannot issue other commands — but it should get it from the shared factory.

### D-07 — The repo could not be self-hosted at all

**Found:** planning SUP-00-7. **Status:** in scope for SUP-00-7.

Not a plan error so much as an under-stated one: there is no `Dockerfile`, and production
`docker-compose.yml` runs only Postgres — no app, no storage, no mail. "Self-hostable" was assumed
throughout the design (it is half the argument for the Redis-protocol driver) but was never true.

### D-08 — Agent worktrees broke lint and polluted git status

**Found:** SUP-00-1. **Status:** fixed in `bd31097`.

`.claude/worktrees/` holds full checkouts of the repo nested inside the repo. ESLint linted every copy
as project source (68 errors, all from duplicated `components/ui/**`), and git reported the directory as
untracked. Added ignores to `eslint.config.mjs` and `.gitignore`.

**Note for orchestration:** three of the four first-wave agents were created from a base commit that
predated the plan docs, so they could not read the specs they were pointed at. Always have a dispatched
agent verify its base before starting — `ls docs/plans/2026-08-11-support-platform/` and
`ls server/services/realtime/` are cheap checks.

### D-09 — The plan assumed a clean working tree

**Found:** SUP-00-1. **Status:** worked around; no plan change needed, but worth knowing.

`importRun`, `importRunIssue`, and `changelogPost` live in `feedback.ts` as **uncommitted** work in
progress. The committed file is 469 lines and contains none of them. So the schema split could not be
completed in one commit without swallowing unrelated WIP.

SUP-00-1 shipped the `notification` half only; the `imports.ts` / `changelog.ts` half sits in the working
tree to be committed with the feature that introduced those tables. Stage boundaries that assume a clean
tree should say so.

### D-10 — Committed tests depended on an uncommitted vitest alias

**Found:** integrating SUP-00-4/5. **Status:** fixed in `5efd3c8`.

`tests/realtime-channels.test.ts` (shipped in `cdd56dd`) transitively imports
`~/server/database/drizzle`. The `~` alias was defined only in an **uncommitted** edit to
`vitest.config.ts` sitting in the working tree, so the test passed locally and failed to even collect
on a clean checkout. `tests/domain-service.test.ts` had been broken the same way for some time.

Two independent agents hit this and both correctly diagnosed it as pre-existing rather than
self-inflicted.

**Lesson for this program:** `yarn harness:verify` passing in a dirty working tree does not prove the
committed state is green. When the tree is dirty, verify against the committed config before claiming a
gate passed — `git show HEAD:<config> > tmp && yarn vitest run -c tmp` is enough.

### D-11 — Agent branch names collide with stale worktrees

**Found:** re-dispatching Stage 00. **Status:** worked around; needs an orchestration rule.

Worktrees from the first (spend-limit-killed) wave still held `agent/SUP-00-6-scheduler`, so the
replacement agent could not use its assigned branch name and fell back to
`agent/SUP-00-6-scheduler-r2`. It flagged this clearly, which is the only reason integration was not
confusing.

Separately, every agent in both waves was created on a stale base and had to recover by branching from
`feat/support-stage-00-foundations` explicitly. The Step 0 base check added in wave two worked — all
three agents detected the problem and recovered on their own.

**Rule:** always give dispatched agents an explicit base ref and an explicit branch name, tell them to
verify the base before starting, and clean up dead worktrees (`git worktree prune` plus deleting
abandoned `agent/*` branches) before re-dispatching a previously used item id.
