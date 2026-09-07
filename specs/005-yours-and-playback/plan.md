# Implementation Plan: Yours and Playback

**Branch**: `005-yours-and-playback` · **Date**: 2026-09-07 · **Spec**: [spec.md](spec.md)

## Summary

Close the loop. Four features have taken recordings and published them; none has ever shown a
participant what became of one. `/yours` is still the ten-line placeholder 004 left behind so
the header link would not 404.

Three things get built:

- **`/yours`** — one server-rendered screen, two sections. `Your Answers` joins each published
  answer to the question it addressed. `Your Questions` lists the participant's published
  questions with every response to them, flat and unranked.
- **Playback** — `src/playback/`, a TTS module beside `src/review/` and shaped like it. One
  voice, produced on first `Listen`, cached in the answer row, reused forever after.
- **The voice** — `TODO(TTS_VOICE_ID)` has been open in the constitution since ratification.
  This plan picks `Sulafat` and resolves the TODO **in its own commit and its own PR**, because
  governance forbids amending the constitution inside a feature PR.

Nothing here re-judges a contribution. The gate is 002's and stays 002's; this feature reads
rows that already passed it.

## Technical Context

**Language/Version**: TypeScript 7.0.2 on Node.js 24 LTS, ESM only. Extensionless imports in
`src/` and `app/`, `.js`-suffixed in `tests/`, matching 001–004.

**Primary Dependencies**: none new. Next.js 16.3.4, React 19.2.8, `@neondatabase/serverless`
1.1.0, `iron-session` 9.0.1, Zod 4.5.4, `@google/genai` 2.21.0. **No `@google-cloud/storage`**
and no audio-encoding package — see [research D1](research.md) and [D6](research.md).

**Provider surface**: `gemini-3.1-flash-tts-preview` through `models.generateContent` with
`responseModalities: ['AUDIO']` and a `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`.
Re-verified against the live model list on 2026-09-07; still preview, still the pinned id. The
Live API remains forbidden — it is speech-to-speech and would derive playback from the original
recording, which Principle IV prohibits outright.

**Storage**: `answers` gains `generated_audio bytea` and `audio_voice_id text`, both NULL until
a first `Listen`. `questions` gains nothing ([D3](research.md)). No bucket, no object key, no
new table — so `tests/helpers/pglite.ts`'s `TRUNCATE` list is unchanged.

**Testing**: Vitest against real Postgres via PGlite for both queries and the produce-once
guard; unit tests at the `GenAiClient` seam for the TTS call and the WAV wrapper; Playwright for
the two sections, both empty states, the loading state and the playback failure state.
`tests/e2e/copy.spec.ts` already lists `/yours` in its `ROUTES`, so the new screen falls under
the copy sweep the moment it renders anything.

**Target Platform**: current mobile Safari and Android Chrome, plus desktop. SC-010 names both.

**Performance Goals**: SC-001's two seconds covers three statements against Neon and no provider
call — playback is never on the render path, which is FR-029 and FR-030 restated as a budget.
First-`Listen` latency is the TTS call and is deliberately unbudgeted; FR-032's per-response
loading state exists because it is not instant.

**Constraints**: text never waits on audio; audio is produced at most once per response; no
original recording is reachable, offered, or playable; no ranking, scoring, voting or
best-answer control exists anywhere in the tree.

**Scale/Scope**: one screen with two sections and three empty states, one endpoint, one new
`src/` module, one migration, three queries. A weekend-scale history renders in full — no
pagination, per the spec's Assumptions.

## Constitution Check

Checked against constitution **v5.0.1**. Re-checked after Phase 1 design; result unchanged.

| Principle | Applies here? | Status | Evidence |
| - | - | - | - |
| I. Human Contribution Is The Product | Yes | **PASS** | Every string on the screen is either fixed copy or a published `display_text` 002 produced from a human recording. Playback voices that same text and adds nothing to it (FR-023). No summarizing, no ranking, no generated commentary. ElevenLabs appears nowhere; the voice is a Gemini prebuilt. |
| II. Server-Authoritative Reciprocity | Consumed, not touched | **PASS** | This feature grants and consumes nothing. `can_ask` is neither read nor written. Scoping is server-side: `/yours` reads the participant from the cookie via `readParticipantIdFromCookies` and every query is filtered by that id — a client cannot ask for someone else's history. |
| III. Aggregate Guardrail Gate | Consumed | **PASS** | Only rows that already passed the gate exist to be listed. Playback is not a review call, dispatches no check, and cannot change an outcome. FR-031 keeps `Listen` off anything unpublished — and nothing unpublished is a row to begin with. |
| IV. Original Audio Is Transient | **Yes — this is the feature's sharpest edge** | **PASS** | FR-022 and FR-024 are the principle verbatim. Playback is produced from `display_text` and the original recording is not merely unused here, it does not exist by the time a row does. There is no column, route, or component in this design that could reach one. |
| V. Structured Output Or Failure | Yes, in its **TTS-exempt** form | **PASS** | The constitution exempts TTS from `responseSchema` and replaces it with a different obligation: "validate the returned audio type and nonempty payload before caching or serving it." [D6](research.md) does exactly that — mime type checked, sample rate parsed rather than assumed, empty payload treated as a fault. Every row crossing into application code is Zod-validated against `src/schema/rows.ts`. No pending, withheld, or failed state is stored (FR-021), and [D2](research.md) rejects the pending-row design specifically to keep it that way. |
| VI. Scope Discipline | Yes | **PASS** | The Out of Scope list is long and is honoured in full: no votes, ratings, comments, replies, best-answer, sorting, filtering, search, sharing, export, download, pagination, notifications, or live updating. [D3](research.md) declines to add columns to `questions` "while the migration is open". [D9](research.md) declines to add a rate limit the reciprocity gate already imposes. |
| VII. Voice And Provenance | Yes | **PASS** | Every string is fixed in [contracts/copy.md](contracts/copy.md) and swept by `tests/unit/copy.test.ts`. The voice choice in [D4](research.md) is explicitly *not* an Appalachian performance — Principle VII forbids that, which is why warmth rather than region is the axis. |

### Feature-specific gates

| Gate | Status | Note |
| - | - | - |
| No original recording is reachable | **PASS** | No column holds one, no route serves one, no component references one. By the time an answer row exists, the audio has been released — 003's route does that on every exit path. |
| Text never waits on audio | **PASS** | The page renders from three SQL statements. `src/playback/` is imported by the API route and by nothing on the render path (FR-029, FR-030, SC-002). |
| Playback unavailable ⇒ text still renders | **PASS** | The page never constructs a provider client, so a missing `GEMINI_API_KEY` cannot affect it. The route answers 503 and only `Listen` degrades ([D5](research.md), FR-034, SC-011). |
| Exactly one production per response | **PASS with a stated window** | In-process coalescing plus `UPDATE … WHERE generated_audio IS NULL`. One stored artifact always; a cross-instance duplicate *spend* is possible and is recorded as accepted in [D2](research.md). |
| Zero production for unrequested responses | **PASS** | `generated_audio IS NULL` is the assertion itself — SC-003 is a query, not an inference. Publication writes no audio; only the route does. |
| Scoped to the requesting participant | **PASS** | Both list queries filter on the session participant. The playback route re-authorizes independently: authored the answer, or owns the question it answers ([D5](research.md)). |
| No ranking surface exists | **PASS** | Chronological `ORDER BY` with a comment saying it is chronology ([D8](research.md)); no score column, no sort control, no vote affordance in the component tree. |
| TTS model is not in `REVIEW_MODELS` | **PASS** | `tests/unit/review-client.test.ts` asserts that object's exact key set. The playback pin lives in `src/playback/client.ts`, which is where it belongs anyway — it is not a review call. |

## Decisions this plan makes

Nine, each with the alternative it beat. Full reasoning in [research.md](research.md).

| # | Decision |
| - | - |
| D1 | Cached playback is a `bytea` column, not a GCS object. The handoff's `generated_audio_storage_key` assumes infrastructure this repo has spent four features not having — and Principle IV's whole job is keeping audio storage empty. |
| D2 | Produce-then-claim: coalesce in-process, then `UPDATE … WHERE generated_audio IS NULL`. A pending row would be processing state in the database, which Principle V forbids. |
| D3 | Playback columns land on `answers` only. A column on `questions` would be written by nothing and read by nothing — the exact shape 004's migration exists to undo. |
| D4 | The voice is `Sulafat` (Warm). Region is forbidden by Principle VII, so warmth is the only lever. **The constitution amendment is a separate PR.** |
| D5 | `POST /api/playback/answer/[id]` returns the audio bytes. GET would need no JS, but FR-032's scoped loading state and FR-033's audio-only retry both require the client to observe the request. |
| D6 | The raw L16 PCM is wrapped in a 44-byte WAV header in application code. The sample rate is parsed from the returned mime type, never assumed. |
| D7 | Two flat queries per section, grouped in TypeScript. `json_agg` would mean Zod-validating a shape the database invented. |
| D8 | Responses order by `created_at ASC`, with a comment stating that this is chronology and not a quality signal. |
| D9 | No rate limit on the playback route. Spend is capped at three productions per published question by the reciprocity gate that already exists. |

## Divergences — found by this plan

Five. Three are inherited, one is a governance step this feature cannot skip, and one is a
shipped test that **fails the moment this screen exists**.

| # | What | Fix |
| - | - | - |
| D-1 | `app/yours/page.tsx` is a placeholder whose own comment says 005 owns the real screen. `ContributionOutcomeView` already links to `/yours` from four branches — `rate_limited`, `publishedQuestion`, `spent`, and `lost` — so four shipped flows currently land on it. | Replaced by this feature. Not a separate task; the four inbound links become real destinations and get an e2e assertion each. |
| D-2 | `AppHeader.tsx` hardcodes the string `'Yours'` instead of reading `copy.nav.yours`, which exists and holds the same value. Harmless today, and it is the one string guaranteed to drift when the section is finally built. | One-line change to read from `copy`. Grouped into this feature's branch rather than spawning its own, per the repository's small-dependent-change rule. |
| D-3 | `TODO(TTS_VOICE_ID)` is unresolved in the constitution, and this feature cannot ship without picking a voice. Amendments "MUST NOT be made silently inside a feature PR." | A separate commit and separate stacked PR bumping the constitution to **5.0.2 (PATCH)** — it fills a declared TODO under an existing rule without changing any obligation. The code reads the id from one export so the document and the constant land together. |
| D-4 | **`tests/e2e/responsive.spec.ts:97` fails the moment this screen ships.** It asserts `/yours` uses `Screen`'s default 560 px column *and* locates the element by the placeholder string `'Yours is on its way'`. Both premises expire with the placeholder. | Rewritten in this feature, not deleted. The centering assertion is still worth keeping; it needs a real locator and the column width this screen actually sets via `--content-max`. `tests/e2e/a11y.spec.ts:102`'s comment — "a route with nothing to tab to (the `/yours` placeholder today)" — is stale in the same change: the `Listen` controls are now tab stops, and the loop that skips zero stops silently stops proving anything here. |
| D-5 | `specs/001-participant-and-pool/contracts/design.md` sketches `/yours` with mobile segmented tabs, a `/yours/questions/[id]` sub-route, a bespoke header variant, and `--ink-50`/`--ink-45` secondary text. None of it matches this spec, and the last item is a contrast failure. | The spec wins, per section 11 of [contracts/yours-view.md](contracts/yours-view.md), which resolves each conflict individually. Tabs and a sub-route are both out of scope (FR-001 fixes two sections in one area); `--ink-45`/`--ink-50` fail WCAG AA on `--bg` at body sizes and `--ink-65` is the floor. 001's design doc is a historical artifact and is **not** rewritten. |

## Project Structure

### Documentation (this feature)

```text
specs/005-yours-and-playback/
├── plan.md              # this file
├── research.md          # the nine decisions worth recording
├── data-model.md        # the two columns, why NULL is the honest default, and what questions does not get
├── contracts/
│   ├── playback-api.md  # POST /api/playback/answer/[id] — request, responses, status codes
│   ├── yours-view.md    # what each section renders, and the constraints on what it must not
│   └── copy.md          # every fixed string, and the sweep's banned words this screen walks past
├── quickstart.md        # how to prove each SC, and what is not proven
├── checklists/
│   └── requirements.md  # spec quality gate
└── tasks.md             # generated by /speckit-tasks
```

### Source Code (repository root)

```text
app/
├── yours/
│   ├── page.tsx                 # server: session read, three queries, renders (replaces the placeholder)
│   ├── page.module.css          # sets --content-max; never re-declares max-width
│   └── ResponseList.tsx         # client: the Listen button, its loading state and its retry
└── api/playback/answer/[id]/route.ts   # POST, returns audio/wav (D5)

src/
├── playback/
│   ├── client.ts                # the TTS model pin + GenAiClient construction, server-only
│   ├── voice.ts                 # VOICE_ID — the single export D4's amendment pairs with
│   ├── wav.ts                   # L16 → WAV, mime parsing and payload validation (D6)
│   └── index.ts                 # producePlayback(): coalesce, call, validate, wrap
├── db/queries/
│   ├── answers.ts               # + listPublishedAnswers, readPlayback, claimPlayback, authorizePlayback
│   └── questions.ts             # + listPublishedQuestions, listResponsesForQuestions
├── schema/rows.ts               # + row schemas for the three new query shapes
├── ui/AppHeader.tsx             # reads copy.nav.yours (D-2)
└── copy.ts                      # + yours.* — see contracts/copy.md

migrations/
└── 1788740000000_answer-playback.sql   # + generated_audio, audio_voice_id

tests/
├── unit/playback-wav.test.ts        # header bytes, mime parsing, empty and wrong-type payloads
├── unit/playback-produce.test.ts    # the GenAiClient seam: voice sent, coalescing, faults
├── integration/yours-history.test.ts# both sections, scoping, ordering, the three empty cases
├── integration/playback-cache.test.ts# produce-once guard, reuse, NULL means never produced
└── e2e/yours.spec.ts                # sections, empty states, Listen loading, failure + retry
```

**Structure Decision**: unchanged from 001–004. One Next.js app, App Router, `src/` for
everything that is not a route. `src/playback/` is a sibling of `src/review/` rather than a file
inside it, because it is not a review call: it requests no schema, dispatches no check, and its
model pin is deliberately outside `REVIEW_MODELS`, whose exact key set a shipped unit test
asserts.

The page stays a server component and pushes `'use client'` down to `ResponseList.tsx`, matching
the `app/ask/page.tsx` → `AskQuestion.tsx` split. Only the `Listen` control needs interactivity;
making the whole screen a client component to get one button would ship the history render into
the browser bundle for nothing.

## Complexity Tracking

| Deviation | Why it is necessary | Simpler alternative rejected because |
| - | - | - |
| A `bytea` column where the handoff names a storage key | The handoff's column shape assumes a GCS surface this repository does not have, and standing one up means a dependency, a bucket, an IAM binding, a lifecycle rule and a local credential path — to hold a 3–4 MB file a column holds. It also builds the product's first audio bucket next to a principle whose entire purpose is that audio does not accumulate. | A GCS object. Costs all of the above, and the integration suite runs PGlite with no bucket, so the cache path would be provable only by hand. |
| A new top-level `src/` module for one provider call | `src/review/` is `server-only`, schema-driven, and covered by tests asserting the exact key set of its model map. TTS requests no schema and its id must stay out of that map. Filing it under `review/` would put a non-review call inside the module whose name is the guarantee that everything in it was reviewed. | Adding `tts.ts` to `src/review/`. Breaks the shipped `REVIEW_MODELS` key-set assertion or forces the pin somewhere it does not read as a pin. |
| An in-process coalescing map — mutable module state, which this repo otherwise has none of | FR-028 and SC-005 require one production for concurrent first requests, and the two deterministic alternatives are both worse: an advisory lock held across the TTS call would pin all four pooled connections for seconds, and a pending row is processing state in the database that Principle V forbids and that a crashed producer leaves stranded. | Relying on the `IS NULL` guard alone. That yields one stored artifact but permits two same-instance productions — the common case, not the rare one, since it is one person double-tapping in one browser. |
| A constitution amendment stacked under a feature PR | The feature cannot pick a voice without resolving `TODO(TTS_VOICE_ID)`, and governance requires an amendment PR stating the principle, rationale and bump. | Choosing the voice in code and leaving the TODO open. The constant and the document would then disagree, which is precisely the defect amendment 5.0.1 was written to fix. |
