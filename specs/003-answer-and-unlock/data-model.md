# Data Model: Answer One

**Feature**: 003-answer-and-unlock · **Date**: 2026-09-06

Two tables are touched and neither is new. What matters here is mostly what is deliberately
absent.

---

## `answers`

001 created this table as existence-only: the row's presence **is** publication, which is why
it has no status, attempt, error or processing column. That has not changed. 003 adds what a
reader needs and what the rules require.

| Column | Type | Added by | Notes |
| - | - | - | - |
| `id` | `uuid` | 001 | |
| `question_id` | `uuid NOT NULL` | 001 | |
| `participant_id` | `uuid NOT NULL` | 001 | |
| `created_at` | `timestamptz NOT NULL` | 001 | publication time; there is no other timestamp because there is no other state |
| `display_text` | `text NOT NULL` 1–2000 | 003 | the reviewed text, from 002's content call |
| `source_language` | `text NOT NULL` default `'en'` | 003 | as detected (002 FR-010) |
| `emotion` | `text NULL` | 003 | **nullable, never defaulted** |
| `duration_seconds` | `smallint NULL`, 1–60 when present | 003 | FR-013 |
| `submission_id` | `uuid NOT NULL UNIQUE` | 003 | FR-015, SC-007 |

**`emotion` is nullable and has no default.** 002's FR-017 requires recording that *no*
direction was detectable, and a default makes "none found" indistinguishable from "never
asked". 002's schema already normalizes blank to null so absence cannot arrive looking like a
value.

**`display_text` is bounded 1–2000, matching `questions.display_text`.** Same bound in both
places on purpose: 002's content schema caps at 2000, so an over-long transcript fails
validation as a retryable fault rather than reaching here and dying on a constraint *after* the
ask has been granted.

**`duration_seconds` is nullable, and that is the honest shape.** Rows published before 003
have no recorded duration, and there is no value to backfill them with that is not a
fabrication — 1 and 60 are both claims about how long somebody spoke. `display_text` can take a
marker string saying what happened; a smallint cannot. NULL means *predates the column*, never
*unmeasured going forward*: the route rejects a missing or out-of-range duration before review,
and a supplied value is still bounded, which a test asserts so nullable cannot quietly become
unbounded.

**It is a `smallint` with a CHECK, not an `interval`.** The product allows one to
sixty; a type that can hold three hours would need the same CHECK anyway and would invite
storing something the product cannot render.

**`submission_id` is unique across the table, not per participant.** It identifies one recording
attempt, and a client that reused another's id would be claiming their submission. Uniqueness
is the whole mechanism.

### Constraints

| Constraint | Rule | Why in the schema |
| - | - | - |
| `UNIQUE (participant_id, question_id)` | 001 | One published answer per participant per question. The backstop for the race `NOT EXISTS` cannot close alone. |
| `UNIQUE (submission_id)` | 003 | Makes a retried upload idempotent rather than merely non-corrupting ([research D4](research.md)). |
| `CHECK (char_length(display_text) BETWEEN 1 AND 2000)` | 003 | |
| `CHECK (duration_seconds IS NULL OR … BETWEEN 1 AND 60)` | 003 | FR-013, enforced where it cannot be skipped |

### What is not here

- **No status column.** Withheld, failed and abandoned submissions write nothing at all
  (Principle V, FR-019). That absence is what makes FR-027's "a withheld attempt leaves the
  question eligible" true with no reconciliation.
- **No attempt count, no error, no retry-at.** 002 retries inside the active submission and
  keeps nothing afterwards.
- **No audio, no object key, no duration-of-original.** Principle IV.
- **No `updated_at`.** A published answer is never edited (Out of Scope), so a column tracking
  edits would only ever hold a copy of `created_at`.

---

## `participants.can_ask`

Unchanged from 001. 003 is the only feature that sets it true; 004 is the only one that sets it
false.

**A boolean, deliberately, not a counter or a ledger** ([research D1](research.md)). FR-023
caps unspent asks at one, and a column that holds exactly the two states the product allows
cannot drift into a third.

The grant is a predicate rather than a read-modify-write:

```sql
UPDATE participants SET can_ask = true
 WHERE id = $2 AND EXISTS (SELECT 1 FROM published) AND can_ask = false
```

`AND can_ask = false` is FR-021: a passing answer from someone already holding an ask publishes
normally and grants nothing. Without it, the `RETURNING` would report a grant that changed
nothing, and the participant would be told they earned an ask they already had.

---

## Request-scoped shapes

Neither is serialized.

### `AnswerSubmission`

What the endpoint receives. Everything except the audio is a claim.

| Field | Type | Trusted? |
| - | - | - |
| `audio` | `Blob` | the only thing that is |
| `questionId` | `uuid` | no — the server reads the question's text itself (FR-018) |
| `submissionId` | `uuid` | no, but uniqueness makes forgery self-defeating |
| `durationSeconds` | `number` | no — re-checked ([research D3](research.md)) |

**`questionText` is never accepted from the client.** A client-supplied question would let
anyone have any recording judged for relevance against a question of their choosing, which
turns the relevance check into a formality.

### `AnswerOutcome`

What the endpoint returns and the page renders. A discriminated union so a caller cannot read
`askGranted` off a rejection.

| Variant | Fields | Renders |
| - | - | - |
| `published` | `askGranted: boolean` | FR-020's fixed line |
| `withheld` | `reason`, plus `contentReason` when `reason` is `content` | 002's Withheld or crisis page |
| `rate_limited` | `retryAt` | 002's limit page |
| `failed` | `cause` | processing failure |
| `ineligible` | — | processing failure, **not** Withheld |

**`ineligible` renders the failure page on purpose.** It means a rule refused after review
passed — a second answer that arrived while the first was still being checked. That is this
system's race, not something the participant did to their recording, and borrowing the Withheld
copy would tell them their answer was rejected on its merits.
