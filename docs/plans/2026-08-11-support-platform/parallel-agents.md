# Stage 03 — Parallel agent split

**Created:** August 15, 2026. **Applies to:** Stage 03 (inbound email).
**Supersedes** the Stage 02 split, which is complete (17/17). The Stage 02 retrospective at the bottom is
worth reading — three of its findings change how this stage should be worked.

Two Claude sessions work this stage concurrently. This document is the contract between them.
**Agent 1 reads this first.** Agent 2 wrote it and works from `D:\veerify`.

---

## Workspaces

|                   | Agent 1                 | Agent 2            |
| ----------------- | ----------------------- | ------------------ |
| Working directory | **`D:\veerify-agent1`** | `D:\veerify`       |
| Branch            | **`agent1/stage-03`**   | `support-platform` |

The worktree at `D:\veerify-agent1` already exists from Stage 02 with `node_modules` installed. Cut a
**fresh branch** — do not continue on `agent1/stage-02`:

```bash
cd D:/veerify-agent1
git fetch origin
git checkout -b agent1/stage-03 origin/support-platform
```

Shared and still true: the Postgres dev container is shared between worktrees, and ports 3001–3004 are in
use — start dev servers above that.

---

## Why the split is different this stage

Stage 02 divided cleanly into API and UI. Stage 03 does not, because **SUP-03-4 (the inbound endpoint) is
an integration point that consumes almost everything else**: threading, quote stripping, sanitization,
auto-response detection, contact resolution, attribution, and attachments all meet inside it.

So the seam is **pipeline vs pure modules**, not API vs UI. Agent 1 owns the wire and the endpoint;
Agent 2 owns the pure content-processing modules the endpoint calls, plus the UI that renders the result.

That only works if both sides agree the function signatures **before** writing code — see the next
section. In Stage 02, two correct-in-isolation pieces produced a broken feature where they met; this is
the mitigation.

---

## Agreed module interfaces — do not diverge without saying so

Agent 2 implements these. Agent 1 imports them. If you need to change a signature, **say so before
changing it** rather than adapting locally.

```ts
// server/services/support-channels/types.ts   (Agent 1 defines, both consume)
export interface InboundMessage {
  messageId: string | null // RFC Message-ID, angle brackets stripped
  inReplyTo: string | null
  references: string[] // oldest → newest
  from: { address: string; name?: string }
  to: { address: string; name?: string }[]
  cc: { address: string; name?: string }[]
  subject: string | null
  text: string | null
  html: string | null
  attachments: InboundAttachment[]
  receivedAt: Date
  rawHeaders: Record<string, string>
}

// server/utils/inbound-threading.ts           (Agent 2)
// `tx` so the caller can resolve inside its own transaction.
export async function resolveThread(
  tx: Tx,
  inbox: { id: string; teamId: string },
  message: InboundMessage,
  contactId: string
): Promise<{ conversationId: string | null; matchedBy: 'message-id' | 'thread-key' | 'subject' | null }>

// server/utils/inbound-content.ts             (Agent 2) - pure
export function stripQuotedReply(input: { text: string | null; html: string | null }): {
  body: string // quoted history and signature removed
  rawBody: string // untouched, for conversationMessage.metadata
}

// server/utils/inbound-sanitize.ts            (Agent 2) - pure
export function sanitizeInboundHtml(html: string | null): string | null

// server/utils/inbound-autoresponse.ts        (Agent 2) - pure
export function isAutoResponse(headers: Record<string, string>): boolean
```

`resolveThread` returning `conversationId: null` means "no match, create a new conversation" — it never
creates one itself. `matchedBy` exists so the endpoint can log why, and so the never-merge-across-contacts
rule is testable from the outside.

---

## Work split

### Agent 1 — intake pipeline

Order matters: **1 → 2 → 3 first**, which depend on nothing of Agent 2's. By the time you reach 4, the
pure modules should have landed.

- [ ] **SUP-03-1** Channel adapter, `types.ts`, `InboundMessage`, driver selection from `SUPPORT_CHANNEL_PROVIDER`
- [ ] **SUP-03-2** Postmark webhook driver — signature verification, payload → `InboundMessage`, unit tests against captured fixtures
- [ ] **SUP-03-3** Mailgun webhook driver — same shape
- [ ] **SUP-03-4** `supportEmailEvent` claim/replay state + `POST /api/support/inbound/[provider]`, per-inbox rate limiting. **The order of operations in the stage doc is a correctness requirement, not a suggestion** — signature, then atomic claim, then archive raw, then parse
- [ ] **SUP-03-8** Attachment ingest to storage, inline `Content-ID` mapping, per-message size cap
- [ ] **SUP-03-10** Honour `teamModuleSettings.supportEnabled` — record the event, return 200, create nothing
- [ ] **SUP-03-11** Contact and CC-participant resolution from `From` and `Cc`
- [ ] **SUP-03-12** Product attribution from the matched `supportInboxAddress.projectId`

### Agent 2 — content modules, rendering, E2E

- [ ] **SUP-X-5** Fix Playwright collection first — it blocks SUP-03-14 and, more importantly, may mean the E2E gate has been enforcing nothing for two stages
- [ ] **SUP-03-5** Threading resolution
- [ ] **SUP-03-6** Quote and signature stripping
- [ ] **SUP-03-9** Auto-response detection
- [ ] **SUP-03-7** HTML sanitization + sandboxed-iframe rendering in the thread pane
- [ ] **SUP-03-13** Channel configuration UI on `/support/settings`
- [ ] **SUP-03-14** E2E: inbound mail creates a ticket, a reply threads onto it, a duplicate delivery does not double it

### File boundaries

| Agent 1 owns                          | Agent 2 owns                                          |
| ------------------------------------- | ----------------------------------------------------- |
| `server/services/support-channels/**` | `server/utils/inbound-threading.ts`                   |
| `server/api/support/inbound/**`       | `server/utils/inbound-content.ts`                     |
| `server/utils/inbound-events.ts`      | `server/utils/inbound-sanitize.ts`                    |
| `server/utils/inbound-contacts.ts`    | `server/utils/inbound-autoresponse.ts`                |
|                                       | `components/support/**`, `pages/support/settings.vue` |
|                                       | `tests/e2e/**`, `playwright.config.ts`                |

**Shared, read-only unless flagged:** `server/utils/support-realtime.ts`,
`server/utils/conversation-activity.ts`, `server/utils/support-access.ts`, `server/database/schema/**`.

**No migrations are expected this stage** — every table inbound email touches landed in `0022`. If you
believe you need one, stop and say so first.

---

## Syncing

Unchanged from Stage 02, and it worked: **`support-platform` is the single integration point.** Pull from
it at the start of every item; push finished items to it only after `yarn harness:verify` is green _after_
merging `origin/support-platform` into your branch.

```bash
git fetch origin && git merge origin/support-platform
yarn harness:verify          # must be green after the merge, not before
git checkout support-platform && git pull --rebase origin support-platform
git merge --no-ff agent1/stage-03
yarn harness:verify
git push origin support-platform
git checkout agent1/stage-03 && git merge support-platform
```

`git checkout support-platform` fails while Agent 2 has it checked out — that is expected. Push your
branch, say it is ready, and Agent 2 integrates. **Push races happened twice in Stage 02**; on rejection,
`git pull --rebase`, re-verify, push again. Never force-push.

---

## Rules

1. **`TODO.md` is edited by whoever integrates**, in a separate `chore(todo):` commit. Never inside a
   feature commit.
2. **Read before writing:** `.agents/CLAUDE.md`, then `design.md`, then `deltas.md` (33 entries; several
   override the stage docs), then `stage-03-inbound-email.md`.
3. **Options API only** for new components.
4. **`validateBody(event, schema)`** — never a bare `.parse()` on a request body (delta D-25).
5. **Report ambiguity, don't silently resolve it.** Every undocumented gap hit so far was flagged in
   `TODO.md` rather than buried. Keep doing that.
6. **Never run `prettier --write .`** on Windows. `core.autocrlf=true` plus no `endOfLine` in
   `.prettierrc` means ~110 files "fail" `format:check` on line endings alone, all false positives. Use
   `npx prettier --check --end-of-line=auto .` to see the truth, and format only the files you touched.
   See SUP-X-6.

---

## What Stage 02 taught, that applies here

**1. Correct-in-isolation is not correct.** SUP-02-15's notification linked to
`/support?conversationId=…` — the right key, verified against what the page writes. But the page only
ever _read_ `inboxId` back, so the link never opened the conversation. Neither agent could have caught it
alone. **This stage has far more seams than that one**, which is why the module signatures are pinned
above. When you consume the other agent's function, check its actual behaviour, not just its name.

**2. Subagents die on `yarn install`.** Every subagent dispatched into a fresh worktree during Stage 02
burned its budget on install and hit the session limit before validating; two produced usable code but
neither ran a single test. Work inline in your own worktree where `node_modules` already exists.

**3. Green gates can mean nothing ran.** `yarn harness:verify` reports success when the E2E guard
**skips**, and Playwright currently cannot collect any spec importing `db` (delta D-33). Two stages of
"verified by E2E" acceptance criteria may be enforcing nothing. `format:check` is not in the gate at all.
If an item's acceptance criterion says E2E, confirm the spec actually _ran_ — and if it cannot, verify by
hand against a live server and say so plainly rather than claiming coverage.

---

## State at time of writing (`06d7be2`)

Stage 02 **complete, 17/17**. `origin/support-platform` and local are in sync, working tree clean, all
`harness:verify` gates green: agent docs map, typecheck, 198 unit tests, lint (0 errors / 158 pre-existing
warnings), guarded E2E, guarded Redis, guarded Postgres.

Open cross-cutting items: **SUP-X-3** (build-time OpenAPI scanner), **SUP-X-4** (admin-only module
toggles, deliberately deferred — read D-28 first), **SUP-X-5** (Playwright collection — assigned to Agent
2 above), **SUP-X-6** (format gate + CRLF).
