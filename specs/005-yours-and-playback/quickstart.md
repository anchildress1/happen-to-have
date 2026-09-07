# Quickstart: Yours and Playback

How to prove each success criterion, and — the part that matters more — what this feature does
**not** prove.

---

## Setup

```bash
make install
make db-up          # creates and checks out a Neon branch for this git branch
make migrate        # applies migrations/1788740000000_answer-playback.sql
make seed           # idempotent upsert of seed/questions.json
```

`.env` needs `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `SESSION_SECRET` (≥32 chars), and
`GEMINI_API_KEY`. Only the last is needed for playback, and **only for playback** — SC-011 below
is the test that it is not needed for anything else.

```bash
make dev            # http://localhost:3000/yours
```

---

## Running the suites

| Command | Covers | Costs money? |
| - | - | - |
| `pnpm test` | unit — WAV wrapping, mime validation, coalescing, the TTS call shape | no |
| `pnpm run test:integration` | PGlite — the three queries, scoping, ordering, produce-once | no |
| `make e2e` | Playwright on a throwaway Neon branch — the screen, empty states, `Listen` | no (`/api/playback` is stubbed) |
| `make ai-checks` | format-check, lint, typecheck, unit **and** integration, secret-scan | no |

**Nothing in the suite calls the real TTS endpoint.** The provider is faked at the `GenAiClient`
seam in unit tests and the route is stubbed with `page.route` in e2e, matching how 002–004 handle
the review calls. A live TTS run is a manual step — see [Manual verification](#manual-verification).

**CI runs unit and integration, not e2e.** `.github/workflows/ci.yml` has no browser install and
no Playwright step; e2e is gated by the local pre-push hook only. A finding that only e2e can
catch is a finding CI will not catch — worth knowing before trusting a green check.

---

## Proving each success criterion

### SC-001 — every response visible as text within two seconds of opening `Yours`

```bash
make dev
```

Seed a participant with a published question carrying three responses (see
[Seeding a full history](#seeding-a-full-history)), open `/yours`, and read the server timing.

- The render runs **three SQL statements and no provider call**. That is the budget.
- Automated floor: `tests/integration/yours-history.test.ts` asserts all three responses come back
  from the queries. The two-second wall-clock is a deployment property, not a unit test.

### SC-002 — text readable before any audio exists, 100% of cases

Structural, and proved two ways:

1. **Integration**: publish an answer, then assert `generated_audio IS NULL` on the row while its
   `display_text` reads back intact. Publication has no audio write path to exercise.
2. **The screen**: the render queries select `generated_audio IS NOT NULL AS has_playback` and
   never the bytes, so the text cannot wait on audio that is not fetched.

### SC-003 — zero audio produced for contributions nobody requested

One query. This is why NULL is the stored assertion rather than a placeholder:

```sql
SELECT count(*) FROM answers WHERE generated_audio IS NOT NULL;
```

Compare against the number of `Listen` requests. Publish ten answers, request playback on two,
expect `2`.

- `tests/integration/playback-cache.test.ts` asserts the count is `0` after publishing and before
  any request.

### SC-004 — a repeated `Listen` produces zero additional audio

- **Integration**: call the cache read twice; assert the second is a hit and the fake
  `GenAiClient` recorded exactly one `generateContent`.
- **Manual**: press `Listen` twice on the same response and watch the network panel — the second
  request returns the same bytes with no provider latency.

### SC-005 — concurrent first requests result in exactly one production

Two halves, because PGlite cannot construct a real race.

1. **In-process coalescing** (unit): fire two `producePlayback` calls for the same answer id
   without awaiting between them; assert the fake client saw one call and both callers got the
   same buffer.
2. **The storage guard** (integration): the `UPDATE … WHERE generated_audio IS NULL` statement is
   asserted structurally — the same technique `tests/integration/question-publish.test.ts` uses
   for its consume-then-insert ordering, and for the same reason: PGlite serializes on one
   connection, so a `Promise.all` proves nothing about concurrency.

**Not proved, and stated in [research D2](research.md)**: two Cloud Run instances racing. Exactly
one row results either way; a duplicate *spend* of a fraction of a cent is possible and accepted.

### SC-006 — zero original recordings exposed, offered, or playable

Proved by absence, which is the strongest form available here:

```bash
rg -n 'original|recording' src/db src/playback app/yours app/api/playback
```

- No column holds original audio ([data-model](data-model.md)).
- No route serves it.
- By the time an answer row exists, 003's route has already released the recording.
- `tests/e2e/yours.spec.ts` asserts no `<audio>` element or control on the page references
  anything but the playback endpoint.

### SC-007 — zero pending/withheld/failed/abandoned submissions in history

- **Integration**: run a withheld and a failed submission through, then assert `Yours` returns
  nothing for either and no row exists to return.
- Structural: there is no status column and no unpublished row to filter out. Still true from
  001; this feature adds no way to change it.

### SC-008 — zero ranking, scoring, voting, rating, reaction, or best-answer controls

- **e2e**: assert the rendered `/yours` tree contains no `button`, `input`, or `[role]` other than
  the `Listen` controls and the header link.
- **Review**: [contracts/yours-view.md](contracts/yours-view.md) carries the must-not-render table.
  A control that appears there and in the DOM is a review failure, not a test failure.

### SC-009 — both empty states, the loading state, and the failure state each render

Four induced cases in `tests/e2e/yours.spec.ts`:

| State | How it is induced |
| - | - |
| No published answers | fresh session, open `/yours` |
| No published questions | same session |
| Question with zero responses | publish a question, answer nothing |
| Playback loading | `page.route` on `**/api/playback/**` delayed before fulfilling |
| Playback failed | same route fulfilled `502` — assert text still readable **and** a retry offered |
| Playback unavailable | same route fulfilled `503` — assert text still readable and **no** retry |

Zero blank or errored screens in all six.

### SC-010 — renders on current iPhone and Android browsers, including 10+ responses

- `playwright.config.ts` already runs five viewports: 402, 767, 768, 1100, 1440.
- `tests/e2e/yours.spec.ts` seeds a question with **ten** responses and asserts no horizontal
  scroll at 402 px: `document.documentElement.scrollWidth <= clientWidth`.
- Real-device check is manual and is the only way SC-010's exact wording is satisfied.

### SC-011 — with playback unavailable, 100% of text still renders

The sharpest one, and the easiest to run:

```bash
GEMINI_API_KEY= pnpm run build && GEMINI_API_KEY= pnpm exec next start -p 3210
```

Open `/yours`. Expect the full history — both sections, every response, every word — and `Listen`
degraded.

- This works because `app/yours/page.tsx` never imports `src/playback/`. The provider client is
  constructed lazily inside the route handler and nowhere else.
- Automated equivalent: `tests/e2e/yours.spec.ts` fulfils the playback route with `503` and
  asserts every response's text is present.

---

## Seeding a full history

There is no helper for this; each integration file builds what it needs, per house style. The
shape:

```sql
-- the participant whose Yours this is
INSERT INTO participants DEFAULT VALUES RETURNING id;              -- $me

-- a question they published
INSERT INTO questions (participant_id, display_text, duration_seconds, submission_id)
VALUES ($me, 'How do you tell somebody no without burning the bridge?', 22, gen_random_uuid())
RETURNING id;                                                     -- $q

-- three responses from three strangers
INSERT INTO participants DEFAULT VALUES RETURNING id;             -- ×3
INSERT INTO answers (question_id, participant_id, display_text, duration_seconds, submission_id)
VALUES ($q, $other, 'Say it once, kindly, and do not explain twice.', 11, gen_random_uuid());
```

`tests/helpers/answers.ts` already has `insertPublishedAnswers(db, questionId, participantIds)`
for the last step. Note `UNIQUE (participant_id, question_id)` — three responses need three
distinct participants, which is what the constraint is there to guarantee.

---

## Manual verification

Two things the automated suite deliberately does not do.

### 1. Hear the voice

The one check that cannot be faked, because the whole point is how it sounds.

```bash
make dev
```

Publish an answer, open `/yours` as the asker, press `Listen`.

Listening for:

- **It is `Sulafat`** — warm, not upbeat, not consoling.
- **It is the processed text**, word for word. Not a summary, not an embellishment (Principle I).
- **It is not an Appalachian performance** (Principle VII). If it sounds like a character, the
  voice is wrong.
- **The same voice everywhere** (FR-025). There is only one constant, so this is a read of
  `src/playback/voice.ts` as much as a listen.

### 2. Cost and latency of a first `Listen`

Time it once. It is a `gemini-3.1-flash-tts-preview` call on ≤2000 characters and it is why
FR-032's per-response loading state exists.

---

## What is NOT proved here

Stated plainly, because a quickstart that implies full coverage is worse than none.

| Not proved | Why | Where it is recorded |
| - | - | - |
| Cross-instance concurrent production | Needs two Cloud Run instances. One stored row is guaranteed regardless. | [research D2](research.md) |
| The two-second SC-001 wall clock | A deployment property. The suite proves the query count; latency is measured against the deployed service. | — |
| Real TTS output quality | Every automated run fakes the provider. Deliberate: a suite that bills money on every push is a suite people stop running. | `Makefile`'s `fixtures` target does the same for review, and is excluded from `ai-checks` for the same reason |
| Real-device Safari and Chrome | Playwright runs Desktop Chrome at five viewports. Viewport is not a browser engine. | inherited from 001–004 |
| Lighthouse / perf budgets | `make lhci` is a pre-push hook step, not CI. | run once before merge |
| e2e in CI | `.github/workflows/ci.yml` installs no browsers. | noted above; a local `make e2e` before merge is the gate |
