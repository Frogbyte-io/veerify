# Stage 01-04 manual provider validation

**Created:** 2026-09-03, for Task 16 Step 2 of `stage-01-04-hardening-implementation.md`.

**This file is deliberately separate from every automated result.** The hardening review's test
counts (529 unit, 99 PostgreSQL integration, 6 Redis integration) prove the code behaves against
fixtures, fakes, and a local database. They prove nothing about what Postmark, Mailgun, Gmail,
Outlook, or S3 actually do with our output. Folding the two together is how "verified" quietly comes
to mean "verified against our own assumptions" — the failure mode delta D-24 and the SUP-03-14 spec
bug were both instances of.

**Status vocabulary.** `pending` — not yet attempted. `passed` — performed, evidence captured.
`failed` — performed, evidence contradicts the expectation. `unavailable` — cannot be attempted here
for a stated reason (no credentials, no account, no mailbox).

**Every row below is `pending` or `unavailable`.** Nothing in this file has been executed. The
worktree that produced Task 16 has no Postmark or Mailgun credentials, no S3 endpoint beyond local
MinIO, and no Gmail/Outlook mailboxes. Do not read a `pending` row as a passing one.

---

## 1. Reply threading in real mail clients

Stage 03 threads on `Message-ID`/`References`, scoped to the receiving inbox since Task 11. Mail
clients are the only authority on whether a chain is acceptable to them — a chain that our own
resolver accepts can still render as a detached message in Gmail.

| #   | Check                                      | Prerequisite                             | Action                                                                       | Expected evidence                                                                           | Actual result | Status                                  |
| --- | ------------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------- | --------------------------------------- |
| 1.1 | Gmail reply threads onto the agent reply   | Verified sending domain; a Gmail account | Agent replies from the app; reply to it from Gmail                           | Gmail groups both in one conversation; inbound lands on the same ticket, no new `displayId` |               | `unavailable` — no Gmail mailbox here   |
| 1.2 | Outlook reply threads onto the agent reply | As above; an Outlook/M365 account        | Same, from Outlook                                                           | Same, plus no `threadingCollision` metadata on the conversation                             |               | `unavailable` — no Outlook mailbox here |
| 1.3 | Deep chain keeps a valid root              | A 5+ message thread                      | Continue replying until `References` trims (`buildReferences`, `maxEntries`) | First entry preserved and still the thread root in both clients                             |               | `pending`                               |
| 1.4 | Quoted history strips cleanly              | 1.1 or 1.2 complete                      | Inspect the stored inbound body                                              | Agent's quoted text removed; raw body retained in metadata                                  |               | `pending`                               |

## 2. Postmark

Task 12 made provider correlation depend on Postmark preserving what we send. Each item below is an
assumption that path is built on, and each is only checkable against the live provider.

| #    | Check                                                             | Prerequisite                                      | Action                                                                | Expected evidence                                                                                                                                                                      | Actual result | Status                                       |
| ---- | ----------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------- |
| 2.1  | RFC `Message-ID` preserved                                        | `SUPPORT_POSTMARK_*` credentials; verified sender | Send an agent reply                                                   | The `Message-ID` we generated appears unchanged in the delivered mail's headers                                                                                                        |               | `unavailable` — no credentials here          |
| 2.2  | `Metadata` round-trips                                            | 2.1                                               | Inspect the delivery webhook                                          | `veerify-delivery-id` returns identical to the outbox `idempotencyKey`                                                                                                                 |               | `unavailable`                                |
| 2.3  | Trace/message IDs correlate                                       | 2.1                                               | Compare send response to webhook                                      | `providerMessageId` from the send matches the webhook's `MessageID`                                                                                                                    |               | `unavailable`                                |
| 2.3a | **`SUPPORT_POSTMARK_ACCOUNT_KEY` equals the reported `ServerID`** | 2.1                                               | Compare the configured env value against `ServerID` on a real webhook | Identical, so the correlation fallback can match. **A review found these come from unrelated sources; if they differ the fallback is dead and only the metadata key ever correlates.** |               | `pending` — blocks a deferred review finding |
| 2.3b | **An outbound send records a `providerMessageId`**                | 2.1                                               | Inspect `support_outbound_delivery` after a send                      | Column is non-null. It is never populated on the SMTP/nodemailer path, so confirm which transport a real deployment uses.                                                              |               | `pending` — blocks a deferred review finding |
| 2.4  | Delivery webhook maps to `delivered`                              | 2.1                                               | Await the Delivery event                                              | `conversationMessage.deliveryStatus` = `delivered`; exactly one `support.delivery.delivered` metric                                                                                    |               | `unavailable`                                |
| 2.5  | Hard bounce maps to `bounced` + activity                          | A known-bad recipient                             | Send to it                                                            | Status `bounced`, exactly one bounce `activity` message, one `support.delivery.bounced` metric                                                                                         |               | `unavailable`                                |
| 2.6  | Soft bounce does **not** flip status                              | A soft-bouncing recipient (e.g. mailbox full)     | Send to it                                                            | Event recorded; `deliveryStatus` unchanged; no activity message                                                                                                                        |               | `pending` — hard to provoke on demand        |
| 2.7  | Signature rejection                                               | Credentials configured                            | POST the delivery URL with a wrong signature                          | 401, nothing recorded                                                                                                                                                                  |               | `pending`                                    |

## 3. Mailgun

| #    | Check                                                                | Prerequisite                                     | Action                                                              | Expected evidence                                                         | Actual result | Status                                       |
| ---- | -------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------- | -------------------------------------------- |
| 3.1  | `v:` custom variables round-trip                                     | `SUPPORT_MAILGUN_*` credentials; verified domain | Send an agent reply                                                 | Our correlation variable returns unchanged on the webhook                 |               | `unavailable` — no credentials here          |
| 3.1a | **`SUPPORT_MAILGUN_ACCOUNT_KEY` equals the reported sending domain** | 3.1                                              | Compare the configured env value against the webhook's domain field | Identical. Same consequence as 2.3a if not.                               |               | `pending` — blocks a deferred review finding |
| 3.2  | Delivered event maps to `delivered`                                  | 3.1                                              | Await the delivered event                                           | Status `delivered`; one metric                                            |               | `unavailable`                                |
| 3.3  | Permanent failure maps to `bounced`                                  | A known-bad recipient                            | Send to it                                                          | Status `bounced` + one activity message; a temporary failure does **not** |               | `unavailable`                                |
| 3.4  | HMAC envelope verification                                           | Credentials configured                           | POST with a tampered timestamp/token                                | 401, nothing recorded                                                     |               | `pending`                                    |
| 3.5  | Account isolation                                                    | Two Mailgun accounts/domains                     | Deliver an event whose `providerEventId` collides across accounts   | Both recorded; neither correlates to the other's message                  |               | `pending` — needs a second account           |

## 4. Multiple recipients

`selectDeliveryCorrelationCandidate` matches one recipient out of a multi-recipient payload. Unit
coverage exists; what it cannot show is whether a provider emits one event per recipient with a
distinguishing address, which is the assumption the fallback rests on.

| #   | Check                                   | Prerequisite                       | Action                            | Expected evidence                                                                         | Actual result | Status                                                                                            |
| --- | --------------------------------------- | ---------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| 4.1 | Per-recipient delivery events           | Provider credentials; 2+ addresses | Reply with a CC                   | One event per recipient, each with its own address; each correlates to the same message   |               | `unavailable`                                                                                     |
| 4.2 | One bounce does not condemn the message | 4.1, one address invalid           | Send to both                      | Bounce recorded for the failing address; the delivered one does not read as fully bounced |               | `pending` — bounce-dominant terminal status is deliberate; confirm it reads correctly to an agent |
| 4.3 | CC participants resolve                 | 4.1                                | Inspect conversation participants | Each CC becomes a participant; no duplicate contacts                                      |               | `pending`                                                                                         |

## 5. S3 storage: size enforcement and the temporary-prefix lifecycle

Local MinIO is not S3. Multipart thresholds, `Content-Length` enforcement on presigned PUTs, and
lifecycle expiry on the temporary prefix are all points where a real S3 implementation can differ,
and all three are load-bearing for Tasks 7-9.

| #   | Check                                 | Prerequisite           | Action                                                     | Expected evidence                                                                                 | Actual result | Status                                                                                                         |
| --- | ------------------------------------- | ---------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------- |
| 5.1 | Presigned PUT enforces the size cap   | A real S3 bucket       | Upload a file exceeding the per-file cap using the presign | S3 itself rejects it; no `uploaded` row survives                                                  |               | `unavailable` — local MinIO only                                                                               |
| 5.2 | Outbound total size enforced          | 5.1                    | Attach files exceeding the total cap and send              | Send rejected before enqueue; nothing queued                                                      |               | `pending`                                                                                                      |
| 5.3 | Temporary prefix has a lifecycle rule | Bucket admin access    | Inspect bucket lifecycle configuration                     | An expiry rule covers the temp prefix, so an object the cleanup worker never claims still expires |               | `pending` — **the cleanup worker is not a substitute for this rule; confirm it exists in any real deployment** |
| 5.4 | Cleanup deletes real objects          | 5.1                    | Let a session expire; run the cleanup task                 | Temp object gone from the bucket; row `expired`; one `support.attachment.expired` metric          |               | `pending`                                                                                                      |
| 5.5 | Missing object is not an error        | 5.4                    | Delete the object by hand first, then run cleanup          | Treated as already-deleted; no retry, no `cleanup_failed` metric                                  |               | `pending`                                                                                                      |
| 5.6 | Download is forced-attachment         | A persisted attachment | Fetch the download URL                                     | `Content-Disposition: attachment`; an HTML attachment cannot render inline from our origin        |               | `pending`                                                                                                      |

---

## How to record a result

Fill **Actual result** with observed evidence — header values, webhook JSON field names, status
column values, metric names — not "works". Set **Status**, and date any `failed` row with a link to
the issue or commit that addresses it. Leave rows `pending` rather than guessing: an unattempted row
is useful information, and a wrongly-`passed` one is worse than nothing.
