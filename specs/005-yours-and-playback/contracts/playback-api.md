# Contract: `POST /api/playback/answer/[id]`

**Feature**: 005-yours-and-playback · **Date**: 2026-09-07

One route. An answer id in, `audio/wav` bytes out. Column shapes in
[data-model.md](../data-model.md); the decisions behind this are
[D2](../research.md), [D5](../research.md), [D6](../research.md) and
[D9](../research.md). This defines behaviour.

Implemented at `app/api/playback/answer/[id]/route.ts`. `export const dynamic =
'force-dynamic'`, like every other route in this app — the response depends on the session
cookie and on a column that changes.

---

## Request

| Part | Value | Notes |
| - | - | - |
| Method | `POST` | see [Why POST](#why-post-and-not-get) |
| Path | `/api/playback/answer/{id}` | `{id}` is the **answer** row's uuid |
| Body | **none** | a body is not read, and a text body is forbidden |
| Identity | session cookie | `readParticipantId(request)`, as 003 and 004 do |

**There is no request body, and adding one is forbidden.** The text spoken comes from the
answer row's `display_text`. A client-supplied string would let anyone have arbitrary text
voiced at the product's expense, and it would break FR-024's guarantee that playback is
produced from published processed text and nothing else.

**There is no voice field.** One voice, product-wide (FR-025), from the single export in
`src/playback/voice.ts`.

---

## Order of operations

1. **Session.** No participant id → `401` `{ error: 'no-session' }`. No provider call, no read.
2. **Shape.** `[id]` is not a uuid → `404`. Not a `400`: see [404 for everything](#404-covers-unknown-malformed-and-not-yours).
3. **Authorize + read, one statement.** Fetch the answer only if the requester **authored it**
   *or* **owns the question it answers**. No row → `404`.
4. **Cache hit.** `generated_audio` is non-null → return those bytes. **No provider call.**
   This is the path every request after the first takes (FR-027, SC-004).
5. **Produce.** Null → `producePlayback(display_text)` in `src/playback`: coalesce in-process by
   answer id, call TTS, [validate](#what-is-validated-before-anything-is-cached), wrap as WAV.
6. **Claim.** `UPDATE answers SET generated_audio = $1, audio_voice_id = $2 WHERE id = $3 AND
   generated_audio IS NULL`.
7. **Lost the race.** 0 rows updated → another request already wrote. Re-read and serve **theirs**,
   discarding the bytes just produced.
8. **Respond.** `200`, `content-type: audio/wav`, `content-length` set.

Steps 3 and 4 are the whole of the common case. A `Listen` on an already-played response is one
`SELECT` and a byte copy.

---

## Responses

| Status | Content-Type | Body | When | Client behaviour |
| - | - | - | - | - |
| `200` | `audio/wav` | the audio | cache hit, or a fresh production that validated | plays it |
| `401` | `application/json` | `{ "error": "no-session" }` | no session cookie | nothing to play; `Yours` was never rendered for this caller |
| `404` | `application/json` | `{ "error": "not-found" }` | unknown id, malformed id, or not the requester's | no `Listen` was rendered for it; a crafted request gets nothing |
| `502` | `application/json` | `{ "error": "production-failed" }` | TTS faulted **this time** | text stays readable, **`Listen` offers RETRY** (FR-033) |
| `503` | `application/json` | `{ "error": "unavailable" }` | playback capability absent **entirely** | text stays readable, **`Listen` DEGRADES, no retry** (FR-034) |

Every non-200 body is JSON, including the 401. The client parses the error body unconditionally;
003 shipped a bodiless 401 there and fixed it.

Nothing is written on any non-200. A fault leaves `generated_audio` NULL, which is what makes
the retry in FR-033 a genuine retry rather than a second read of a broken artifact.

### `502` vs `503` is the entire difference between FR-033 and FR-034

They are not severity levels. They answer different questions, and the client does different
things with them.

| | `502 production-failed` | `503 unavailable` |
| - | - | - |
| Question answered | "did *this attempt* work?" | "does playback *exist* here?" |
| Cause | network error, timeout, aborted call, empty payload, wrong mime type, unparseable sample rate | no `GEMINI_API_KEY`, provider client cannot be constructed at all |
| Would retrying help? | **maybe** — the next call may succeed | **no** — every call will fail identically |
| Scope | this response, this moment | every response, every participant, until config changes |
| `Listen` renders as | error + **RETRY** | disabled / absent, with no error shouted at the participant |
| Requirement | FR-033 | FR-034, SC-011 |

Getting this backwards produces the two worst outcomes available: a retry button that can never
work (503 as 502), or a permanent capability outage presented as a transient hiccup nobody
retries (502 as 503).

**The check is made before the call, not from its exception.** Missing configuration is detected
when the provider client is constructed; that is `503`. Anything that goes wrong *after* a call
was actually attempted is `502`. A caught exception is never inspected for "does this look like
config" — that inference is how the two collapse into one.

**Neither one touches the text.** The page renders from SQL and never constructs a provider
client (FR-030, FR-034, SC-011). A total playback outage is invisible to `Your Answers` and
`Your Questions` except that one button is quiet.

### `404` covers unknown, malformed, and not-yours

`403` is never emitted. [D5](../research.md) sketched the failure column as "401 / 403 / 404";
this contract collapses that to `404` on purpose.

- A `403` on someone else's answer **confirms the row exists**. That hands an enumerator a
  working oracle over every answer id in the product, using only status codes.
- Under FR-002 the participant has no legitimate way to learn about a row that is not theirs.
  "Exists but forbidden" and "does not exist" are the same fact from where they stand.
- Authorization and existence are therefore one statement, not two. There is no branch that
  knows the row exists and then decides the caller cannot have it — the query simply returns
  nothing.

A malformed uuid is `404` for the same reason, and because `400` would only tell a crafted
request that its guess was the wrong *shape*.

---

## Why POST and not GET

`GET` was the first instinct: `<audio src="/api/playback/answer/{id}">` needs no JavaScript at
all. It loses on two counts ([D5](../research.md)).

| Objection | Weight |
| - | - |
| A first `GET` **produces audio** — a side effect on a method that should not have one | survivable; production is idempotent |
| FR-032 needs a loading state **scoped to that one response**, and FR-033 needs a retry for **the audio alone** | **decisive** |

Both of those require the client to *observe* the request — its start, its failure, its finish.
That means `fetch`, which means the `<audio src>` saving evaporates. Once the client is fetching
anyway, `POST` is the honest method for a call that may create a stored artifact.

## Why the body is audio, not a URL

Returning `{ "url": "…" }` would mean a second round trip to a second route that must
**re-authorize from scratch** — a duplicate copy of the one predicate in step 3, kept in sync by
nothing. The audio lives in a `bytea` column ([D1](../research.md)); there is no object store
and no signed URL to hand back. A URL would be a redirect to this same route wearing a hat.

---

## Produce-once

FR-028 and SC-005 require exactly one *production* for concurrent first requests — not merely one
stored artifact. Three mechanisms, one per failure mode:

| Mechanism | Covers |
| - | - |
| In-process coalescing by answer id | many concurrent requests **on one instance** → one TTS call, no database round trip |
| `pg_try_advisory_lock(hashtextextended($1, 0))` | **many instances** → one TTS call cluster-wide |
| `UPDATE … WHERE generated_audio IS NULL` | the storage guarantee underneath both → one artifact, always |

**The loser never produces.** It fails the lock, polls the row for the winner's bytes for up to
15 s, and serves those. On timeout it answers `502`, which is retryable — and by then the winner
has almost certainly stored its result, so the retry is a cache hit rather than a third call.

**`try`, never blocking.** `pg_advisory_lock` would make every waiter hold a pooled connection for
the whole TTS call, which is what the `max: 4` cap actually rules out. With try-and-poll only the
producer holds one, for a path that runs at most once per response, ever.

**No pending row, ever.** Claim-first-produce-second is the textbook single-flight and stays
forbidden: Principle V puts processing state out of the database, and a crashed producer leaves a
claim nobody clears. An advisory lock has no such failure mode — it is session state, not a row,
and Postgres frees it when the connection drops.

**An earlier revision documented cross-instance duplicate production as an accepted window.**
Review was right that the requirement says one production, not one artifact; the window was closed
rather than described. See [D2](../research.md).

---

## No rate limit

This route is **not** rate-limited, and adding one would limit a number the reciprocity gate has
already limited ([D9](../research.md)).

- A response exists only because someone earned an ask, spent it, and someone else answered.
- A question closes at three answers.
- Only the asker (or the answer's author) can request playback for it.
- Each response can be produced **at most once, ever** — the `IS NULL` guard makes every
  subsequent request a read.

Ceiling on TTS spend: **three productions per published question**, and questions are gated by
the one rule the product has.

**What would change this**: putting `Listen` on any surface not scoped to one participant's own
questions. Nothing in this feature does.

---

## What is validated before anything is cached

FR-023 and Principle V's TTS clause. TTS requests **no** structured output; the validation is on
the returned audio.

| Check | Rule | Failure |
| - | - | - |
| Mime type | must be **L16 PCM** (`audio/L16;codec=pcm;rate=…`) | `502`, nothing cached |
| Sample rate | **parsed out of the returned mime type**, never assumed | `502` if unparseable |
| Payload | must be **non-empty** | `502`, nothing cached |

**A rate assumed rather than read is the failure mode worth naming**: audio plays at the wrong
speed, and nothing errors. Hardcoding `24000` is forbidden even though that is what the model
returns today ([D6](../research.md)).

Validated bytes are wrapped in a 44-byte RIFF/WAVE header in application code — no browser plays
headerless L16 from an `<audio>` element. The header is written from the parsed rate, not from a
constant. Only the wrapped, validated WAV is stored.

A fault here is an **infrastructure failure, not a guardrail rejection**: retryable, never
presented to the participant as a judgement about their contribution.

---

## Caching headers

| Header | Set? | Why |
| - | - | - |
| `content-type: audio/wav` | **yes** | it is what the body is |
| `content-length` | **yes** | lets the browser show progress on a 3–4 MB body |
| `cache-control` | **no** | not set; the framework's `force-dynamic` default applies |
| `etag` / `last-modified` | **no** | nothing revalidates against them |
| `content-disposition` | **no** | downloading generated playback is out of scope |

**The cache that matters is the `bytea` column, not the browser's.** A repeat `Listen` is one
indexed `SELECT` — cheap, and correct by construction. Adding a public `max-age` to a
session-authorized body would put one participant's response audio in a shared cache, which is an
FR-002 violation dressed as an optimisation. The participant plays it in-session; the browser
holding the blob for the life of the page is enough.

---

## Worked example

**Request** — first `Listen` on a response:

```http
POST /api/playback/answer/3f7c0b1e-9a2d-4c58-8f11-6d0e2a4b7c93 HTTP/1.1
Host: happentohave.example
Cookie: htha_session=<opaque>
Content-Length: 0
```

**Response** — produced, validated, wrapped, stored:

```http
HTTP/1.1 200 OK
content-type: audio/wav
content-length: 2073644

RIFF$…WAVEfmt …          (binary)
```

**The same request again** — served from `generated_audio`, byte-identical, no provider call:

```http
HTTP/1.1 200 OK
content-type: audio/wav
content-length: 2073644
```

**Someone else's answer id**, or one that never existed, or `not-a-uuid`:

```http
HTTP/1.1 404 Not Found
content-type: application/json

{"error":"not-found"}
```

**`GEMINI_API_KEY` absent** — the page still rendered every word of text:

```http
HTTP/1.1 503 Service Unavailable
content-type: application/json

{"error":"unavailable"}
```

---

## What this endpoint must never do

| Prohibition | Source |
| - | - |
| Serve, expose, or read an **original participant recording** | FR-022, FR-024, Principle IV |
| Accept **text from the client** — the text comes from the row, never the request | FR-023, FR-024 |
| Accept a voice, model, rate, or format parameter from the client | FR-025, constitution model pins |
| Produce playback for an **unpublished contribution** — there are no unpublished rows | FR-031, Principle V |
| Return a **URL** to audio instead of the audio | [D5](../research.md) |
| Cache audio that failed mime-type, sample-rate or non-empty validation | FR-023, Principle V |
| Hardcode the sample rate instead of parsing the returned mime type | [D6](../research.md), FR-023 |
| Write a pending/claim row, or hold a DB lock across the TTS call | Principle V, [D2](../research.md) |
| Overwrite an existing `generated_audio` | FR-027, FR-028 |
| Request structured output from TTS | Principle V |
| Emit `403`, or otherwise confirm a row the caller may not have | FR-002 |
| Block, delay, or participate in publication of a contribution's text | FR-029, FR-030 |
| Produce audio for a response nobody asked to hear | FR-026, SC-003 |
