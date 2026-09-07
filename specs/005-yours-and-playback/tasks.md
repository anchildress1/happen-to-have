---

description: "Task list for 005-yours-and-playback"
---

# Tasks: Yours and Playback

**Input**: Design documents from `/specs/005-yours-and-playback/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: Included. The constitution requires automated tests before any implementation change
is reported complete, and [quickstart.md](quickstart.md) names the check that proves each
success criterion.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel — different files, no dependency on an incomplete task
- **[Story]**: which user story the task serves (US1–US4)
- Every task carries an exact file path

## Path conventions

One Next.js app. `app/` for routes, `src/` for everything else, `tests/` at the repository root.
Extensionless imports in `app/` and `src/`; `.js`-suffixed in `tests/`.

## Branch stack

Tasks map onto six stacked PRs, bottom to top. Each layer is independently reviewable.

| Layer | Branch | Phases |
| - | - | - |
| 1 | `005-constitution-voice` | ✅ done — amendment 5.0.2 |
| 2 | `005-plan` | ✅ done — this file and its siblings |
| 3 | `005-data-and-queries` | Phase 2 |
| 4 | `005-playback-engine` | Phase 3 |
| 5 | `005-yours-screen` | Phases 1, 4, 5, 6 |
| 6 | `005-e2e` | Phase 7, Phase 8 |

---

## Phase 1: Setup

**Purpose**: the copy block every later phase renders, and the one inherited string bug.

- [ ] T001 Add the `yours` block to `src/copy.ts` exactly as fixed in [contracts/copy.md](contracts/copy.md), with a JSDoc on each entry naming its FR
- [ ] T002 Change `src/ui/AppHeader.tsx` to render `copy.nav.yours` instead of the hardcoded `'Yours'` literal (plan divergence D-2)
- [ ] T003 [P] Extend `tests/unit/copy.test.ts` with verbatim `toBe` pins for every string [contracts/copy.md](contracts/copy.md) fixes, matching how the 002 and 003 strings are pinned

**Checkpoint**: `pnpm test` passes; the forbidden-vocabulary sweep covers the new block automatically.

---

## Phase 2: Foundational — schema and queries

**Purpose**: everything the screen and the playback route read or write. Blocks every user story.

**⚠️ No user story work can begin until this phase is complete.**

### Migration

- [ ] T004 Create `migrations/1788740000000_answer-playback.sql` adding `generated_audio bytea` and `audio_voice_id text` to `answers`, both nullable with no default, per [data-model.md](data-model.md). Comment why NULL is the honest state and not a placeholder — it *is* SC-003's assertion, stored
- [ ] T005 Write the Down Migration dropping both columns
- [ ] T006 Run `make db-up && make migrate` and confirm the branch database applies cleanly

### Row schemas

- [ ] T007 [P] Add `answerHistoryRowSchema` to `src/schema/rows.ts` — `id`, `display_text`, `created_at`, `question_text`
- [ ] T008 [P] Add `questionHistoryRowSchema` to `src/schema/rows.ts` — `id`, `display_text`, `created_at`
- [ ] T009 [P] Add `responseRowSchema` to `src/schema/rows.ts` — `id`, `question_id`, `display_text`, `created_at`, `has_playback`

### Read queries

- [ ] T010 Add `listPublishedAnswers(participantId, client)` to `src/db/queries/answers.ts` — the join in [data-model.md](data-model.md), newest first, validating every row
- [ ] T011 Add `listPublishedQuestions(participantId, client)` to `src/db/queries/questions.ts`, newest first. Comment why plain `=` is correct here where the selection queries need `IS DISTINCT FROM`: this one must *exclude* seeded rows
- [ ] T012 Add `listResponsesForQuestions(questionIds, client)` to `src/db/queries/questions.ts` using `question_id = ANY($1::uuid[])`, selecting `generated_audio IS NOT NULL AS has_playback` and **never the bytes**
- [ ] T013 Add the `ORDER BY a.created_at ASC` comment to T012 stating this is chronology and carries no quality signal (FR-018, research D8) — no test can catch a sort key that looks defensible

### Playback queries

- [ ] T014 Add `authorizePlayback(answerId, participantId, client)` to `src/db/queries/answers.ts` — one predicate covering *authored the answer* or *owns the question*, returning `display_text` and whether audio is cached. No row means not found
- [ ] T015 Add `readPlayback(answerId, client)` to `src/db/queries/answers.ts` returning the cached bytes or null
- [ ] T016 Add `claimPlayback(answerId, wav, voiceId, client)` to `src/db/queries/answers.ts` as `UPDATE … WHERE id = $1 AND generated_audio IS NULL RETURNING id`, exported as a named SQL constant so a test can assert its shape

### Integration tests

- [ ] T017 [P] Create `tests/integration/yours-history.test.ts` covering both sections: a participant sees their own published answers with the original question, and their own published questions
- [ ] T018 [P] Add scoping assertions to `tests/integration/yours-history.test.ts` — another participant's answers and questions never appear (FR-002)
- [ ] T019 [P] Add a seeded-question assertion to `tests/integration/yours-history.test.ts` — a `NULL participant_id` question appears in nobody's `Your Questions`
- [ ] T020 [P] Add an ordering assertion to `tests/integration/yours-history.test.ts` — three responses come back oldest-first (FR-018)
- [ ] T021 [P] Add the three empty cases to `tests/integration/yours-history.test.ts` — no answers, no questions, and a question with zero responses
- [ ] T022 [P] Create `tests/integration/playback-cache.test.ts` asserting `SELECT count(*) FROM answers WHERE generated_audio IS NOT NULL` is `0` after publishing and before any request (SC-003)
- [ ] T023 [P] Add a `claimPlayback` guard test to `tests/integration/playback-cache.test.ts` — a second claim on a row that already has audio returns zero rows and does not overwrite (SC-004, FR-027)
- [ ] T024 [P] Add a structural assertion on the `claimPlayback` SQL constant to `tests/integration/playback-cache.test.ts` — it contains `generated_audio IS NULL`. PGlite serializes on one connection and cannot construct the real race, exactly as `question-publish.test.ts` documents
- [ ] T025 [P] Add `authorizePlayback` tests to `tests/integration/playback-cache.test.ts` — the author passes, the question owner passes, a third participant gets nothing

**Checkpoint**: `pnpm run test:integration` green. The screen and the route both have their data layer.

---

## Phase 3: Playback engine (US3 foundation)

**Purpose**: `src/playback/`, a sibling of `src/review/` and not a member of it.

- [ ] T026 Create `src/playback/voice.ts` exporting `VOICE_ID = 'Sulafat'` as the single pin the constitution's 5.0.2 amendment pairs with. No second literal anywhere
- [ ] T027 Create `src/playback/client.ts` with `import 'server-only'`, the `gemini-3.1-flash-tts-preview` pin, and a lazily-constructed SDK client. **The model id must not enter `REVIEW_MODELS`** — `tests/unit/review-client.test.ts` asserts that object's exact key set
- [ ] T028 Reuse the existing `GenAiClient` interface from `src/review/client.ts` rather than declaring a second one, so the test seam stays single
- [ ] T029 Create `src/playback/wav.ts` exporting `pcmToWav(pcm, sampleRate)` writing a 44-byte RIFF/WAVE header
- [ ] T030 Add `parseAudioMimeType(mimeType)` to `src/playback/wav.ts` extracting the sample rate from `audio/L16;codec=pcm;rate=24000`. **Parsed, never assumed** — an assumed rate plays at the wrong speed with nothing erroring (FR-023, research D6)
- [ ] T031 Create `src/playback/index.ts` exporting `producePlayback({ answerId, text }, deps)` — calls TTS with `responseModalities: ['AUDIO']` and `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`, validates the response, wraps to WAV
- [ ] T032 Validate before caching in `src/playback/index.ts`: a candidate exists, `inlineData.mimeType` is L16 PCM, the rate parses, and the payload is non-empty. Any failure is a **fault**, never a rejection — mirroring how `src/review/retry.ts` draws that line
- [ ] T033 Add the in-process coalescing map to `src/playback/index.ts`, keyed by answer id, so concurrent first requests on one instance produce once (FR-028, research D2). Delete the entry when the promise settles, or a transient failure is cached forever
- [ ] T034 Add a `PlaybackDeps` injection seam to `src/playback/index.ts` (`genai`, `voiceId`) matching `ReviewDeps` in `src/review/index.ts`

### Unit tests

- [ ] T035 [P] Create `tests/unit/playback-wav.test.ts` asserting the WAV header bytes — `RIFF`, `WAVE`, `fmt `, `data`, PCM format 1, one channel, 16-bit, and both length fields
- [ ] T036 [P] Add mime-parsing tests to `tests/unit/playback-wav.test.ts` — a valid L16 type parses its rate; a missing rate, a non-L16 type, and a malformed string each fail rather than defaulting to 24000
- [ ] T037 [P] Create `tests/unit/playback-produce.test.ts` faking `GenAiClient` — assert the request carries `Sulafat` and the pinned TTS model, and that the response is wrapped as WAV
- [ ] T038 [P] Add fault tests to `tests/unit/playback-produce.test.ts` — empty payload, wrong mime type, and no candidate each produce a fault and cache nothing
- [ ] T039 [P] Add a coalescing test to `tests/unit/playback-produce.test.ts` — two `producePlayback` calls for one id without awaiting between them yield one `generateContent` and the same buffer (SC-005)
- [ ] T040 [P] Add a cache-eviction test to `tests/unit/playback-produce.test.ts` — after a failed production, a later call retries rather than replaying the failure

**Checkpoint**: `pnpm test` green. Playback produces audio and no route calls it yet.

---

## Phase 4: User Story 1 — See what came back (P1) 🎯 MVP

**Goal**: the asker opens `Yours` and reads every response to their question, flat and unranked.

**Independent test**: seed a participant with one published question carrying three responses,
open `/yours`, confirm all three render as a flat unranked list with the question text and a
response count.

- [ ] T041 [US1] Replace `app/yours/page.tsx` with an async server component: `readParticipantIdFromCookies()`, the three queries, `export const dynamic = 'force-dynamic'`
- [ ] T042 [US1] Render both empty states rather than redirecting when there is no session — `readParticipantIdFromCookies` is read-only by design and a page that minted identity would hand an unauthenticated caller a row for a GET
- [ ] T043 [US1] Group responses onto their questions in TypeScript (research D7), never with `json_agg`
- [ ] T044 [US1] Render the `Your Questions` section — question text (FR-011), response count from `responses.length` (FR-012), each response as text (FR-013)
- [ ] T045 [US1] Render the per-question empty state when a published question has no responses yet (FR-016)
- [ ] T046 [US1] Render the section empty state when the participant has published no questions (FR-016)
- [ ] T047 [P] [US1] Create `app/yours/page.module.css` setting `--content-max` for the wider history column. **Never re-declare `max-width`** — equal-specificity duplicates across modules resolve by stylesheet order and dev and prod disagreed once already
- [ ] T048 [US1] Confirm the rendered tree contains no vote, like, reaction, rating, comment, reply, best-answer, score, or sort control, per the must-not-render table in [contracts/yours-view.md](contracts/yours-view.md)

**Checkpoint**: US1 is independently deliverable. A closed question and its answers stay visible to the asker (FR-015) because nothing filters on closure.

---

## Phase 5: User Story 2 — See what you gave (P2)

**Goal**: the participant sees their published answers with each original question, and nothing else.

**Independent test**: publish an answer, separately withhold and fail submissions, open `/yours`, confirm only the published answer is present.

- [ ] T049 [US2] Render the `Your Answers` section — the original question (FR-005), the `Published` label (FR-006), the answer's processed text (FR-007)
- [ ] T050 [US2] Render the section empty state pointing toward answering a question (FR-009)
- [ ] T051 [US2] Confirm no restore, retry, recover, or resume control exists for any unpublished attempt (FR-008) — there is no row to build one from, and this task is the check that none was invented
- [ ] T052 [US2] Confirm no original-recording playback or review affordance exists anywhere in the tree (FR-022, SC-006, Principle IV)

**Checkpoint**: both sections render. No audio exists yet, and the screen is complete without it — which is US4.

---

## Phase 6: User Story 3 — Hear it (P3)

**Goal**: `Listen` speaks the processed text in one consistent voice, produced once and reused.

**Independent test**: open a response never played, choose `Listen`, confirm audio is produced from the processed text; choose it again and confirm the same audio is reused.

- [ ] T053 [US3] Create `app/api/playback/answer/[id]/route.ts` implementing [contracts/playback-api.md](contracts/playback-api.md): session, uuid validation, authorize, cache read, produce, claim, serve
- [ ] T054 [US3] Return 404 — never 403 — for an answer that is not the requester's. A distinct forbidden status confirms the row exists and hands an enumerator an oracle
- [ ] T055 [US3] Take `display_text` from the row and **never from the request body**. A client-supplied text would let anyone have arbitrary text voiced at the product's expense
- [ ] T056 [US3] On a zero-row claim, re-read and serve the winner's audio rather than overwriting (research D2)
- [ ] T057 [US3] Distinguish 502 from 503 — a production fault this time versus playback being absent entirely. Detect absence at client construction, never by inferring it from a caught exception. This distinction is the whole of how FR-033 and FR-034 differ
- [ ] T058 [US3] Create `app/yours/ResponseList.tsx` as a `'use client'` child owning the `Listen` button, per-response state, and retry
- [ ] T059 [US3] Hold playback state **per response, never globally** (FR-032) — one response loading must not put every other response in a loading state
- [ ] T060 [US3] Render the loading state with `aria-live="polite"` on that response only, following `src/ui/QuestionCard.tsx`
- [ ] T061 [US3] On 502, keep the response text fully readable and offer a retry for the audio alone (FR-033)
- [ ] T062 [US3] On 503, keep the text readable and degrade `Listen` with no retry offered (FR-034)
- [ ] T063 [US3] Play the returned bytes via an object URL. Revoke it when the component unmounts, or a long session leaks every response it played
- [ ] T064 [US3] Offer `Listen` only on responses (FR-014, FR-031). `Your Answers` renders no `Listen` in this feature

**Checkpoint**: US3 is independently deliverable. Every earlier phase still works with playback removed.

---

## Phase 7: User Story 4 — Text does not wait on audio (P4)

**Goal**: prove the property the whole design already has, rather than build anything new.

**Independent test**: publish a response, view it immediately, confirm the text renders with no audio in existence; confirm audio is produced only on the first `Listen`.

- [ ] T065 [US4] Assert `app/yours/page.tsx` imports nothing from `src/playback/` — the provider client is constructed lazily inside the route handler and nowhere else (FR-029, FR-034, SC-011)
- [ ] T066 [US4] Add a test to `tests/integration/playback-cache.test.ts` proving publication writes no audio: after `publishAnswer`, `generated_audio` is NULL and `display_text` reads back intact (SC-002)
- [ ] T067 [US4] Verify SC-011 by hand per [quickstart.md](quickstart.md) — `GEMINI_API_KEY=` at build and start, then confirm the full history renders with only `Listen` degraded

---

## Phase 8: End-to-end and polish

**Purpose**: the browser-level proof, and the two inherited tests this screen invalidates.

### The tests this feature breaks

- [ ] T068 Rewrite the `/yours` case in `tests/e2e/responsive.spec.ts:97`. It pins the default 560 px column and locates the element by the placeholder string `'Yours is on its way'` — **both premises expire the moment this screen ships** (plan divergence D-4). Keep the centering assertion; give it a real locator and this screen's actual column
- [ ] T069 Update the stale comment at `tests/e2e/a11y.spec.ts:102` — "a route with nothing to tab to (the `/yours` placeholder today)" is no longer true once `Listen` controls exist, and the loop that tolerates zero stops silently stops proving anything here

### New e2e coverage

- [ ] T070 [P] Create `tests/e2e/yours.spec.ts` seeding a full history through the real app path — never hand-built URLs or invented ids
- [ ] T071 [P] Assert both sections render with their content (US1, US2)
- [ ] T072 [P] Assert all three empty states render, with zero blank or errored screens (SC-009)
- [ ] T073 [P] Assert the playback loading state by delaying a `page.route` stub on `**/api/playback/**`, and that it is scoped to one response (FR-032)
- [ ] T074 [P] Assert the 502 path — text still readable, retry offered (FR-033)
- [ ] T075 [P] Assert the 503 path — text still readable, `Listen` degraded, no retry (FR-034, SC-011)
- [ ] T076 [P] Assert a question with **ten** responses does not scroll horizontally at 402 px (SC-010, spec edge case)
- [ ] T077 [P] Assert no vote, rating, reaction, comment, reply, or best-answer control exists in the rendered tree (SC-008)
- [ ] T078 [P] Assert the four inbound `/yours` links from `ContributionOutcomeView` — `rate_limited`, `publishedQuestion`, `spent`, `lost` — now land on a real screen (plan divergence D-1)

### Cross-cutting

- [ ] T079 [P] Confirm participant-written text resolves through `--font-sans`, never `--font-display` — pinned by `tests/e2e/design.spec.ts`
- [ ] T080 [P] Confirm every helper and secondary string uses `--ink-65` or darker. `--ink-55` and `--ink-45` fail WCAG AA on `--bg` at body sizes, and 001's `design.md` sketch of this screen uses both
- [ ] T081 [P] Confirm every interactive element carries `outline: 2px solid var(--green); outline-offset: 3px;` and meets the 44 px minimum hit target
- [ ] T082 Run `make ai-checks` — format-check, lint, typecheck, unit, integration, secret-scan
- [ ] T083 Run `make e2e` locally. **CI does not run Playwright** — `.github/workflows/ci.yml` installs no browsers, so a finding only e2e can catch is a finding a green check will not catch
- [ ] T084 Run `make lhci` once before merge

---

## Dependencies

```text
Phase 1 (Setup) ─────────────┐
                             ├──> Phase 4 (US1) ──> Phase 5 (US2) ──> Phase 8
Phase 2 (Foundational) ──────┤                              │
                             └──> Phase 6 (US3) ────────────┘
Phase 3 (Playback engine) ───────> Phase 6 (US3)
                                        │
                                   Phase 7 (US4)
```

- **Phase 2 blocks everything.** No screen and no route without the columns and the queries.
- **Phase 3 blocks only US3.** US1 and US2 ship complete with no playback in existence — which is the point US4 exists to assert.
- **US1 → US2** share one page component, so they serialize on that file rather than on logic.
- **US4 depends on US1 and US3 both existing**, because it asserts a relationship between them.

## Parallel opportunities

| Group | Tasks | Why they are safe together |
| - | - | - |
| Row schemas | T007–T009 | three independent additions to `src/schema/rows.ts`, no shared symbol |
| History integration tests | T017–T021 | one new file, independent `describe` blocks |
| Playback integration tests | T022–T025 | one new file, independent `describe` blocks |
| WAV unit tests | T035–T036 | one new file |
| Produce unit tests | T037–T040 | one new file |
| e2e assertions | T070–T078 | one new file, independent tests |
| Cross-cutting checks | T079–T081 | read-only verification |

## Implementation strategy

**MVP is Phase 1 + Phase 2 + Phase 4 (US1).** That delivers the receiving half of the exchange —
a participant who asked a question finally sees what came back. It ships with no audio, no
`Your Answers`, and no provider dependency at all.

Then, in order of the spec's own priorities:

1. **US2** adds the giving half. One section, four tasks, no new infrastructure.
2. **US3** adds the voice. Phase 3 has to land first, and it is the only phase that spends money.
3. **US4** builds nothing. It is the phase where the laziness property gets asserted rather than assumed.

**Stop-and-ship points**: after Phase 4, after Phase 5, and after Phase 6. Each leaves a screen
that works and tells the truth about what it has.
