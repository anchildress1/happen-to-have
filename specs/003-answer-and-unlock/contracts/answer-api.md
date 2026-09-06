# Contract: `POST /api/answer`

**Feature**: 003-answer-and-unlock · **Date**: 2026-09-06

The one endpoint. Audio in, one terminal outcome out. Shapes in
[data-model.md](../data-model.md); this defines behaviour.

---

## Request

`multipart/form-data`, because the audio is a file and the rest is metadata.

| Field | Type | Required | Notes |
| - | - | - | - |
| `audio` | file | yes | as recorded; the browser's own mime type, codec parameters intact |
| `questionId` | uuid | yes | which question this answers |
| `submissionId` | uuid | yes | one per recording attempt, not per request (FR-015) |
| `durationSeconds` | integer | yes | a claim, re-checked ([research D3](../research.md)) |

Identity comes from the session cookie. **The endpoint never mints a participant** — 001 owns
that, and creating one here would let an unauthenticated flood write rows.

**`questionText` is not a field and MUST NOT become one.** The server reads the question's text
from the database (FR-018). Accepting it would let anyone have any recording judged for
relevance against a question of their choosing.

---

## Order of operations

1. **Session.** No participant id → `401`. Nothing is created.
2. **Shape.** Missing or malformed fields → `withheld / content / unintelligible`. A malformed
   request is indistinguishable from an unusable recording *from the participant's side*, and
   both mean record again.
3. **Idempotency.** A `submissionId` already on an answer row returns **that answer's original
   outcome**, without re-reviewing. This is the retried-upload case (SC-007).
4. **Cheap bounds.** Size ceiling and the declared duration, before any provider call.
5. **Question.** Read its text. Unknown → `failed`; the interface offered something that no
   longer exists, which is not the participant's doing.
6. **Review.** `reviewContribution()`. Anything but `publish` returns here, having written
   nothing.
7. **Publish.** The one statement: insert, grant, report.

**Review runs before anything is persisted, and that ordering is the design.** A withheld or
failed attempt must leave nothing behind — there is no status column to reconcile afterwards,
deliberately — and that absence is what makes FR-027's "a withheld attempt leaves the question
eligible" true with no bookkeeping.

---

## Responses

All outcomes are `200` unless noted. The status code reports whether the *request* was handled,
not whether the answer was liked; a withheld answer is a successful review with a negative
verdict, and a `4xx` there would make it look like a client error to every log and retry
heuristic in the stack.

| Body | HTTP | When |
| - | - | - |
| `{ status: 'published', askGranted }` | 200 | review passed and the row landed |
| `{ status: 'withheld', reason, contentReason? }` | 200 | any refusal from 002 |
| `{ status: 'rate_limited', retryAt }` | 200 | FR-048 |
| `{ status: 'failed', cause }` | 200 | retries exhausted, deadline, or an unknown question |
| `{ status: 'ineligible' }` | 200 | review passed, a rule refused |
| — | 401 | no session |
| — | 499 | the caller aborted; nothing written, nobody left to render for |

**`askGranted` is false on a passing answer from someone already holding an ask.** FR-021. The
copy distinguishes the two cases, because telling someone they earned an ask when nothing
changed is the kind of small lie that makes the reciprocity rule untrustworthy.

**`ineligible` is not a Withheld.** It means a second answer arrived while the first was in
review. This system's race, so it renders the processing-failure page.

---

## What this endpoint must never do

| Prohibition | Source |
| - | - |
| Write any row for a non-publishing outcome | FR-019, Principle V |
| Grant an ask outside the publishing statement | FR-022 |
| Grant a second ask to a participant already holding one | FR-021, FR-023 |
| Accept `questionText`, or any eligibility claim, from the client | FR-018, FR-024 |
| Create a participant | 001 owns identity |
| Persist the recording, or any part of it, anywhere | Principle IV |
| Return a model-generated string | 002 FR-027 |
| Trust the client's duration without re-checking it | FR-013 |
