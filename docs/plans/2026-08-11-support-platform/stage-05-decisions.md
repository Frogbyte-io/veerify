# Stage 05 — Scope decisions and backlog

**Settled:** August 30, 2026, in a design review of the original `stage-05-agent-productivity.md`.
That document is superseded by this one plus [`stage-05a-agent-speed.md`](stage-05a-agent-speed.md)
and [`stage-05b-feedback-bridge.md`](stage-05b-feedback-bridge.md).

This file exists because **most of Stage 05 is now things deliberately left out.** A stage doc that
lists only what to build invites a future agent to "complete" it by adding back round-robin, macros, and
bulk actions. Each cut below has a reason; if the reason stops holding, reopen the decision explicitly.

---

## The framing decisions

**1. Target team: 1–3 agents.** Not 3–8, not shift-based. Every _coordination-at-scale_ feature in the
original scope — round-robin, availability toggles, load balancing, supervisor views — solves a problem
a three-person team does not have.

**2. The core loop is claiming, not triage.** The requested loop was "assign or self-assign so the first
to take it owns it." That is not triage in the Zendesk sense — triage is a _sorting_ step that pays off
only when the router and the worker are different people, which they never are at this size. What "first
to take it owns it" solves is **collision**: two of three agents opening the same ticket and both
replying. The MVP therefore optimizes for _ownership clarity_, not _routing_. Tag/priority/bulk-sort
tooling is demoted accordingly.

**3. The stage splits into two shippable slices.** 05a (agent speed) and 05b (feedback bridge) touch
near-disjoint code — 05a is the list, the composer, and `conversations/[id].patch.ts`; 05b is a new
dialog plus the feedback subsystem and `contactLink`. 05a is independently shippable and does not block
05b.

**4. Done means dogfood, not parity.** Veerify's own support runs on 05a and every ticket is answered in
the app. Mechanical criteria (even round-robin distribution, `EXPLAIN` output) do not establish that an
inbox is usable. See the stated volume limitation in `stage-05a-agent-speed.md` — at ~1 ticket/week this
gate proves nothing is broken, not that the design holds under load.

## The scope decisions

**5. Ownership attaches two ways.** An explicit **Claim** button, _and_ auto-claim on the first outgoing
reply when unassigned. Replying claims, so nobody can forget to claim. Reopen keeps the original
assignee.

**6. No presence in MVP.** Collision is handled by the claim field plus Stage 02's realtime list updates.
**Accepted risk:** two agents can still open the same unclaimed conversation within seconds and both
reply. Tolerable at three agents, not above ~five. Presence and typing indicators are backlogged.

**7. Day-one primitives: read/unread and local draft persistence.** Undo-send and snooze both deferred.

**8. Search is scoped, not full-text.** `displayId`, subject, and contact name/email only. **No
message-body search, and the standing rule is: never `ILIKE` `conversationMessage`.** The `tsvector` +
GIN migration is deferred until volume demands it, at which point it is built properly rather than crept
into via `ILIKE`.

**9. Canned responses only, no macros.** `/shortcode` insertion with `{{contact.name}}` and
`{{agent.name}}`. `{{conversation.displayId}}` dropped — agents do not type ticket numbers into replies.

**10. The feedback bridge is deferred out of MVP.** Stated plainly: the bridge is what the original
document called "the reason this platform exists rather than a Zendesk subscription," so the MVP ships a
competent inbox with no structural advantage over Chatwoot. The dogfood gate validates _usability_, not
_differentiation_. Decision 16 is the mitigation.

**11. Snooze is out.** `conversation.status = 'snoozed'` and `conversation.snoozedUntil` therefore have
**no writer anywhere in the program** and are intentionally dormant. Do not invent semantics for them and
do not remove them as dead-column cleanup.

**12. Internal notes never auto-claim.** Only an `outgoing` message claims. A note is frequently
"is this yours?" — the case where claiming is actively wrong — and keeping notes claim-free preserves
them as the low-commitment way to add context to someone else's conversation.

**13. Read state is per-user, superseded by handled-ness.** Each agent has their own `lastReadAt`. Once a
conversation is claimed _and_ replied to, it stops surfacing as unread to everyone except the assignee.
A later customer reply re-marks unread **for the assignee only**. Manual "mark unread" exists.

**14. Four fixed views: Unassigned · Assigned to me · Resolved · All**, landing on Unassigned. No snoozed
view (decision 11) and no `closed` view. This fixed set is the entire navigation model; saved views are
cut, which is why search is global (decision 21).

**15. Keyboard shortcuts:** `j`/`k`, `r`, `n`, `c` (claim-to-me), `e`, `/`, `?`. `c` replaces the original
`a`-as-assign — claiming is the most repeated action in this loop, and a full assignee picker is a mouse
action when the list is two other people. Ship this item last.

**16. 05b is scheduled immediately after 05a — ahead of Stages 06, 07, and 08.** SLA, automation, and CSAT
are parity features a three-person team needs _less_ than the macros already cut by decision 9. If the
bridge slips behind them it slips a very long way.

**17. Handoff and release both exist.** Claim-to-me, unassign (release to the pool), and assign-to-another
-agent via a plain dropdown, no shortcut. Handoff is the one coordination act a small team really
performs; without unassign, auto-claim on reply becomes a trap.

**18. Unread is queue membership.** Once owned, a conversation is in exactly one agent's queue, so new
customer replies re-mark it unread for the assignee only. The alternative drags all three agents back
into every handled thread and makes unread counts meaningless within a week.

**19. Drafts are keyed by `(conversationId, mode)` and restore their mode.** A reply draft and a note
draft coexist. Restoring note text into a reply composer would reintroduce the note/reply confusion that
Stage 02 calls the single highest-consequence UI bug in a support product.

**20. Canned responses are team-scoped.** The `inboxId` column from the original schema is **dropped** —
`design.md` gives each team one shared inbox, so it has exactly one possible value. Every agent can
create and edit; no role check, consistent with delta D-28.

**21. Search is global, never view-scoped.** The conversation you cannot find is nearly always the one
that is not in the view you are looking at — usually Resolved. Bare numeric input matches `displayId`
exactly in addition to substring matching.

**22. The dogfood gate is "every ticket answered in the app," at ~1 ticket/week.** Recorded honestly: two
weeks is roughly two tickets. It will not surface the collision risk accepted in decision 6.

---

## Backlog — deferred work

These became GitHub issues on August 30, 2026. Note the tension with `README.md`'s dispatch protocol
("No GitHub Issues, no new tooling") — that protocol governs _in-program stage dispatch_; this is
post-MVP backlog outside it.

| Item                                             | Issue                                                  | Why deferred                                            |
| ------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------- |
| Agent presence + typing indicators               | [#37](https://github.com/Frogbyte-io/veerify/issues/37) | Solves collision properly; overkill at 3 agents         |
| Undo-send (15-30s outbox hold)                   | [#38](https://github.com/Frogbyte-io/veerify/issues/38) | Cheap because Stage 04's outbox exists, but not day-one |
| Snooze workflow + scheduler wake-up              | [#39](https://github.com/Frogbyte-io/veerify/issues/39) | Schema columns already exist, dormant (decision 11)     |
| Message-body full-text search (`tsvector` + GIN) | [#40](https://github.com/Frogbyte-io/veerify/issues/40) | Volume-triggered                                        |
| Macros                                           | [#41](https://github.com/Frogbyte-io/veerify/issues/41) | Runbook feature for large teams                         |
| Round-robin + agent availability toggle          | [#42](https://github.com/Frogbyte-io/veerify/issues/42) | Coordination-at-scale; no problem to solve at 1-3 agents |
| Saved views                                      | [#43](https://github.com/Frogbyte-io/veerify/issues/43) | Four fixed views suffice at this size                   |
| Bulk actions                                     | [#44](https://github.com/Frogbyte-io/veerify/issues/44) | Triage-at-volume feature                                |
| Merge and split                                  | [#45](https://github.com/Frogbyte-io/veerify/issues/45) | Real need, but not before there is volume to merge      |
| Server-side draft sync                           | [#46](https://github.com/Frogbyte-io/veerify/issues/46) | Cross-device sync matters at 20 agents, not 3           |

**The feedback bridge is deliberately not on this list.** It is not backlog — it is
[`stage-05b-feedback-bridge.md`](stage-05b-feedback-bridge.md), scheduled immediately after 05a and
ahead of Stages 06, 07, and 08. Filing it as an issue would be how it quietly becomes "someday."
