# Research: Yours and Playback

Nine decisions. Each names the alternative it beat and what would have gone wrong.

The model ids were re-verified against
[ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models) on
2026-09-07, as the constitution requires before planning any spec that calls them.
`gemini-3.1-flash-tts-preview` is still listed, still preview, and still the lowest-latency
Gemini TTS id. `gemini-3.8-flash` and `gemini-3.5-flash-lite` are both still stable. No pin
moves.

---

## D1 — Cached playback lives in a `bytea` column, not a Cloud Storage object

**Decision**: `answers.generated_audio bytea` holds the finished WAV. There is no bucket, no
object key, and no `@google-cloud/storage` dependency.

**Rationale**

The handoff's data model names `generated_audio_storage_key`, which reads as a GCS object. That
column shape assumes an infrastructure surface this repository does not have and has spent four
features not having: original audio never touches storage at all — it lives in the browser and
in one request body, and 003 and 004 both say so in their plans. Adding a bucket for *generated*
audio means a new dependency, a bucket provisioned in `deploy.sh`, an IAM binding, a lifecycle
rule, and a credential path for local development, all to hold a file the database can hold in a
column.

It also cuts against Principle IV in a way worth naming. That principle's entire job is keeping
audio storage empty. Standing up the product's first bucket — for audio, next to a deletion rule
whose whole point is that audio does not accumulate — creates exactly the surface a later reader
mistakes for "the place audio goes." The safest bucket is the one that does not exist.

**Size, since that is the real objection.** Gemini TTS returns 24 kHz 16-bit mono PCM: 48 kB per
second of speech. The recording ceiling is 60 seconds and `display_text` caps at 2000 characters,
so playback lands around 60–90 seconds and 3–4 MB. Postgres tolerates that without noticing —
the field limit is 1 GB and TOAST handles the out-of-line storage — and a weekend-scale
participant holds a handful of them.

**Alternatives considered**

| Alternative | Rejected because |
| - | - |
| GCS object + `generated_audio_storage_key` | Every cost above, for a file that fits in a column. Also untestable in the integration suite, which runs PGlite and has no bucket. |
| `text` column holding base64 | 33% larger than the bytes it encodes, and it makes the column's contents a string that looks printable in every query result. |
| Compress before storing (Opus/MP3) | Needs an encoder in the image. There is no ffmpeg in the Dockerfile and no pure-JS encoder worth a dependency for a 4 MB ceiling. |

**Cost accepted**: a `Listen` on an uncached response pulls ~3–4 MB from Neon to Cloud Run and
then to the browser. That is one photo, once per response, ever.

---

## D2 — A cluster-wide advisory lock, plus the `IS NULL` claim

**Decision**: two layers. In-process coalescing by contribution id handles two taps on one
instance. A Postgres advisory lock handles two instances. The `UPDATE … WHERE
generated_audio IS NULL` guard remains underneath both as the storage guarantee.

**Rationale**

FR-028 and SC-005 require exactly one *production* for concurrent first requests. Three shapes
were considered, and the first revision of this decision got it wrong.

A **pending row** — claim first, produce second, losers poll — is the textbook single-flight and
is still refused. Principle V: "Processing state, check results, retry counts, and storage
references exist only in the active request." A `playback_pending` row is processing state in the
database, and it brings the reconciliation problem with it: a crashed producer leaves a claim
nobody clears.

An **in-process map alone** is what shipped first, with the cross-instance gap written up as an
accepted window. Review was right to reject that framing. The map guarantees one stored
*artifact*, because of the `IS NULL` guard — but FR-028 and SC-005 say one *production*, and two
Cloud Run instances could both call the provider before either wrote. "Rare and cheap" is a
reason to rank a defect low, not a reason to call the requirement met.

What ships is a **`pg_try_advisory_lock`** taken before producing. An advisory lock is
cluster-wide, which is exactly the scope the map lacked, and — the part that matters against
Principle V — it is **not stored state**. It lives for the life of a session and vanishes when
the connection drops, so the crashed-producer failure mode that sinks the pending row simply does
not exist: kill the instance and Postgres releases the lock.

**`try`, never the blocking `pg_advisory_lock`.** A loser must not sit on a pooled connection
waiting. It returns immediately, polls the row for the winner's bytes, and serves those; on
timeout it answers 502, which is retryable and by then almost certainly a cache hit. It never
produces.

**The cost, stated plainly**: the winner holds one pooled connection for the duration of the TTS
call, a few seconds. That is real, and it is bounded by how rare the path is — a response can be
produced at most once ever, only its asker can trigger it, and a question closes at three
answers. The earlier revision rejected locking on the grounds that it would "pin every connection
in a pool capped at `max: 4`"; that argument assumed a *blocking* lock, where every waiter also
holds a connection. With `try` + poll, only the producer holds one.

**Alternatives considered**

| Alternative | Rejected because |
| - | - |
| In-process map alone | Guarantees one artifact, not one production. Does not meet FR-028 as written. |
| Pending row | Processing state in the database (Principle V), and a crashed producer strands the claim. |
| Blocking `pg_advisory_lock` | Every waiter holds a pooled connection for the whole TTS call. This is the design the pool cap actually rules out. |
| `LISTEN`/`NOTIFY` for the wait | Needs a held connection per waiter — the cost the `try` + poll shape exists to avoid, for a wait that is a couple of seconds. |

---

## D3 — Playback columns land on `answers` only

**Decision**: `answers` gains `generated_audio` and `audio_voice_id`. `questions` gains nothing.

**Rationale**

FR-014 puts `Listen` on responses. Responses are answer rows. Nothing in this spec renders a
`Listen` on a question — the handoff's optional question playback (its §5) was never built by
004 and is not in 005's scope.

The handoff's data model lists the audio columns on both tables, but a column on `questions` in
this feature would be written by nothing and read by nothing. 004 has already established what
this repository does with that shape: it dropped `questions.status` precisely because a column
whose only stated purpose was a write that never happened "is worse than absent." Adding one
here would be repeating the mistake that migration exists to undo.

**Alternative rejected**: adding both columns to `questions` now "since the migration is open
anyway." That is the "it might be useful later" Principle VI names by name.

---

## D4 — The voice is `Sulafat`, and resolving the TODO is its own PR

**Decision**: recommend `Sulafat` (Warm) for `TODO(TTS_VOICE_ID)`. The constant lives at one
export in `src/playback/voice.ts`. **The constitution amendment resolving the TODO is a separate
commit and a separate PR in this stack**, because amendments "MUST NOT be made silently inside a
feature PR."

**Rationale**

The full prebuilt set is 30 voices. The spike used `Kore` (Firm) and said so explicitly —
"chosen for the spike only" — and the crisis fixture regeneration used `Enceladus` (Breathy) as
a second set. Neither was a product choice.

What the product needs is narrow. A stranger's advice is read back to the person who asked for
it, and Principle VII forbids the one thing that would otherwise be the obvious move: the app
"MUST NOT generate, imitate, or market an Appalachian dialect." Region is off the table, so
warmth is the only affective lever left, and it has to carry without performing.

| Candidate | Characteristic | Why not |
| - | - | - |
| **Sulafat** | Warm | **Chosen.** Warm without being folksy; reads advice as advice. |
| Achird | Friendly | Friendly tips toward upbeat, which is wrong over a response to a hard question. |
| Vindemiatrix | Gentle | Gentle reads as consoling. The response may be blunt; the voice should not soften it. |
| Schedar | Even | Correct and inert. Removes the human quality US3 exists to return. |
| Kore | Firm | The spike's placeholder, and firm is the wrong register for received advice. |

**Why the amendment is split out**: governance requires an amendment PR that states the changed
principle, the rationale, and the bump. It is a **MINOR** (5.1.0), corrected from an initial
PATCH during review: naming the voice is a clarification, but *requiring it be pinned at exactly
one application-code export* is an obligation no earlier revision imposed, and this document
defines any new MUST as materially expanded guidance. Stacking it under the feature keeps the two
reviewable separately and keeps the code's constant and the constitution's text landing together.

---

## D5 — `POST /api/playback/answer/[id]`, returning `audio/wav` bytes

**Decision**: one route, POST, responding with the audio itself rather than a URL.

**Rationale**

`GET` was the first instinct, because `<audio src>` would then need no JavaScript at all. It
loses on two counts. A first `GET` produces audio, which is a side effect on a method that
should not have one — survivable, since production is idempotent, but the second count is
decisive: FR-032 requires a loading state **scoped to that response** and FR-033 requires a retry
offered for the audio alone. Both need the client to observe the request, which means `fetch`,
which means the `<audio src>` saving disappears. Once the client is fetching, POST is the honest
method.

The response body is the audio. Returning a URL would mean a second round trip to a second route
that has to re-authorize, for no gain.

**Authorization** is one predicate: the requester authored the answer, *or* they own the question
it answers. FR-002 scopes `Yours` to the requesting participant, and those are the only two ways
an answer is theirs. Written once, it covers a `Listen` on a response today and a `Listen` on
one's own answer if that is ever added, with no second rule to keep in sync.

**Failure codes carry the distinction FR-033 and FR-034 draw**:

| Status | Meaning | Client |
| - | - | - |
| 200 | audio body | plays |
| 401 | no session | no `Listen` was rendered; a crafted request gets nothing |
| 404 | no such answer, or not the requester's | as above. **Never 403** — a distinct "forbidden" confirms the row exists and hands an enumerator a status-code oracle |
| 502 | production failed this time | text stays, **retry offered** (FR-033) |
| 503 | playback unavailable entirely | text stays, `Listen` **degrades**, no retry (FR-034) |

---

## D6 — Raw L16 is wrapped in a WAV container in application code

**Decision**: build a 44-byte RIFF/WAVE header around the returned PCM. No dependency.

**Rationale**

Gemini TTS returns `audio/L16;codec=pcm;rate=24000` — headerless signed 16-bit little-endian
PCM. No browser plays that from an `<audio>` element or an object URL. The header is 44 bytes of
fixed fields plus two lengths, which is less code than any package that would do it.

The sample rate is **parsed out of the returned `mimeType`, never hardcoded**. FR-023 requires
validating the returned audio type and a nonempty payload before use, and a rate assumed rather
than read is the failure that produces audio playing at the wrong speed with nothing erroring.
A response whose mime type is not L16 PCM, or whose rate is unparseable, or whose payload is
empty, is a fault — not a rejection, and not something to cache.

---

## D7 — Two flat queries per section, grouped in TypeScript

**Decision**: `Your Answers` is one join. `Your Questions` is two statements — the participant's
questions, then every published answer to that set of ids — grouped in application code.

**Rationale**

The alternative was `json_agg`, returning one row per question with its responses nested. It
costs one round trip fewer and buys a validation problem: Principle V requires every row
crossing into application code to be validated, and validating an aggregated JSON column means
a schema for a shape the database invented. Flat rows validate against the row schemas that
already exist in `src/schema/rows.ts`.

Two statements, not N+1: the second takes `question_id = ANY($2)` over the whole id set, so the
count of round trips does not grow with the number of questions.

**FR-012's response count is `responses.length`** on the grouped result. That is the relational
`COUNT` the constitution demands, arrived at by counting the rows themselves — the one count
that provably cannot drift, since it is the list being rendered.

---

## D8 — Ordering is `created_at ASC`, and the code says why

**Decision**: responses render oldest first. A comment on the query states that this is
chronology and carries no quality signal.

**Rationale**

The spec's Assumptions fix the order; FR-018 forbids ordering "by any quality signal" and FR-019
and FR-020 forbid every control that would imply one. Chronological order is the only ordering
that asserts nothing, but an `ORDER BY` with no comment is an invitation for the next reader to
"improve" it into a ranking. The comment is the guardrail, since no test can catch a sort key
that is defensible on its face.

---

## D9 — No new rate limit on the playback route

**Decision**: `POST /api/playback/answer/[id]` is not rate-limited. The reciprocity gate already
bounds the spend.

**Rationale**

The constitution requires a server-side rate limit on **the submission endpoint**, because that
endpoint spends money on every request from anyone. This one does not have that shape. Walk the
chain: a response exists only because someone earned an ask, spent it on a question, and someone
else published an answer to it. A question closes at three answers. Only the asker can request
playback for those responses, and each response can be produced at most once ever — the
`IS NULL` guard in D2 means the second request through is a read.

So the ceiling on TTS spend is three productions per published question, and questions are
already gated by the one rule the product has. A rate limit here would be limiting a number that
the reciprocity gate has already limited.

**What would change this**: adding `Listen` to a surface that is not scoped to one participant's
own questions. Nothing in this feature does.
