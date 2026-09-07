# Research: Ask One

**Feature**: 004-ask-one · **Date**: 2026-09-06

Only decisions that change the build. Where something was read out of the running code, the
file is named; where it was reasoned, the reasoning says so.

---

## D1 — Consume first, insert second, one statement

**Decision**: `publishQuestion` is a single `WITH` statement whose first CTE consumes the ask
and whose insert selects from it.

```sql
WITH consumed AS (
  UPDATE participants SET can_ask = false
   WHERE id = $1 AND can_ask = true
  RETURNING id
),
published AS (
  INSERT INTO questions (participant_id, display_text, source_language,
                         duration_seconds, submission_id)
  SELECT c.id, $2, $3, $4, $5 FROM consumed c
  RETURNING id
)
SELECT (SELECT id FROM published) AS question_id
```

**Rationale**: FR-019 requires exactly one ask consumed per published question under concurrent
submission, and FR-014 requires the two to commit together. The order is what makes both true.

`UPDATE … WHERE can_ask = true` takes a row lock. Two concurrent statements serialize on it:
the first flips the flag and returns a row, the second finds `can_ask = false`, returns none,
and its insert selects from an empty CTE and writes nothing. **The guard is the concurrency
control.** No advisory lock, no serializable transaction, no application-level check.

Reversing the order breaks it. `INSERT … RETURNING`, then `UPDATE … WHERE EXISTS (published)`
— 003's shape — works for a *grant* because granting is idempotent: two answers both setting
`can_ask = true` produce the state the product wants. Consumption is not idempotent. Two
requests would both insert, and one ask would buy two questions.

**Alternatives considered**:

- *003's grant shape, inverted* — the symmetry is inviting and wrong, for the reason above.
- *`SELECT can_ask` then insert then update* — three statements, two windows, and the read is
  true only until the other tab's update lands.
- *A serializable transaction* — correct, and it buys nothing the row lock already gives, at
  the cost of retry handling on a path that must not fail noisily.

**Read out of the code**: `PUBLISH_ANSWER_SQL` in `src/db/queries/answers.ts` is the shape this
deliberately does *not* copy.

---

## D2 — A lost response on a question is worse than on an answer

**Decision**: `questions.submission_id uuid NOT NULL UNIQUE`, checked before review, replayed
when it already exists. Same mechanism as 003's [D4](../003-answer-and-unlock/research.md).

**Rationale**: 003 built this because a lost response left a participant told they had already
answered a question whose outcome they never saw. The question-side failure is strictly worse.

The sequence: the question publishes, the response is lost, the participant re-records. Their
ask is now spent. Without a submission id the retry hits D1's guard, finds `can_ask = false`,
and is refused — so they are told they cannot ask, while their question is sitting in the pool
collecting answers they were never shown. **They lost the ask and never saw what it bought.**

With the id, the retry finds its own row and replays `published`.

**Uniqueness is across the table, not per participant**, for the same reason as 003: the id
names one recording attempt, and reusing another's would be claiming their submission.

**The client rotates it per recording, not per page load.** 003 shipped this bug and fixed it —
a re-record after a Withheld reused the id, so the server replayed the first submission instead
of reviewing the new one, making FR-021's retry silently a no-op. `AskQuestion` mints a fresh
id inside `startRecording`, copying `RecordAnswer` exactly.

**Alternatives considered**:

- *The ask guard alone* — it makes double-publication impossible and the lost-response case
  unrecoverable. Those are different properties.
- *An idempotency-key table with a TTL* — the general solution, plus a table and a sweep, for
  something one unique column on a row that already exists provides.

---

## D3 — Closure is read, never written

**Decision**: `listEligibleQuestions` gains `HAVING COUNT(a.id) < 3` and loses
`WHERE q.status = 'open'`. The `status` column, its index, and the `question_status` enum are
dropped.

**Rationale**: the question already carries its answers. Closure is a fact about them, so it is
read from them.

A stored status would have to be written from inside `PUBLISH_ANSWER_SQL` — 003's shipped
statement — at the moment an insert makes the third answer. That is a denormalized copy of a
count the same statement just changed, in a feature that does not own the statement, and it can
disagree with the rows it summarizes. It also creates a race this design does not have: a
fourth answer landing beside the third has to be reconciled against a flag, where here it
simply is or is not the fourth row when the next selection runs.

**The count is already indexed.** 001 created `answers_question_id_idx` with a comment saying
it carries `COUNT(*) per question for the fewer-answers bias and 004's three-answer closure
rule, so neither ever needs a denormalized, driftable counter`. The index was built for this.

**The `LEFT JOIN` counts correctly.** `COUNT(a.id)` ignores the NULL row a question with no
answers produces, so an unanswered question counts 0 and passes the `HAVING`, satisfying
FR-022. `COUNT(*)` would count 1 and close nothing — a distinction worth a test rather than a
comment.

**Three answers is three participants at the schema level.** `UNIQUE (participant_id,
question_id)` on `answers` (001) makes a second published answer from one participant
unrepresentable, so `COUNT(a.id) = 3` *is* three distinct participants. FR-024 says so and
forbids re-deriving it; a `COUNT(DISTINCT a.participant_id)` here would be a slower way to
compute the same number while implying the constraint might not hold.

**Cost paid**: the routing query aggregates on every selection rather than filtering on a
boolean index. At weekend-demo scale — six seeded questions and whatever the day produces —
this is unmeasurable. At a scale where it matters, the fix is a materialized count with a
trigger, which is the thing FR-023a forbids building before it is needed.

**Alternatives considered**:

- *Flip `status` inside `PUBLISH_ANSWER_SQL`* — uses the shipped column as designed, and
  denormalizes a relational fact into a field that can lie.
- *A scheduled job that closes questions* — a second source of truth plus a scheduler, for a
  rule that is one clause.
- *Keep `status` for a future manual close* — no requirement asks for it. Out of Scope names
  reopening and threshold adjustment explicitly.

---

## D4 — The endpoint is `POST /api/ask`

**Decision**: question submission is `POST /api/ask`, not `POST /api/question`.

**Rationale**: `POST /api/question` already exists and does the opposite thing. It is 001's
*selection* endpoint — it hands the caller a question to answer. A submit endpoint at the same
path would be two opposite operations behind one name, distinguished by nothing a reader sees.

`/api/ask` matches the route it serves and the verb the product uses.

**Alternatives considered**:

- *`POST /api/question` with a discriminator field* — one path, two meanings, decided by a body
  field. The kind of overloading that survives review and then confuses everyone.
- *Rename 001's endpoint to `/api/selection`* — correct-er, and a change to a shipped route for
  a naming preference in a different feature.

---

## D5 — One outcome view, parameterized by kind

**Decision**: `src/ui/AnswerOutcome.tsx` becomes `src/ui/ContributionOutcome.tsx`, taking
`kind: 'answer' | 'question'` and the retry destination.

**Rationale**: it already renders both flows. `src/copy.ts` has carried `ghostAnswer` /
`ghostQuestion`, `actionAnswer` / `actionQuestion` and `headingAnswer` / `headingQuestion`
since 002 — the copy contract was written for two flows and only one of them was built.

The Withheld, crisis, rate-limited and processing-failure pages are structurally identical
between flows. What differs is two strings and three destinations, all of which the copy object
already keys by kind. Copying the component would duplicate ninety lines whose only variation
is data, and split the crisis page — the one screen that must never drift — across two files.

**Alternatives considered**:

- *A separate `QuestionOutcome.tsx`* — no shared abstraction to get wrong, and two places to
  fix the next crisis-copy change.
- *Leave the file name and add the prop* — the smaller diff, and it leaves a component named
  for answers rendering questions, which every future reader has to check.

---

## D6 — A spent ask is not a processing failure

**Decision**: when the publish statement writes nothing and no matching submission exists, the
endpoint returns `{ status: 'spent' }` and the page renders its own state.

**Rationale**: this is the two-tab case. Tab A published; tab B recorded afterwards and
submitted. The ask is gone, the recording is gone, and there is a real question in the pool.

003's equivalent is `ineligible`, which renders the processing-failure page. Its helper says
*Your recording was discarded. You can record again.* For an answer both halves are true. For a
question the first is true and the second is a lie: recording again produces the same refusal,
because the ask is spent and only a new qualifying answer brings it back.

**It is distinguished from a replay, not guessed at.** The route re-reads
`findQuestionBySubmission` after the failed insert, exactly as 003's route does before calling
something ineligible. A submission that won under another request replays `published`; only a
genuinely different attempt reaches `spent`. Without that re-read, the winner of a same-id race
is told their question was refused when it was published.

**Alternatives considered**:

- *Reuse `ineligible` and its page* — one fewer copy block, and it instructs the participant to
  do something the server will refuse.
- *Show the published confirmation for whatever question they now have* — it is a different
  recording. Presenting one submission's outcome as another's is the same class of lie.

---

## Not researched, deliberately

| Question | Why not |
| - | - |
| Whether questions should store `emotion` | Nothing reads it for a question. 002 returns it; 004 drops it, per the spec's Assumptions. Adding a column for a value with no reader is the shape Principle VI forbids. |
| Bytes-per-second bounds on question audio | Identical to 003's open gap ([D3](../003-answer-and-unlock/research.md)), inherited unchanged. Measuring it once covers both flows. |
| Whether closure should be configurable | Out of Scope names it. Three is the handoff's number and the constitution's. |
