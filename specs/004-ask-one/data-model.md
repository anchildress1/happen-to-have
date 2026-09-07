# Data Model: Ask One

**Feature**: 004-ask-one · **Date**: 2026-09-06

Two tables are touched and neither is new. This is the first migration in the project that
**removes** something, and the removal is the interesting part.

Nothing is deployed — no production database exists, and the only live data is seed rows on a
per-branch Neon database that `make db-up && make migrate && make seed` rebuilds. So there is
no backfill to invent and no legacy shape to preserve. Where a column is nullable below, it is
nullable because the value genuinely does not exist for some rows, never because old rows
predate it.

---

## `questions`

| Column | Type | Added by | Notes |
| - | - | - | - |
| `id` | `uuid` | 001 | |
| `participant_id` | `uuid NULL` | 001 | NULL marks a seeded question — it belongs to no participant |
| `display_text` | `text NOT NULL` 1–2000 | 001 | the reviewed text, from 002's content call |
| `source_language` | `text NOT NULL` default `'en'` | 001 | as detected (002 FR-010) |
| `created_at` | `timestamptz NOT NULL` | 001 | publication time; there is no other timestamp because there is no other state |
| `duration_seconds` | `smallint NULL`, 1–60 when present | **004** | FR-006a |
| `submission_id` | `uuid NULL UNIQUE` | **004** | FR-014a |
| ~~`status`~~ | ~~`question_status NOT NULL`~~ | ~~001~~ | **dropped** |

### What is removed, and why that is the point

`status`, the `questions_status_idx` index, and the `question_status` enum type all go.

001 created them with the comment *"status is written only by 004; this feature reads it."*
004 is here, and [FR-023a](spec.md) says it will never write it: closure is derived from
published answers ([research D3](research.md)). A column whose only stated purpose is a write
that will not happen is worse than absent — 001's own comment reads as a promise, and the next
person to touch the selection query has a `status` field and an index inviting them to use it.

The application-side removals travel with it:

| Where | Change |
| - | - |
| `src/schema/rows.ts` | `questionRowSchema` loses `status`; `questionStatusSchema` is deleted |
| `src/db/queries/questions.ts` | `WHERE q.status = 'open'` becomes `HAVING COUNT(a.id) < 3` |
| `tests/unit/rows.test.ts` | the enum assertions go with the enum |
| `tests/integration/empty-pool.test.ts`, `exclusions.test.ts` | helpers take `status: 'closed'` to fake a closed question; they insert three answers instead, which is what closed now means |
| `seed/seed.ts` | `UPSERT_QUESTION_SQL` names `status` in its column list, its `VALUES`, and its `ON CONFLICT` SET |
| `tests/integration/skip-writes-nothing.test.ts` | the shared two-question fixture inserts `status` |
| `tests/integration/selection-bias.test.ts` | both question fixtures insert `status` |

The list is the whole set, verified by grep on the branch rather than remembered — an earlier
draft of this table stopped after the first four rows and missed three files that would have
failed on the next `make test`.

`seed/seed.ts` is the one that fails twice. It is not just another reader: the seeder is half of
`make db-up && make migrate && make seed`, the branch-database rebuild this document opens by
prescribing. Dropped column, unchanged seeder, and the escape hatch fails on the migration it
exists to recover from — so the seeder change ships in the same commit as the migration.

The `empty-pool` and `exclusions` helpers are the reason this is a migration and not a delete.
They currently prove that closed questions are excluded by setting a flag no production code
sets — a test asserting a mechanism rather than a behaviour. After the change they close a
question the only way the product can.

### What is added

**`duration_seconds smallint NULL`, CHECK 1–60 when present.** FR-006a requires the server to
refuse a question over the ceiling, and the CHECK is where that cannot be skipped. `smallint`
with a CHECK rather than an `interval`, for 003's reason: the product allows one to sixty, and
a type that can hold three hours needs the same CHECK anyway.

**It is nullable because seeded questions have no duration.** The six rows in
`seed/questions.json` were never recorded by anyone — they are text Ashley selected. There is
no number to put there that is not a claim about a recording that does not exist. Every
participant-authored question supplies one: the route rejects a missing or out-of-range value
before review, and `publishQuestion`'s typed input requires it.

**`submission_id uuid NULL UNIQUE`.** FR-014a, and the same mechanism as
[003's D4](../003-answer-and-unlock/research.md) — with a worse failure to prevent
([research D2](research.md)).

**Nullable for the same reason, and Postgres makes it work.** A `UNIQUE` constraint permits
many NULLs, so every seeded question can carry none while participant-authored ones stay unique
against each other. 003 had to add its column `NOT NULL DEFAULT gen_random_uuid()` and then drop
the default, because a bare `NOT NULL` fails on a table with rows and a generated id would make
the retry lookup match nothing. Here the honest shape and the workable one are the same: a
seeded question has no recording attempt, so it has no submission id.

**Uniqueness is across the table, not per participant.** The id names one recording attempt;
reusing another's would be claiming their submission.

### Constraints

| Constraint | Rule | Why in the schema |
| - | - | - |
| `CHECK (char_length(display_text) BETWEEN 1 AND 2000)` | 001 | matches 002's content schema cap, so an over-long transcript fails validation as a retryable fault rather than dying here *after* the ask has been consumed |
| `CHECK (duration_seconds IS NULL OR duration_seconds BETWEEN 1 AND 60)` | 004 | FR-006a, enforced where a crafted request cannot skip it |
| `UNIQUE (submission_id)` | 004 | makes a retried upload idempotent rather than merely non-corrupting |

### What is deliberately not here

- **No closure column, flag, count, or timestamp.** FR-023a. Closure is `COUNT(a.id) < 3` at
  selection time, served by 001's `answers_question_id_idx`, which was created for exactly this.
- **No status of any kind.** Withheld, failed, rate-limited and abandoned submissions write
  nothing at all (Principle V, FR-014). The row's existence *is* publication, as it is for
  `answers`.
- **No `emotion`.** 002 returns an emotional direction for every contribution. Nothing in the
  product reads one for a question — 005 renders answers — so storing it would be a column with
  no reader.
- **No `answer_count`.** A denormalized counter is the drift 001's index comment already
  refused, and it would make FR-023 an invariant to maintain rather than a query to run.
- **No `closed_at`, no `reopened_at`.** Reopening is Out of Scope, and closure has no moment —
  it is a property of the answer rows, true whenever they number three.
- **No audio, no object key.** Principle IV.

---

## `participants.can_ask`

Unchanged from 001. 003 is the only feature that sets it true; **004 is the only one that sets
it false.**

A boolean, deliberately, not a counter or a ledger ([003's D1](../003-answer-and-unlock/research.md)).

Consumption is a predicate, and its position in the statement is the concurrency control
([research D1](research.md)):

```sql
WITH consumed AS (
  UPDATE participants SET can_ask = false
   WHERE id = $1 AND can_ask = true
  RETURNING id
),
published AS (
  INSERT INTO questions (...) SELECT c.id, … FROM consumed c RETURNING id
)
```

`AND can_ask = true` is FR-002 and FR-019 in one clause. Two concurrent statements serialize on
the row lock: the second finds the flag already false, returns no row, and its insert selects
from an empty CTE. No ask, no question.

**The consume precedes the insert, and the asymmetry with 003 is intentional.** 003 inserts
first and grants second, because granting is idempotent — two answers both setting `can_ask =
true` produce the state the product wants. Consuming is not. Inserting first would let two
requests both write a question and then argue over one flag.

---

## Request-scoped shapes

Neither is serialized. Contract in [contracts/ask-api.md](contracts/ask-api.md).

### `QuestionSubmission`

What the endpoint receives. Everything except the audio is a claim.

| Field | Type | Trusted? |
| - | - | - |
| `audio` | `Blob` | the only thing that is |
| `submissionId` | `uuid` | no, but uniqueness makes forgery self-defeating |
| `durationSeconds` | `number` | no — re-checked before review (FR-006a) |

**There is no `questionId` and no `questionText`.** This flow creates a question rather than
answering one, and relevance is not evaluated for a question (002 FR-003), so there is nothing
to judge it against.

**There is no eligibility field, and there must never be one.** FR-004 makes client-supplied
eligibility advisory; the server reads `participants.can_ask` and the statement enforces it
again.

### `QuestionOutcome`

What the endpoint returns and the page renders. A discriminated union, so a caller cannot read
a published question's id off a rejection.

| Variant | Fields | Renders |
| - | - | - |
| `published` | — | FR-015a's confirmation |
| `withheld` | `reason`, plus `contentReason` when `reason` is `content` | 002's Withheld or crisis page, question variant |
| `rate_limited` | `retryAt` | 002's limit page |
| `failed` | `cause` | processing failure, question variant |
| `spent` | — | the ask-already-spent state ([research D6](research.md)) |

**`published` carries no question id.** Nothing on the confirmation screen shows the question
back — its primary action returns to `/answer` and its ghost goes to `/yours`, where 005 lists
it. Returning an id the page does not use would be inviting a deep link this feature does not
build.

**`spent` is not `failed`.** The processing-failure helper says *you can record again*, which
is false once the ask is gone. The two states exist because they have two different next
actions, and only one of them is possible.
