# Plan Deltas

Things the plan got wrong, missed, or that changed once implementation started. Append as you go; fold
the settled ones back into `design.md` and the stage docs at each stage boundary.

Format: what was found, why it matters, what to do.

---

## Stage 00

### D-01 — `sendToUser` payloads conflict with thin envelopes

**Found:** SUP-00-3. **Status:** RESOLVED in `b6404a9` + `3b0ab10` (2026-08-12).

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

**Folded into `design.md`** under Realtime on 2026-08-12.

### D-04 — Stage 02 must replace the support-channel deny branch

**Found:** SUP-00-3. **Status:** needs a Stage 02 TODO item.

`server/utils/realtime-channels.ts` denies `inbox:` and `conversation:` unconditionally because those
tables do not exist yet. It fails closed, and there is a test asserting the denial — so Stage 02 has to
consciously replace that branch with `requireInboxAccess` / `requireConversationAccess` rather than
discovering it at runtime.

**Done:** explicit item added to `stage-02-conversation-core.md` on 2026-08-12.

### D-05 — Stage 00's internal dependency note was wrong

**Found:** SUP-00-1/2/3. **Status:** correct the stage doc.

`stage-00-foundations.md` says "Item 1 must merge before 2–4 to avoid schema conflicts". That is not
true — items 2, 3, and 4 do not touch `server/database/schema/**` at all. The real dependency is
2 → 3 → 4 (adapter, then WS layer, then client), with 1 fully independent.

**Done:** ordering note corrected in `stage-00-foundations.md` on 2026-08-12.

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

### D-12 — Caddy on-demand TLS needs an app endpoint that does not exist

**Found:** SUP-00-7. **Status:** queued as SUP-00-10.

`Caddyfile` gates certificate issuance behind `on_demand_tls.ask` pointing at
`http://app:3000/api/system/tls-ask`. That route does not exist. Caddy treats a non-2xx ask response as
"deny", so the stack **fails closed**: no certificate is issued for any host, and custom domains serve no
HTTPS at all.

This is the right failure direction — without the gate it would be an open certificate-issuance relay
that gets the deployment rate-limited by Let's Encrypt — but the self-hosted stack is not usable for
custom domains until the endpoint lands.

The design assumed self-hosting was mostly a packaging exercise. It is not: the custom-domain feature
needs a deployment-mode-specific validation surface that the cloud path gets from Vercel for free.

### D-13 — `yarn build` is unsafe for production images

**Found:** SUP-00-7. **Status:** handled in the Dockerfile; worth knowing repo-wide.

`package.json`'s `postbuild` runs `drizzle-kit migrate && tsx scripts/seed.ts`, and `scripts/seed.ts`
creates fixed-password test accounts (`test@preview.local` / `password123`). Any production image built
with plain `yarn build` would ship those credentials.

The Dockerfile therefore runs `yarn nuxt build` and performs migrations separately in
`docker-entrypoint.sh`. **Any future build tooling must avoid `yarn build` for the same reason.** The
seeding-on-postbuild arrangement is a footgun that deserves revisiting independently of this program.

### D-14 — Environment problems masquerade as code problems

**Found:** integrating SUP-00-7. **Status:** informational.

The SUP-00-7 agent reported two typecheck errors, one in a file merged and verified clean minutes
earlier. Re-running typecheck on the integration branch was clean. Root cause: the `D:` drive was at
100% (65 MB free of 50 GB), so the agent hit `ENOSPC` during `yarn install` and worked around it by
junctioning `node_modules`, leaving `.nuxt` incompletely generated.

**Lesson:** when a subagent reports failures in files it never touched, re-verify on the integration
branch before believing the report. Disk exhaustion, partial installs, and missing generated types all
surface as plausible-looking type errors.

### D-15 — Nothing tests the Redis driver against real Redis

**Found:** Stage 00 boundary review. **Status:** RESOLVED in `a751c6a` (2026-08-14).

Every realtime and rate-limit test covers the **memory** driver or a fake client. The Redis driver's
reconnect-and-resubscribe path, and the rate limiter's Lua sliding window, have never run against an
actual Redis.

That is uncomfortable because cross-instance delivery is the entire premise of Stage 00, and Stage 02's
first acceptance criterion — "two agents on two instances see each other's messages" — is the first
thing that would expose a driver bug, by which point the agent UI is already built on top of it.

`docker-compose-dev.yml` now ships `valkey`, so a guarded integration suite is cheap: follow the
`test:e2e:if-available` pattern, skip when no `REDIS_URL` is reachable, and cover publish/subscribe
across two driver instances, resubscribe after a forced disconnect, and the rate limiter's atomicity
under concurrent consumption.

### D-16 — `envelopeMatchesChannel` closes a gap subscribe-time auth cannot

**Found:** SUP-00-9. **Status:** implemented in `b6404a9`.

Stage 00 specified subscribe-time authorization and treated that as sufficient for tenant isolation. It
is not. Authorization proves a listener _may_ hear a channel; it says nothing about whether a given
payload belonged there. A `team:A` envelope published to `team:B` would have reached every
legitimately-subscribed listener of B, and no check anywhere would have objected.

Publish now verifies the envelope's scope matches the channel. **Both halves are required** — fold this
into any future channel work rather than assuming the subscribe check covers it.

### D-17 — Integration target moved off `main`

**Found:** Stage 00 close-out. **Status:** in effect from Stage 01.

Stage 00 was integrated directly onto `main`. From Stage 01 the integration branch is
**`support-platform`**, and `main` is left alone until the program is ready to land as a whole.

Dispatched agents must be given `support-platform` as their explicit base ref, not `main` and not
whatever the worktree defaults to — see D-11 for why the base must be stated rather than assumed.

### D-18 — Stage 01 mutations lacked relational tenant checks and merge locks

**Found:** code review of SUP-01-1 through SUP-01-4. **Status:** queued as SUP-01-10.

`contact.companyId` has an ordinary foreign key, which proves the company exists but not that it belongs
to the contact's team. Create/update must validate same-team ownership inside their transaction. The
merge endpoint also read both contacts before entering its transaction, despite the stage requiring row
locks; overlapping or inverse merges could therefore race. The correction adds same-team validation, a
stable `(createdAt, id)` cursor, in-transaction stable-order locks and revalidation, and PostgreSQL-backed
endpoint tests.

### D-19 — Auto-link setting needed an explicit ownership model

**Found:** plan review before SUP-01-5. **Status:** resolved in plan; add `supportTeamSettings`.

The plan said auto-linking was team-scoped but named no table, column, or authorization rule. It now uses
`supportTeamSettings` with `teamId` as primary key and `autoLinkFeedback` defaulting to false. Do not put
this privacy-sensitive support control in generic team JSON.

### D-20 — Unique inbound-event insertion alone loses failed deliveries

**Found:** plan review of Stage 03. **Status:** resolved in plan.

Returning 200 for every duplicate after inserting an event is correct only after processing completes. A
crash during archive, parsing, or persistence would otherwise leave the provider believing delivery
succeeded while no ticket exists. `supportEmailEvent` now has claim/lease/replay state and a scheduled
replay path; processed events remain idempotent.

### D-21 — Outbound sends require a durable outbox

**Found:** plan review of Stage 04. **Status:** resolved in plan.

Sending from a request-lifetime background promise loses retries on process restart or serverless
termination. Stage 04 now writes `supportOutboundDelivery` in the same transaction as its message, then
uses a bounded claim/retry worker. CSAT and social channels reuse this mechanism.

### D-22 — A single SLA breach timestamp cannot represent per-metric breaches

**Found:** plan review of Stage 06. **Status:** resolved in plan.

The acceptance criterion requires once-only breach processing for first-response, next-response, and
resolution independently, but `conversation.slaBreachedAt` represented only one instant. Stage 06 now
uses unique `(conversationId, metric)` `slaBreach` rows.

### D-23 — `server/utils/openapi.ts` has no route-registration mechanism

**Found:** SUP-01-9. **Status:** worked around; real fix queued as SUP-X-3.

The stage-01 plan said "register support contact routes in `server/utils/openapi.ts`", assuming it held
a route registry. It does not — it is only type helpers and `commonSchemas`. The actual served spec is
hand-written in `server/api/openapi.json.get.ts` with `paths: {}` hardcoded empty and the comment "Paths
will be added as routes are implemented".

**This predates support-platform.** 24 endpoint files across the whole app — auth, github, orgs, and now
all of support — carry `@openapi` JSDoc blocks in the standard `swagger-jsdoc` YAML-comment format, and
none of them have ever been read by anything. `js-yaml` is present only transitively (via eslint), so
even a scanner couldn't be added without a real dependency.

**What was done:** the nine support path entries were hand-transcribed into `openapi.json.get.ts`'s
`paths` object, matching the source JSDoc exactly, plus `Contact` and `SupportCompany` schema components.
This makes the served `/api/openapi.json` correct for support today, but it is duplication that will
drift the moment an endpoint's JSDoc changes without a matching manual edit.

**Real fix, not done here:** a build-time scan of `server/api/**/*.ts` for `@openapi` blocks, parsed with
`js-yaml` (added as a direct dependency) and merged into the served spec. Must run at build time, not
request time — the TS source is not necessarily present in a Vercel serverless deployment, only the
compiled output, so a runtime filesystem scan would work in dev and self-hosted but silently produce an
empty spec on Vercel. This is repo-wide scope (fixes all 24 files, not just support's 16), so it was not
done inside a support-platform stage item.

### D-24 — `isUniqueViolation` never matched a real drizzle error

**Found:** live-server verification after SUP-X-1. **Status:** RESOLVED in `b6b9514` (2026-08-14).

`drizzle-orm`'s node-postgres driver throws `DrizzleQueryError`, which wraps the real `pg` error — the
one carrying `.code` — in `.cause` rather than exposing it on the top-level error object.
`isUniqueViolation()` only ever checked the top-level error, so it never matched anything, and every
unique-constraint conflict across the support platform (contact create/update, company create/update,
contact link create) leaked as a raw 500 with a stack trace instead of the intended 409.

**Caught by:** POSTing a duplicate company name against a running dev server, per the user's request to
verify the platform against a real server rather than just unit tests. No existing test caught this,
because the only prior coverage was indirect, through endpoint tests that presumably constructed a raw
`{code: '23505'}` object rather than the real wrapped shape.

**Lesson for this program:** a helper with no dedicated unit test, exercised only indirectly through
other tests that may not reproduce the real error shape, is a live gap even when everything is green.
`isUniqueViolation()` now has its own test file asserting the exact wrapped shape.

### D-25 — Zod `.parse()` in support endpoints returned 500 instead of 400

**Found:** live-server support-case walkthrough after Stage 01. **Status:** RESOLVED (2026-08-14).

All seven support POST/PUT endpoints validated request bodies with a bare `bodySchema.parse(await
readBody(event))`. Zod throws on failure, nothing caught it, and the result was an uncaught 500 with a
stack trace where a 400 was intended. The repo already had `validateBody()` in
`server/utils/validation.ts`, which wraps `safeParse` and throws a structured 400 — every non-support
endpoint uses it. Support simply never adopted it.

Caught by sending a merge request with the wrong field name during a manual walkthrough. Fixed across
`contacts/index.post`, `contacts/[id].put`, `contacts/[id]/merge.post`, `contacts/[id]/links.post`,
`companies/index.post`, `companies/[id].put`, and `teams/[teamId]/settings.put`.

**Convention for Stage 02 onward:** support endpoints use `validateBody(event, schema)`. Never call
`.parse()` directly on a request body.

---

## Stage 02 (planning)

### D-26 — Support configuration had no defined home in the UI

**Found:** UI design discussion before Stage 02. **Status:** resolved in plan (2026-08-14).

The plan said "`/support` in `AppSidebar.vue`" and "inbox settings UI" without saying where enablement or
configuration lived, and three facts in the existing code made the obvious readings wrong:

1. **`AppSidebar.vue` already has a group literally named "Support"** — containing only _Settings_. It is
   a mis-named misc/system group. Adding a support module collides with it, so it is renamed **System**.
2. **The sidebar does not react to feature toggles at all.** `Roadmap` and `Changelog` are hardcoded
   `disabled: true` placeholders. "Which modules does this workspace use" was already an unsolved
   problem; support did not introduce it.
3. **Feature toggles are per-project only** (`project.settings.feedbackEnabled` and friends), but an
   inbox is team-scoped. A per-product toggle alone structurally cannot configure support.

**Decisions:**

- Two distinct surfaces, previously conflated: the **agent workspace** (`/support`, team-scoped) and the
  **customer entry point** (per-product, public board). They get separate controls.
- **Enablement is per team**, in a new **Tools** tab in `/settings`, listing Feedback / Roadmap /
  Changelog / Support. It drives sidebar visibility, which retroactively fixes point 2 above.
- **Inbox configuration is in-context** at `/support/settings`, not in global settings — Stages 05–07 add
  macros, SLA, and automation to it, which would make a global tab unreasonably deep.
- **Switching Support off** hides nav and stops inbound processing, but preserves conversations and
  contacts, matching the existing per-product disable dialog's "data will not be deleted" contract.
- **Contacts join the sidebar** under the new Support group, closing the Stage 01 loose end where they
  were reachable only by URL.

### D-27 — One shared inbox needs multi-address routing to attribute products

**Found:** UI design discussion before Stage 02. **Status:** resolved in plan (2026-08-14).

All products feed one team inbox, and agents filter by product. But **email carries no product signal** —
a customer mailing `support@acme.com` gives nothing to attribute from, so with one address every email
ticket would arrive unattributed and per-product reporting in Stage 09 would be meaningless.

`supportInbox.emailAddress` is a single unique column and cannot express "three addresses, two mapped to
products". Two schema additions follow, neither in the original design:

- **`supportInboxAddress`** — `id`, `inboxId` (FK cascade), `address` (unique), `projectId` (FK project,
  set null — null means unattributed), `isPrimary`, `createdAt`. Teams genuinely want several addresses
  per inbox: one per product, plus general team addresses.
- **`conversation.projectId`** — nullable FK to project. The design's conversation table has
  `linkedFeedbackId` but no product link.

Resolution order: the receiving address's mapping, then an agent override on the conversation. Portal
(Stage 10) and chat (Stage 11) submissions attribute from page context instead.

`supportInbox.emailAddress` is retained as the primary sending identity; `supportInboxAddress` governs
what the inbox _receives_.

### D-28 — Module toggles want a team-admin role that does not yet exist

**Found:** UI design discussion before Stage 02. **Status:** DEFERRED — future reference, not scheduled.

Enabling or disabling a whole module has a much larger blast radius than editing a signature: switching
Support off stops inbound mail for the entire team. That argues for restricting module toggles to admins
while leaving day-to-day inbox configuration open to team members.

**It is not being built now.** `teamMember.role` has `admin` and `member` with **currently equivalent
permissions**, and `design.md` explicitly states "`teamMember.role` semantics are not changed". Acting on
this would be the first real differentiation of that column, and it is not worth pulling that change into
an already-oversized Stage 02.

**For now:** module toggles require team membership only, consistent with every other settings surface in
the app today.

**If revisited:** restrict module enable/disable to `teamMember.role === 'admin'`, keep `/support/settings`
open to members, and note that the design's freeze on `teamMember.role` was about keeping _support_
permissions off it (those live on `supportInboxMember.role`) — workspace administration is arguably a
different question. Whoever picks this up should decide deliberately rather than treating the freeze as
either binding or irrelevant.

### D-29 — IMAP driver dropped from Stage 03

**Found:** scope decision (2026-08-14). **Status:** resolved in plan.

Inbound email is **webhook-only**. The IMAP polling driver is removed from Stage 03, taking with it the
scheduled-poll registration, encrypted IMAP credential storage in `channelConfig`, and the parallel
poll-vs-webhook code path.

The Stage 00 scheduler is unaffected and still required — Stage 06's SLA breach sweeper, Stage 08's CSAT
dispatch, and Stage 09's nightly rollups all use it. Only mail intake stops depending on it.

Self-hosted deployments now require a webhook-capable mail provider. If IMAP is ever reinstated for
self-hosters with no provider, it re-enters as an additional driver behind the same `InboundMessage`
normalization — the adapter boundary in Stage 03 is what keeps that possible.

### D-30 — The team picker's "Workspace" entry is not an organization scope

**Found:** org-workspace request (2026-08-14). **Status:** recorded; addressed by Stage 09b, not
scheduled. Went through three framings before settling — see below.

`TeamSwitcher.vue` renders a "Workspace" row above the team list, styled like a team entry, and it reads
as a cross-team scope. It is not one:

- `switchToDefaultTeam()` resolves the team **named `Default`** and activates it. The app remains in a
  single-team scope.
- `additionalTeams` filters `name !== 'Default'`, hiding that team from the list and silently reusing it
  as an org proxy.
- `displaySubtitle` renders "All projects" in that state, which is **false** the moment a second team
  owns a project.

**Why it matters here:** anyone assessing a cross-team view will look at this component and conclude the
scope already exists and only needs new pages hung off it. It does not — the visible affordance is a team
in disguise, and the resolution below removes it rather than building behind it.

**Three framings, in order:**

1. **"Organization workspace"** — org-wide stats with a per-team breakdown. Rejected: organization
   membership does not imply membership of every team in it, so an org-wide page showing only a user's
   subset is a partial view of something claiming to be complete, and "show everything in the org" is the
   obvious wrong shortcut.
2. **"Home" as a picker entry** — a third option alongside the teams that reroutes every team-scoped
   surface (`/support`, `/feedback`, `/products`) into a cross-team aggregate while selected. Fixed the
   authorization framing but introduced a harder one: clicking through from an aggregate view to one
   team-owned item raises the question of whether the picker's selection silently changes underneath the
   user. Every surface would need its own answer, "new conversation" has no implicit team while Home is
   selected, and a live cross-team inbox needs new realtime fan-out approaching `MAX_CHANNELS_PER_PEER`.
3. **"Home" as a fixed sidebar destination, decoupled from the picker (current).** The picker goes back to
   being purely team selection — the "Workspace" row is **deleted**, not replaced with a scope resolver.
   Home becomes its own small set of read-only cross-team pages (`/home`, `/home/inbox`,
   `/home/feedback`) with their own narrow endpoints, linking out to the real, team-scoped pages for
   everything. `/support` and `/feedback` are untouched. The click-through question stops existing because
   Home never claims to represent the user's current context.

**Consequences of the final framing:** the stage's dependency is Stage 02 only (personal reads need no
`supportMetricDaily` rollups). It renames `/dashboard` to `/home`, made unconditionally visible rather
than gated on organization state. And a `team:<id>` realtime-publish requirement that framing 2 had added
to Stage 02 is **withdrawn** — framing 3's read-only Home pages reuse the existing `user:<id>` notification
channel instead, so Stage 02 needs no change for this at all.

The full detail is in `stage-09b-home.md`.

### D-31 — Module toggles have no defined home, and `supportTeamSettings` is the wrong one

**Found:** planning SUP-02-12. **Status:** resolved in plan (2026-08-15). Not yet implemented.

`stage-02-conversation-core.md` said the Tools tab's module toggles are "stored in `supportTeamSettings`
for support (`supportEnabled`, default false) **and alongside it for the others**". That last clause is
not a design — it names no table for Feedback, Roadmap, or Changelog.

The obvious reading, extending `supportTeamSettings`, is wrong. Delta **D-19** established that table
specifically as the durable home for **support-only** team policy, with `autoLinkFeedback` deliberately
kept out of generic team JSON because it is privacy-sensitive. Putting `feedbackEnabled` /
`roadmapEnabled` / `changelogEnabled` in a table named `support_team_settings` misfiles three unrelated
flags and makes the table's purpose incoherent for whoever reads it next.

**Decision: a new `teamModuleSettings` table**, in a new `server/database/schema/teams.ts`, re-exported
from `index.ts` (the same shape Stage 00's SUP-00-1 split established — one file per domain).

`teamId` (PK, FK team cascade), `supportEnabled`, `feedbackEnabled`, `roadmapEnabled`,
`changelogEnabled`, `createdAt`, `updatedAt`.

`supportTeamSettings` is left alone, still holding `autoLinkFeedback` only.

**Defaults mirror the existing per-project ones** in `ProductSettingsFeatures.vue`, so enabling a module
at team level does not silently change what a product already shows: `feedbackEnabled` **true**,
everything else **false**. Note `feedbackEnabled` defaulting true is what keeps existing workspaces
working unchanged after the migration — a default of false would hide the feedback nav for every current
team on deploy.

**Precedence against the existing per-project toggles: team level is a master switch, and both must be
on.** A product with `settings.feedbackEnabled === true` in a team whose `feedbackEnabled` is false shows
nothing. The team toggle governs whether the module exists for that team at all; the per-project toggle
governs whether a given product uses it. This ordering matters for the Stage 10 per-product Support
toggle too (delta D-26), which is subordinate to the team-level Support module in exactly the same way.

**This is the one migration expected in the rest of Stage 02** (`0023`). Both agents were told to
coordinate before generating one — this is that coordination. Agent 1's remaining items (SUP-02-8, 02-14,
02-15, 02-16) need no schema change, so `0023` belongs to SUP-02-12.

### D-32 — "Disabling Support stops inbound processing" cannot be built in Stage 02

**Found:** SUP-02-13. **Status:** split; enforcement half moved to Stage 03 (2026-08-15).

SUP-02-13 asked for three things when a team switches the Support module off: hide the nav, stop inbound
processing, and preserve conversations and contacts. Only two are Stage 02 work.

- **Hide the nav** — delivered in SUP-02-12. The sidebar reads `teamModuleSettings` and the Support group
  disappears when `supportEnabled` is false.
- **Preserve data** — no work. Nothing in the disable path deletes anything; the flag is a boolean on a
  settings row, entirely separate from the conversation tables.
- **Stop inbound processing** — **there is no inbound processing in Stage 02.** The mail pipeline is
  Stage 03. A guard written now would sit in a file that does not exist, against a code path nothing
  exercises, and could not be tested until Stage 03 lands.

Writing an untestable guard early is how a check ends up silently wrong — the same failure mode as
delta D-24, where `isUniqueViolation()` was exercised only indirectly and never actually matched.

**Moved to Stage 03**, as an explicit item in `stage-03-inbound-email.md`: the inbound endpoint checks
`teamModuleSettings.supportEnabled` for the resolved inbox's team and, when false, records the event and
returns 200 **without** creating a conversation. It must not 404 or error — the sender is a mail provider
that would otherwise retry forever, which is the same reasoning the plan already applies to mail arriving
at an unknown address.

### D-33 — E2E specs that import `db` cannot be collected locally

**Found:** SUP-02-17. **Status:** open, pre-existing, not support-specific.

Any Playwright spec importing `~/server/database/drizzle` fails to collect with:

```
SyntaxError: The requested module 'consola' does not provide an export named 'createConsola'
Error: No tests found.
```

`server/utils/logger.ts` does `import { createConsola } from 'consola'`, and `db` pulls it in
transitively. consola 3.4.2 **does** export `createConsola` — from `dist/index.mjs`, behind its
`exports["."].node` condition. Playwright's loader resolves the `default` (browser) condition instead,
which does not.

**This is pre-existing and not caused by the new spec.** `tests/e2e/support-contact-timeline.spec.ts`,
written in Stage 01, fails identically — verified by running it directly. At least three specs are
affected (`support-contact-timeline`, `support-contact-integrity`, and the new
`support-conversation-flow`).

**Why it matters:** several Stage 01 and Stage 02 acceptance criteria are worded as "verified by E2E".
If these specs cannot collect in CI either, those criteria are not actually being enforced anywhere, and
`yarn harness:verify` would not reveal it — the E2E gate **skips** rather than fails when its guard is
not satisfied, so the suite reports green either way. Nobody would notice.

**RESOLVED (2026-08-15), and the root cause was not what the first diagnosis assumed.** It is not an
export-condition problem between the browser and node builds — both `dist/browser.mjs` and
`dist/index.mjs` export `createConsola`. Playwright resolves consola's **`require`** condition to
`lib/index.cjs`, which assigns its exports in a dynamic loop:

```js
module.exports[key] = lib[key]
```

`cjs-module-lexer` cannot detect those statically, so an ESM named import of `createConsola` from that
file fails. Node and Nuxt resolve the `.mjs` build, which is why the application was never affected.

**Fix:** E2E specs no longer import `~/server/database/drizzle`. `tests/e2e/helpers/db.ts` builds its own
drizzle client from `pg` plus the schema — the schema depends only on `drizzle-orm/pg-core`, so no app
module (and therefore no logger, and no consola) is pulled into the test process. `logger.ts` was
deliberately **not** changed: it is used app-wide, and the CJS/ESM interop shape of a default vs named
import differs between the two builds, so "fixing" it there risked breaking production logging to
accommodate a test-runner quirk.

**What this exposed:** the three affected specs had never run. Stage 01's cross-tenant isolation,
concurrent-merge, and cursor-pagination criteria were written as "verified by E2E" and were enforcing
nothing. All five tests now collect; 3 pass and 2 skip on absent fixture data.

**Still true and worth acting on:** `yarn harness:verify` **skips** the E2E gate locally rather than
failing, so a broken spec file is indistinguishable from a deliberately skipped suite. That is what let
this hide for two stages. Tracked in SUP-X-6.

**Superseded — original diagnosis below, kept because the reasoning is instructive.** The likely fix is a resolution/alias condition in `playwright.config.ts`, or having
`logger.ts` import in a way that resolves under both conditions. It is repo-wide rather than
support-specific, so it is queued as its own item rather than folded into a stage task. Whoever picks it
up should first establish whether these specs pass in CI today — that determines whether this is a local
inconvenience or a silent hole in the whole E2E gate.

---

### D-34 — `supportEmailEvent.inboxId` cannot be `NOT NULL`

**Found:** implementing SUP-03-4. **Status:** resolved in code (2026-08-16), migration `0024`.

`stage-03-inbound-email.md` requires recording an event in two cases where no inbox exists:

- step 5 — "No match → **record the event with an error** and return 200; do not 404, or the provider
  will retry forever";
- **SUP-03-10** — support disabled for the team → "**record the event**, return 200, create nothing".

`supportEmailEvent.inboxId` landed `NOT NULL` in SUP-02-1, which makes both rows impossible to write.
`design.md` says only "`inboxId` (FK, cascade)" and never states nullability, so this was not a mistake
against the design — the design simply did not cover it.

This is **not** fixable by reordering. Mail to an unrecognised address resolves to no inbox at any point
in the pipeline, so there is no ordering under which the row becomes writable. The mandated order makes
it worse but is not the cause: the claim happens as soon as the signature verifies, which is before
parsing has revealed the recipient at all.

**Decision: `inboxId` is nullable** (`0024_concerned_violations.sql`, a single `DROP NOT NULL`).

The row is keyed on the **delivery**, not on an inbox — `(provider, providerEventId)` is its unique key.
The inbox is something processing may discover, and may legitimately never discover. That is the same
category of field as `resultConversationId` in the same table, which was already nullable for exactly
this reason, and matches `contact.userId`, `conversation.projectId`, and `supportInboxAddress.projectId`
elsewhere in the schema. The `NOT NULL` was the inconsistency.

Null therefore reads as "not attributed to an inbox": unmatched recipient, disabled team, or a payload
that failed to parse before resolution was reached. Anything scoped to an inbox must filter
`inboxId IS NOT NULL` rather than assume presence.

Risk was nil: the table had zero rows, Stage 03 is its first writer, and `0024` was free. `onDelete`
stays `cascade` — deleting an inbox still discards its raw event log, which is arguably wrong for an
audit trail but is what `design.md` specifies, and changing it is a separate decision.

**Migrations were declared unlikely for Stage 03.** This one was raised before being written rather than
generated quietly, per the agent contract.
