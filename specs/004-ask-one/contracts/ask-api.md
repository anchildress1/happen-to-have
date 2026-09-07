# Contract: `POST /api/ask`

**Feature**: 004-ask-one · **Date**: 2026-09-06

The one endpoint. Audio in, one terminal outcome out. Shapes in
[data-model.md](../data-model.md); this defines behaviour.

**Not `/api/question`.** That path exists and does the opposite — it is 001's *selection*
endpoint, which hands the caller a question to answer ([research D4](../research.md)).

---

## Request

`multipart/form-data`, because the audio is a file and the rest is metadata.

| Field | Type | Required | Notes |
| - | - | - | - |
| `audio` | file | yes | as recorded; the browser's own mime type, codec parameters intact |
| `submissionId` | uuid | yes | one per recording attempt, not per request (FR-014a) |
| `durationSeconds` | integer | yes | a claim, re-checked (FR-006a) |

Identity comes from the session cookie. **The endpoint never mints a participant** — 001 owns
that, and a participant created here would arrive with `can_ask = false` and be refused one
line later anyway, having written a row for a flood.

**There is no `questionId`.** This flow creates a question. Relevance is not evaluated for a
question (002 FR-003), so there is nothing to judge it against.

**There is no eligibility field, and adding one is forbidden.** FR-004: client-supplied
eligibility is advisory. The server reads `participants.can_ask` and the publish statement
enforces it again under a row lock.

---

## Order of operations

1. **Session.** No participant id → `401` with `{ status: 'failed', cause: 'no-session' }`.
   Nothing is created.
2. **Shape.** Missing or malformed fields → `withheld / content / unintelligible`. A malformed
   request is indistinguishable from an unusable recording *from the participant's side*, and
   both mean record again.
3. **Idempotency.** A `submissionId` already on a question row returns `published` without
   re-reviewing. **This is the retried-*request* case and only that** — one recording sent more
   than once, whether by a duplicate submit, a retried upload, or the loser of a same-id race.
   A re-record mints a new id and never reaches this branch; that participant lands on `spent`
   at step 8, which is the honest outcome for them ([research D2](../research.md)).
4. **Eligibility, read.** `readAskEligibility(participantId)` — 003's `src/db/queries/answers.ts`
   export, built for this. False → `spent`, before any provider call.
5. **Cheap bounds.** Size ceiling and the declared duration (1–60), before any provider call.
6. **Review.** `reviewContribution({ kind: 'question', questionText: null })`. Three calls, not
   four. Anything but `publish` returns here, having written nothing and consumed nothing.
7. **Publish.** The one statement: consume, insert, report.
8. **Lost the race.** No row and no matching submission → `spent`.

**Step 4 is a read, and it is not the enforcement.** It exists to refuse before spending a
provider call on a submission the statement in step 7 will refuse anyway. Removing it would
cost money and change no outcome; trusting it *instead* of the statement's `WHERE can_ask =
true` would be the FR-004 violation.

**Review runs before anything is persisted, and that ordering is the design.** A withheld,
failed or rate-limited attempt must leave nothing behind — no row, and no consumed ask. That
absence is what makes FR-021's "record another question with the ask intact" true with no
bookkeeping.

---

## Responses

All outcomes are `200` unless noted. The status code reports whether the *request* was handled,
not whether the question was liked; a withheld question is a successful review with a negative
verdict, and a `4xx` there would look like a client error to every log and retry heuristic in
the stack.

| Body | HTTP | When |
| - | - | - |
| `{ status: 'published' }` | 200 | review passed, the ask was consumed, the row landed |
| `{ status: 'withheld', reason, contentReason? }` | 200 | any refusal from 002 |
| `{ status: 'rate_limited', retryAt }` | 200 | 002's daily limit; the ask is untouched |
| `{ status: 'failed', cause }` | 200 | `exhausted` or `deadline` |
| `{ status: 'spent' }` | 200 | no unspent ask — held by nobody, or won by another request |
| `{ status: 'failed', cause: 'no-session' }` | 401 | no session |
| — | 499 | the caller aborted; nothing written, nobody left to render for |

Every body is JSON, **including the 401**: the client calls `response.json()` unconditionally,
so a bodiless response there throws on parse. 003 shipped that bug and fixed it.

**`published` carries no fields.** There is no `askGranted` — the ask was spent, not granted,
and that is the only thing that can have happened. There is no question id, because the
confirmation screen does not show the question back ([data-model.md](../data-model.md)).

**`spent` is not `failed`, and the distinction is the whole of [research D6](../research.md).**
The processing-failure page says *you can record again*. Once the ask is consumed that is
false, and it is the one lie the reciprocity rule cannot afford.

**`spent` is reached only after re-reading the submission id.** A same-id race has a winner and
a loser, and the loser's question *was* published — by the winning request. Reporting `spent`
there would tell someone their question was refused when it is sitting in the pool. The route
re-reads `findQuestionBySubmission` after a failed insert, exactly as 003's route does before
calling something ineligible.

---

## The gate at `/ask` itself

Separate from the endpoint, and both are required.

| Caller | Result |
| - | - |
| No session | redirect to `/answer`; 001 mints identity there |
| Session, `can_ask = false` | redirect to `/answer` (FR-003) |
| Session, `can_ask = true` | render the unlocked state (FR-004a) |

A redirect rather than a refusal page: FR-003 says *send them to answer a question first*, and
a page explaining why they cannot ask is a screen whose only action is the redirect.

**The page gate is not a substitute for the endpoint's.** FR-002 requires the server to refuse
a submission that bypasses the interface entirely, which never loads the page.

---

## What this endpoint must never do

| Prohibition | Source |
| - | - |
| Write any row for a non-publishing outcome | FR-014, Principle V |
| Consume the ask outside the publishing statement | FR-016 |
| Consume an ask on a withheld, failed, deadline-expired, rate-limited or abandoned submission | FR-017, FR-018 |
| Consume more than one ask per published question | FR-019 |
| Accept an eligibility claim from the client | FR-004 |
| Create a participant | 001 owns identity |
| Persist the recording, or any part of it, anywhere | Principle IV |
| Return a model-generated string | 002 FR-027 |
| Trust the client's duration without re-checking it | FR-006a |
| Write, read, or reintroduce a closure status | FR-023a |
