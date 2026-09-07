# Data Model: Yours and Playback

Two columns, on one table. No new table, no new index, and — the part worth arguing about —
nothing added to `questions`.

`specs/005-yours-and-playback/plan.md` is the authoritative design; this file is the
authoritative column list, the way 001's and 004's data models are for theirs.

---

## What changes

### `answers` — two columns added

| Column | Type | Null? | Default | Meaning |
| - | - | - | - | - |
| `generated_audio` | `bytea` | **YES** | none | The finished WAV. NULL means playback has never been produced for this answer. |
| `audio_voice_id` | `text` | **YES** | none | The prebuilt voice that produced it. NULL exactly when `generated_audio` is NULL. |

Migration: `migrations/1788740000000_answer-playback.sql`.

### `questions` — nothing

Deliberate. See [Why `questions` gets nothing](#why-questions-gets-nothing).

### Everything else — nothing

No table is added, so `tests/helpers/pglite.ts`'s `TRUNCATE` list is unchanged. No index is
added, because nothing queries *by* audio — every read of these columns is already keyed by
`answers.id`, which is the primary key.

---

## Why NULL is the honest default, and not merely convenient

`generated_audio IS NULL` is not a placeholder standing in for "not yet". It **is** the
feature's central assertion, stored.

- **FR-026** requires production to be lazy, on the first `Listen`.
- **FR-030** requires the text to be readable before any audio exists.
- **SC-003** requires *zero* audio produced for contributions nobody requested, "verified by
  counting productions against `Listen` requests."

A NULL column makes SC-003 a query rather than an inference:

```sql
SELECT count(*) FROM answers WHERE generated_audio IS NOT NULL;
```

Compare that number to the number of `Listen` requests and the criterion is proved directly. Any
design that pre-created a row, a marker, or a zero-length blob at publication time would have to
prove the same thing by reasoning about what the marker meant. This one cannot be misread.

It also means **publication writes no audio and cannot**, which is FR-029 enforced by the shape
of the table rather than by a promise in a route handler.

### The two columns are NULL together, always

`audio_voice_id` is NULL exactly when `generated_audio` is. They are written in the same
`UPDATE` and never independently. This is not enforced by a `CHECK` constraint, and the reason is
worth stating: the only writer is a single statement in `src/db/queries/answers.ts` that sets
both. A constraint here would guard against a second writer that does not exist and that this
design has no place to put.

---

## Why `bytea` and not a storage key

Full reasoning in [research D1](research.md). The short version, since this is the column list:

- The handoff names `generated_audio_storage_key`, which reads as a GCS object.
- This repository has no GCS integration and has spent four features not needing one — original
  audio lives in the browser and in one request body, never in storage.
- Standing up a bucket costs a dependency, a bucket, an IAM binding, a lifecycle rule and a local
  credential path, to hold a file a column holds.
- **Size**: Gemini TTS returns 24 kHz 16-bit mono PCM at 48 kB/s. The 60-second recording ceiling
  and the 2000-character `display_text` bound put playback around 60–90 seconds and 3–4 MB.
  Postgres TOASTs it out of line without comment; the field limit is 1 GB.
- It keeps the cache path testable. The integration suite runs PGlite and has no bucket, so a
  storage key would make produce-once provable only by hand.

The name changes with the mechanism: `generated_audio`, because it holds audio rather than a key
to audio. `audio_voice_id` keeps the handoff's name, because it still means what the handoff
said it means.

---

## Why `questions` gets nothing

The handoff lists both audio columns on `questions` as well. This feature adds neither, and the
precedent for refusing is in this repository already.

- **FR-014 puts `Listen` on responses.** Responses are `answers` rows. Nothing in this spec
  renders a `Listen` on a question.
- The handoff's optional question playback (its §5, "Optionally play the question") was not built
  by 004 and is not in 005's scope.
- 004 **dropped** `questions.status` for exactly this shape — a column added because a future
  feature was expected to write it, which nothing ever did. That migration's own comment: a
  column whose sole stated purpose is a write that will not happen "is worse than absent," because
  the next reader finds the field and wires something to it.

Adding these columns now would repeat the mistake that migration exists to undo, one migration
after it landed. When question playback is built, it brings its own migration.

---

## Reads

Three statements serve the whole screen. None of them selects `generated_audio` — the page never
ships audio bytes into a render.

### 1. `Your Answers` — `listPublishedAnswers(participantId)`

One join. Every answer the participant published, with the question it addressed (FR-004, FR-005,
FR-007).

```sql
SELECT a.id, a.display_text, a.created_at, q.display_text AS question_text
  FROM answers a
  JOIN questions q ON q.id = a.question_id
 WHERE a.participant_id = $1
 ORDER BY a.created_at DESC, a.id DESC
```

- **Only published answers exist**, so no status predicate is possible or needed (FR-008). The
  row's existence *is* publication — 001's schema comment, still true.
- Newest first here. This is the participant's own history, where recency is the useful order and
  no ranking question arises — nobody ranks their own contributions against each other.

### 2. `Your Questions` — `listPublishedQuestions(participantId)`

```sql
SELECT q.id, q.display_text, q.created_at
  FROM questions q
 WHERE q.participant_id = $1
 ORDER BY q.created_at DESC, q.id DESC
```

Seeded questions carry `participant_id IS NULL` and are excluded by the equality — correctly, and
this is the one place in the codebase where plain `=` is right where `IS DISTINCT FROM` is used
elsewhere. The selection queries want to *include* seeded rows; this one wants to exclude them,
and no participant id is NULL.

That is also the whole of the spec's "seeded question receives answers" edge case: a seed
identity has no session, so no `Yours` exists for it.

### 3. Responses — `listResponsesForQuestions(questionIds)`

```sql
SELECT a.id, a.question_id, a.display_text, a.created_at,
       (a.generated_audio IS NOT NULL) AS has_playback
  FROM answers a
 WHERE a.question_id = ANY($1::uuid[])
 ORDER BY a.created_at ASC, a.id ASC
```

- **`ANY($1::uuid[])` over the whole id set, not per question.** Two statements total, and the
  count does not grow with the number of questions.
- **`ORDER BY a.created_at ASC` is chronology and carries no quality signal** (FR-018, [research
  D8](research.md)). This ordering is forbidden from becoming a ranking; the comment in the query
  says so, because no test can catch a sort key that looks defensible.
- **`has_playback` is a boolean, never the bytes.** The screen has no use for the audio until
  someone presses `Listen`, and selecting 3–4 MB per response into a server render to answer a
  yes/no question would put the entire cache on the critical path SC-001 budgets at two seconds.
- Grouping into questions happens in TypeScript ([research D7](research.md)), so every row
  validates against a flat schema in `src/schema/rows.ts` rather than a JSON shape the database
  invented.

**FR-012's response count is the length of the grouped list.** That is the relational `COUNT` the
constitution requires, reached by counting the rows being rendered — the one count that cannot
drift from what the participant sees, because it *is* what the participant sees.

---

## Writes

Two, both in the playback path. Nothing on the render path writes anything.

### `authorizePlayback(answerId, participantId)`

```sql
SELECT a.display_text, a.generated_audio IS NOT NULL AS cached
  FROM answers a
  JOIN questions q ON q.id = a.question_id
 WHERE a.id = $1
   AND (a.participant_id = $2 OR q.participant_id = $2)
```

One predicate covering both ways an answer belongs to the requester: they wrote it, or they asked
the question it answers (FR-002, [research D5](research.md)). No row means *not found* to the
caller — never a distinct "forbidden", which would confirm that someone else's answer exists.

**`display_text` comes from this row and never from the request body.** A client-supplied text
would let anyone have arbitrary text voiced at the product's expense.

### `claimPlayback(answerId, wav, voiceId)`

```sql
UPDATE answers
   SET generated_audio = $2, audio_voice_id = $3
 WHERE id = $1
   AND generated_audio IS NULL
RETURNING id
```

The `IS NULL` guard is the produce-once storage guarantee (FR-027, FR-028, SC-004, SC-005). Zero
rows returned means another request won the race; the caller re-reads and serves the winner's
audio rather than overwriting it.

**Why this and not a lock or a pending row** — [research D2](research.md). A pending row would be
processing state in the database, which Principle V forbids in those words, and it strands a claim
when a producer crashes. An advisory lock held across the TTS call would pin connections from a
pool capped at `max: 4` for the several seconds Gemini takes.

The accepted window: two Cloud Run instances can both *produce* before either writes. Exactly one
row results either way. That is a duplicate spend of a fraction of a cent, and it is close to
unreachable because `Yours` is scoped to one participant's session — concurrent first requests are
one person double-tapping in one browser.

---

## What this model deliberately cannot represent

Each of these is a spec requirement that the absence of a column enforces, rather than code.

| Absent | Enforces |
| - | - |
| Any column on `answers` or `questions` holding original recording bytes, a key, or a URL | FR-022, FR-024, Principle IV. Nothing to serve means no route can serve it. |
| A pending / producing / failed playback state | FR-021, Principle V. NULL means "never produced", and there is no third value. |
| A score, rank, vote, rating, reaction, or best-answer column | FR-018, FR-019, FR-020, SC-008. Ordering is `created_at` and there is nothing else to order by. |
| A `responses_count` counter on `questions` | The constitution forbids denormalized answer counts outright. The count is the length of the list. |
| A retry counter or attempt log on playback | A failed production leaves the column NULL, which is the same state as never having tried. Retry is a second request, not a stored fact. |
| Any row for a withheld, failed, pending, or abandoned contribution | FR-008, FR-021, Principle V. Still true from 001; this feature adds no way to change it. |
