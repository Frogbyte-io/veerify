# Stage 00 — Foundations

**Depends on:** nothing. **Blocks:** every other stage.
**Read `design.md` first.**

**Goal:** Put the platform pieces in place that every later stage assumes — a realtime broker that works
across instances, a self-hostable deployment, a scheduler, and a schema layout that can absorb a new
domain. **No support features ship in this stage.**

## Scope

**In:** schema file split, realtime adapter, `ws-connections.ts` rewrite, rate-limit store adapter,
scheduler abstraction, Dockerfile + production compose, env and docs updates.

**Out:** every support table, every support endpoint, every support UI. If an item in this stage
references a conversation or an inbox, it is out of scope — move it to Stage 02.

## Work

### 1. Schema split

Split `server/database/schema/feedback.ts` (564 lines, four domains) into:

- `feedback.ts` — `project`, `anonymousSession`, `feedbackStatus`, `feedbackCategory`, `feedback`,
  `vote`, `roadmapItem`, `feedbackComment`, `feedbackSubscription`, `githubIntegration`,
  `githubIssueLink`
- `notifications.ts` — `notification`
- `imports.ts` — `importRun`, `importRunIssue`
- `changelog.ts` — `changelogPost`

Re-export all of them from `schema/index.ts`. **Definitions move verbatim** — no column changes, no
renames. Confirm `yarn db:generate` produces **no migration**; if it does, something was altered and
must be reverted.

Create an empty `support.ts` exporting nothing yet, re-exported from `index.ts`, so Stage 01 has a
landing place.

### 2. Realtime adapter

New `server/services/realtime/`:

- `types.ts` — the interface: `publish(channel, envelope)`, `subscribe(channel, handler)`,
  `unsubscribe(channel, handler)`, `close()`.
- `redis.ts` — `ioredis`, two connections (one publisher, one subscriber; a subscribing Redis connection
  cannot issue other commands). Reconnect with backoff. **Do not use `@upstash/redis`** — the driver is
  written against the Redis wire protocol so Upstash, Redis, and Valkey are interchangeable.
- `memory.ts` — in-process, for tests and `yarn dev`.
- `index.ts` — driver selection from `REALTIME_DRIVER` (`redis` | `memory`), defaulting to `memory` when
  `REDIS_URL` is unset so a fresh clone still boots.

**Envelope shape**, versioned from day one because a deploy leaves old and new instances running
side by side:

```ts
{ v: 1, type: string, teamId: string, inboxId?: string, conversationId?: string, messageId?: string }
```

Envelopes carry **no record contents**. Clients refetch through normal authorized endpoints.

### 3. Rewrite `ws-connections.ts`

Current implementation is an in-memory `Map` of `userId → Set<Peer>`. Replace with channel
subscriptions:

- Channels: `team:<id>`, `inbox:<id>`, `conversation:<id>`, and `user:<id>` for existing notification
  behaviour.
- **Authorize at subscribe time**, not publish time. A peer asking for `team:X` must be verified as a
  member of team X before the subscription is registered.
- Local peer registry maps channel → peers on this instance; the Redis subscriber fans inbound messages
  out to them.
- Client helper: reconnect with exponential backoff, resubscribe to prior channels, refetch state on
  reconnect, and disconnect after ~5 minutes of tab inactivity with refetch-on-focus.

**Existing notification delivery must keep working unchanged** — `NotificationBell` is live in
production. Its 30-second polling stays as a fallback in this stage; do not remove it.

### 4. Rate-limit store adapter

Give `server/utils/rate-limit.ts` a store interface with `memory` and `redis` implementations, reusing
the same connection. Public behaviour and call sites are unchanged.

### 5. Scheduler abstraction

`server/services/scheduler/` with a `defineScheduledTask(name, cron, handler)` registration surface.
Cloud resolves to Vercel Cron (`vercel.json`); self-host resolves to a Nitro scheduled task. No tasks are
registered in this stage — Stage 03 and Stage 06 are the first consumers.

### 6. Deployment

- **`Dockerfile`** — multi-stage: `yarn install --frozen-lockfile` → `yarn build` → `node:22-alpine`
  running `.output/server/index.mjs`. Nitro defaults to the `node-server` preset off-Vercel; do not set
  a preset explicitly. Add `.dockerignore`.
- **`docker-compose.yml`** (production) — currently Postgres only. Add `app`, `valkey` (`valkey/valkey:9`
  — BSD-3, Linux Foundation, wire-compatible), `minio`, and `caddy`. Caddy terminates TLS with
  **on-demand certificates** so `project.customDomain` works off-Vercel; gate issuance on an ask
  endpoint that checks the host against configured custom domains.
- **`docker-compose-dev.yml`** — add `valkey` only. Leave the rest alone.
- Document the VM path in `README.md`.

### 7. Docs and env

- `.env.example`: `REDIS_URL`, `REALTIME_DRIVER`, `RATE_LIMIT_STORE`.
- `docs/agent/context-map.md`: add `server/services/realtime/`, `server/services/scheduler/`,
  `server/utils/support-access.ts` (Stage 02), and this plan directory. `yarn harness:docs` gates on it.

## Acceptance criteria

1. `yarn db:generate` produces **no migration** after the schema split.
2. Two app instances against one Redis: a client connected to instance A receives an event published on
   instance B. **This is the acceptance test for the whole stage** — demonstrate it explicitly.
3. A peer that is not a member of team X cannot subscribe to `team:X`; the subscription is rejected, not
   silently ignored.
4. `docker compose -f docker-compose.yml up` on a clean VM produces a working instance: app reachable,
   migrations applied, uploads working against MinIO.
5. Killing Redis degrades realtime only — HTTP requests keep serving, and the app reconnects when Redis
   returns.
6. `NotificationBell` behaves exactly as before.
7. `yarn harness:verify` green on `main`.

## TODO items

Append to `TODO.md` when dispatching. Item 1 must merge before 2–4 to avoid schema conflicts; 5, 6, 7 are
independent of the rest.

- [ ] Split `server/database/schema/feedback.ts` into `feedback.ts`, `notifications.ts`, `imports.ts`, `changelog.ts`; add empty `support.ts`; re-export from `index.ts`; verify `yarn db:generate` emits no migration
- [ ] Add `server/services/realtime/` with `types.ts`, `redis.ts` (ioredis, separate pub/sub connections), `memory.ts`, and driver selection; versioned thin envelopes; unit tests for envelope routing
- [ ] Rewrite `server/utils/ws-connections.ts` for channel subscriptions (`team:`, `inbox:`, `conversation:`, `user:`) with subscribe-time authorization; keep existing notification delivery working
- [ ] Add client realtime helper: reconnect with backoff, resubscribe, refetch-on-reconnect, idle-disconnect after 5 min with refetch-on-focus
- [ ] Add a store adapter to `server/utils/rate-limit.ts` (`memory` | `redis`) reusing the Redis connection; no call-site changes
- [ ] Add `server/services/scheduler/` with Vercel Cron and Nitro scheduled-task backends behind one registration API; no tasks registered yet
- [ ] Add `Dockerfile` + `.dockerignore`; extend production `docker-compose.yml` with `app`, `valkey`, `minio`, and Caddy on-demand TLS; add `valkey` to dev compose; document the VM path in `README.md`
- [ ] Update `.env.example` (`REDIS_URL`, `REALTIME_DRIVER`, `RATE_LIMIT_STORE`) and `docs/agent/context-map.md`

## Risks

- **The schema split touching table definitions.** The check is mechanical: `yarn db:generate` must emit
  nothing. Anything else means a column changed.
- **Scope creep into support features.** This stage is infrastructure only. An agent that finds itself
  writing a conversation table has drifted.
- **Losing notification delivery.** `NotificationBell` is live. Its polling fallback stays in place until
  a later stage retires it deliberately.
