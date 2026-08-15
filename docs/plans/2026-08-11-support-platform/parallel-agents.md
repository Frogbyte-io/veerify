# Stage 02 — Parallel agent split

**Created:** August 15, 2026. **Applies to:** the remainder of Stage 02 only.

Two Claude sessions are working this stage concurrently. This document is the contract between them.
**Agent 1 reads this first.** Agent 2 wrote it and is working from `D:\veerify`.

---

## Why this exists

Both sessions were previously operating on the **same working tree** (`D:\veerify`). On 2026-08-15 that
nearly caused a collision: Agent 2 dispatched subagents for SUP-02-2 and SUP-02-4 at the same time Agent 1
was committing those exact items. Nothing was lost only because Agent 2's subagents hit the session limit
before committing. That was luck.

Separate worktrees remove the shared-file hazard. This document removes the duplicated-work hazard.

---

## Workspaces

|                   | Agent 1                 | Agent 2            |
| ----------------- | ----------------------- | ------------------ |
| Working directory | **`D:\veerify-agent1`** | `D:\veerify`       |
| Branch            | **`agent1/stage-02`**   | `support-platform` |

The worktree and branch **already exist** — created by Agent 2, with `.env` copied in. Agent 1 does not
need to create them. Just:

```bash
cd D:/veerify-agent1
git status          # expect: On branch agent1/stage-02
yarn install        # node_modules is NOT shared between worktrees
```

If `D:\veerify-agent1` is inaccessible (different Windows user, permissions), recreate it anywhere you
can write:

```bash
git -C D:/veerify worktree add -b agent1/stage-02 <your-path> support-platform
```

…and say so in your first report, so Agent 2 knows the path changed.

### Two things that are shared and will bite you

- **The Postgres dev database is shared.** Both worktrees point at the same `veerify-db` container. Read
  and write freely, but see the migration rule below.
- **Ports collide.** If you run `yarn dev`, use a different port than 3001 (Agent 2 uses 3001):
  `PORT=3002 yarn dev`.

---

## Work split

Assigned by **file territory**, not by convenience — the split is chosen so the two agents touch disjoint
files.

### Agent 1 — server + notifications + docs

- [ ] **SUP-02-8** Message, participant, and tag endpoints; publish thin realtime envelopes on
      `conversation:` and `inbox:` for every write.
      Use the existing `publishConversationEvent()` in `server/utils/support-realtime.ts` — do not write a
      second publisher.
      **This is the critical path**: Agent 2's thread pane (SUP-02-9) cannot render messages until the
      `GET .../messages` endpoint exists. Do this first.
- [ ] **SUP-02-14** Build `/support/settings`: inbox name, signature, agent membership, and the
      receiving-address list with product mapping. APIs already exist (SUP-02-5, SUP-02-6).
- [ ] **SUP-02-15** Add `conversation_assigned` and `conversation_mention` notification types and
      preference toggles. Reuse the existing notification infrastructure; do not build a parallel one.
      Touches `server/utils/notifications.ts` and `components/settings/SettingsNotifications.vue` only.
- [ ] **SUP-02-16** Register support inbox and conversation routes in the OpenAPI spec. Hand-transcribe
      into `server/api/openapi.json.get.ts` (delta D-23 — there is no route registry; SUP-X-3 is the real
      fix and is not in this stage).

### Agent 2 — agent UI + navigation

- [ ] **SUP-02-9** `/support` three-pane UI (inbox switcher, conversation list, thread pane, contact drawer)
- [ ] **SUP-02-10** Composer with the reply/note toggle
- [ ] **SUP-02-11** Sidebar: rename the existing `Support` group to `System`, add a real `Support` group
- [ ] **SUP-02-12** Per-team Tools tab in `/settings`
- [ ] **SUP-02-13** Module disable semantics
- [ ] **SUP-02-17** E2E coverage — **last**, after both sides land

### File boundaries — do not cross without saying so

| Agent 1 owns                                    | Agent 2 owns                        |
| ----------------------------------------------- | ----------------------------------- |
| `server/api/support/conversations/[id]/**`      | `pages/support/index.vue`           |
| `server/api/support/tags/**`                    | `components/support/**`             |
| `pages/support/settings.vue`                    | `components/sidebar/AppSidebar.vue` |
| `server/utils/notifications.ts`                 | `pages/settings/index.vue`          |
| `components/settings/SettingsNotifications.vue` | `middleware/auth.global.ts`         |
| `server/api/openapi.json.get.ts`                |                                     |

`server/utils/support-realtime.ts` and `server/utils/conversation-activity.ts` are **shared and stable** —
read them, extend only if genuinely necessary, and flag it if you do.

---

## Syncing — through `support-platform`, not with each other

**Do not merge `agent1/stage-02` and `support-platform` into each other ad hoc, and never merge Agent 2's
in-progress work directly.** `support-platform` is the single integration point. Both agents pull from it
and push finished items to it.

### Pull often — at minimum at the start of every item

```bash
cd D:/veerify-agent1
git fetch origin
git merge origin/support-platform      # bring in Agent 2's landed work
```

Doing this at least once per item keeps divergence to hours, not days. If it has been more than ~2 hours
of active work, pull again before starting anything new.

### Push a finished item

Only after the item is complete **and** `yarn harness:verify` is green:

```bash
# 1. sync first, so you verify what the merge will actually produce
git fetch origin
git merge origin/support-platform
yarn harness:verify                    # must be green AFTER the merge, not before

# 2. integrate
git checkout support-platform
git pull --rebase origin support-platform
git merge --no-ff agent1/stage-02
yarn harness:verify                    # green again on the integration branch
git push origin support-platform

# 3. return to your branch
git checkout agent1/stage-02
git merge support-platform             # fast-forward, keeps the branches level
```

**A push race is expected occasionally** — both agents push to `support-platform`. If `git push` is
rejected, `git pull --rebase origin support-platform`, re-run `yarn harness:verify`, and push again. Do
not force-push.

**`git checkout support-platform` will fail** if Agent 2 has it checked out in `D:\veerify` — git does not
allow one branch in two worktrees. If that happens, push your branch (`git push -u origin
agent1/stage-02`), report it as ready, and let Agent 2 integrate it. That is the normal fallback, not an
error condition.

---

## Rules that are not negotiable

1. **`TODO.md` is edited by whoever integrates, in a separate `chore(todo):` commit** — never inside a
   feature commit. Check an item off only after it is merged into `support-platform` and verified there.
2. **No migrations without coordinating first.** Two agents generating `0023` independently is the exact
   collision the README documents between `support-platform` and `sleekplan-export`.
   **`0023` is already spoken for**: it belongs to Agent 2's SUP-02-12, which adds the `teamModuleSettings`
   table (delta D-31). None of Agent 1's items (SUP-02-8, 02-14, 02-15, 02-16) should need a schema change
   — every table they touch landed in SUP-02-1 (`0022`). If you find you need one anyway, **stop and say
   so** before running `yarn db:generate`.
3. **Read before writing.** `.agents/CLAUDE.md`, then `design.md`, then `deltas.md` (several entries
   override the original stage docs), then `stage-02-conversation-core.md`.
4. **Options API only.** No `<script setup>`, no Composition API. This trips up UI work constantly.
5. **Report ambiguity, don't silently resolve it.** Both agents have already hit undocumented gaps —
   `supportTag`'s columns, `isPrimary` exclusivity, activity-message privacy. Each was flagged in
   `TODO.md` rather than buried. Keep doing that.

---

## Current state at time of writing (`8b59521`)

Stage 02 is **7/17**. SUP-02-1 through SUP-02-7 are done, merged, and pushed. `origin/support-platform`
and local are in sync; the working tree is clean.

Verification gates in `yarn harness:verify`: agent docs map, typecheck, unit tests, lint, guarded E2E,
guarded Redis integration, guarded Postgres integration. All currently green. Lint reports ~158 warnings
and **0 errors** — the warnings are pre-existing; do not "fix" them as part of a feature item.
