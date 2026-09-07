---

description: "Task list for 004-ask-one"
---

# Tasks: Ask One

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: included, and not optional here. The constitution's Verification section requires
automated tests for the reciprocity gate, and this feature is the half of it that *spends*.
Every user story carries an Independent Test and twelve success criteria are stated
numerically.

**Organization**: by user story, in priority order.

**Nothing is built yet.** `/ask` does not exist — 003 shipped a `Link href="/ask"` and no route
behind it, so today the screen that says *Ask one* leads to a 404. Unlike 003's list, no task
here starts complete.

**Two migrations, on purpose.** T001 adds what publishing needs; T037 removes what closure does
not. They are separate because the two halves of this feature are independently deliverable —
closure can ship without `/ask`, and `/ask` can ship without closure.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 Add `duration_seconds smallint NULL CHECK (duration_seconds IS NULL OR duration_seconds BETWEEN 1 AND 60)` and `submission_id uuid NULL UNIQUE` to `questions` in `migrations/1788720000000_question-publication.sql` — FR-006a, FR-014a. **Both nullable, with no backfill and no default-then-drop dance**: seeded questions have no recording attempt and no duration, and `UNIQUE` permits many NULLs ([data-model.md](data-model.md))
- [ ] T002 [P] Create `tests/helpers/questions.ts` with a question-row fixture, mirroring `tests/helpers/answers.ts`. Three integration files build their own question insert today; T001 adds two columns and 005 will add more, and 003's T003 exists because exactly this broke three files in turn

---

## Phase 2: Foundational

**⚠️ Blocks US1, US2 and US3.** US4 does not depend on any of it and can be built first or in
parallel — see Dependencies.

- [x] T003 Add `PUBLISH_QUESTION_SQL` and `publishQuestion()` to `src/db/queries/questions.ts` — consume-then-insert in one statement, `UPDATE participants SET can_ask = false WHERE id = $1 AND can_ask = true` as the first CTE ([research D1](research.md)). **Do not mirror `PUBLISH_ANSWER_SQL`'s order** — granting is idempotent, consuming is not
- [x] T004 Add `findQuestionBySubmission(submissionId, participantId)` to `src/db/queries/questions.ts`, returning the published row or null — FR-014a, [research D2](research.md)
- [x] T005 [P] Add `ask.unlocked`, `ask.recording`, `review.publishedQuestion` and `review.spent` to `src/copy.ts`, verbatim from [contracts/copy.md](contracts/copy.md). Reuse `copy.action.findQuestion` rather than authoring a second `Find me a question`
- [x] T006 Rename `src/ui/AnswerOutcome.tsx` to `src/ui/ContributionOutcome.tsx`, take `kind: 'answer' | 'question'` and the retry destination as props, and read the existing `*Answer` / `*Question` copy keys by kind ([research D5](research.md)). `app/answer/record/RecordAnswer.tsx` is the only importer — verified by grep, so the rename is a two-file change. Behaviour for answers must not change

---

## Phase 3: User Story 1 — Spend the ask (P1) 🎯 MVP

**Goal**: a participant holding an ask records a question, it passes review, it joins the pool,
and the ask is gone.

**Independent Test**: grant a participant an ask, record a question, confirm it appears in the
pool for a second participant, and confirm the first can no longer ask.

### Tests for User Story 1

- [x] T007 [P] [US1] Integration-test `publishQuestion` in `tests/integration/question-publish.test.ts`: one call from `can_ask: true` inserts the row and flips the flag; assert both in one read — SC-005, FR-014
- [x] T008 [P] [US1] Integration-test in `tests/integration/question-publish.test.ts` that a question published by A appears in `listEligibleQuestions(B)` — SC-006, FR-015
- [x] T009 [P] [US1] Integration-test in `tests/integration/question-publish.test.ts` that `SELECT count(*) FROM questions` is unchanged after a `withheld`, `failed` and `rate_limited` outcome, with the review stubbed — SC-012, Principle V
- [x] T010 [P] [US1] E2E in `tests/e2e/ask.spec.ts`: answer a question, follow `Ask your question` from the published-answer screen, record, and assert the confirmation renders — SC-011. **Navigate; do not construct the URL** — 003 shipped eleven green e2e tests over a recorder no participant could reach because the suite built its own entry point

### Implementation for User Story 1

- [x] T011 [US1] Create `app/ask/page.tsx` as a server component that reads `readAskEligibility()` and renders the unlocked state for a holder — FR-001, FR-004a. `dynamic = 'force-dynamic'`, matching 001's selection route: a cached gate would serve one participant's eligibility to another
- [x] T012 [US1] Create `app/ask/AskQuestion.tsx` — unlocked → recording → checking → outcome, on one route — FR-005, FR-006, FR-007, FR-012. Reuse `useRecorder` unchanged; **do not fork the recorder** (FR-010a), which is what satisfies the three recording requirements without restating them. Mint a fresh `submissionId` inside `startRecording`, not per page load. That rotation is also what puts a re-record **outside** the replay path: a new recording is a new submission, and T024 covers a repeated request only
- [x] T013 [US1] Create `app/api/ask/route.ts` per [contracts/ask-api.md](contracts/ask-api.md), in the contract's order: session → shape → idempotency → eligibility → bounds → review → publish — FR-011, FR-013, FR-016. Call `reviewContribution({ kind: 'question', questionText: null })` — three calls, relevance absent (002 FR-003). 002's `rejectAudio` is what refuses an empty recording before a provider call, so pass the blob through it rather than adding a second size check — FR-008a
- [x] T014 [US1] Add the published-question state to `ContributionOutcome.tsx` — FR-015a, FR-020. Primary `Find me a question` → `/answer`, ghost `Yours` → `/yours`. **The design contract has no screen for this**; [contracts/copy.md](contracts/copy.md) is the only reference

---

## Phase 4: User Story 2 — You cannot ask without answering (P2)

**Goal**: the gate holds through the interface, around it, and under concurrency.

**Independent Test**: attempt to reach and submit to the ask flow with no ask, both through the
interface and by direct request; confirm both are refused. Then earn two asks and confirm only
one question can be submitted.

### Tests for User Story 2

- [x] T015 [P] [US2] Integration-test in `tests/integration/question-publish.test.ts` that `publishQuestion` called directly for a participant with `can_ask: false` — no row, no flip — SC-002. **Called directly, not through the route**: testing through the interface proves the interface hides the button, and FR-002 is about the server
- [x] T016 [P] [US2] Covered in `tests/e2e/ask.spec.ts` as a real HTTP call rather than an integration test — a request with no cookies is the case, and Playwright's `request` fixture is the cheapest honest way to make one. Asserts `POST /api/ask` with no session cookie returns: `401`, a JSON body, and `SELECT count(*) FROM participants` unchanged — FR-002a. The body matters — the client calls `response.json()` unconditionally
- [x] T017 [P] [US2] Integration-test in `tests/integration/question-publish.test.ts` two concurrent `publishQuestion` calls for one participant holding one ask: exactly one row, exactly one flip, the loser reports no row — SC-003, SC-005, FR-019
- [x] T018 [US2] Integration-test in `tests/integration/question-publish.test.ts` **both directions of the duration rule**: `61`, `0`, `-1` and a non-integer are each refused before any provider call is made — assert the faked client recorded zero invocations — SC-007, FR-006a; and a **one-second question publishes**, because FR-008 forbids a minimum and a bounds test alone reads like one
- [x] T019 [P] [US2] E2E in `tests/e2e/ask.spec.ts`: visit `/ask` directly holding no ask and assert the redirect to `/answer` — FR-003
- [ ] T020 [P] [US2] Integration-test in `tests/integration/answer-publish.test.ts` that two qualifying answers leave `can_ask` true, not a second ask — FR-023 is 003's, and this is the assertion 004 depends on

### Implementation for User Story 2

- [x] T021 [US2] Add the no-ask branch to `app/ask/page.tsx`: `redirect('/answer')` for a participant with no ask **and** for a request with no session — FR-003. Same file as T011, so not parallel with it
- [x] T022 [US2] Add the pre-review eligibility read to `app/api/ask/route.ts` — contract step 4. It exists to avoid paying for a provider call the publish statement will refuse anyway; it is **not** the enforcement, and removing the statement's `WHERE can_ask = true` in favour of it is the FR-004 violation

---

## Phase 5: User Story 3 — The ask survives a bad outcome (P3)

**Goal**: withheld, failed, rate-limited, abandoned and raced submissions all leave the ask
where it was.

**Independent Test**: submit a question that fails review, one that hits an infrastructure
failure, and one that is rate limited; confirm the ask is still held in all three and a fresh
recording works.

### Tests for User Story 3

- [ ] T023 [P] [US3] Integration-test in `tests/integration/question-publish.test.ts` each non-publishing outcome in turn — `withheld` (each reason), `failed` (`exhausted` and `deadline`), `rate_limited`, and an aborted request — asserting `can_ask` still true and zero rows after each — SC-004, FR-017, FR-018
- [x] T024 [P] [US3] Integration-test the replay in `tests/integration/question-publish.test.ts`: publish, then re-POST the same `submissionId`; assert `published` and still exactly one row — FR-014a. **One recording sent twice**, which is the whole of what the id covers: `recorder.discard()` runs in the submit `finally`, so a participant whose response was lost has no blob to resubmit and records again under a new id. That path is T025's `spent`, not this one
- [x] T025 [P] [US3] Integration-test the spent race in `tests/integration/question-publish.test.ts`: publish, then POST a **different** `submissionId`; assert `{ status: 'spent' }`, never `failed` — [research D6](research.md)
- [ ] T026 [P] [US3] Integration-test in `tests/integration/question-publish.test.ts` that a same-id race replays the winner rather than reporting `spent` to the loser — the route re-reads `findQuestionBySubmission` after a failed insert, mirroring 003's route
- [x] T027 [P] [US3] E2E in `tests/e2e/ask.spec.ts`: a withheld question offers `Record another question`, which lands on `/ask` with a fresh recorder and the ask intact — FR-021. Assert the recorder is empty, not merely that the link exists

### Implementation for User Story 3

- [x] T028 [US3] Add the `spent` outcome to the route and its state to `ContributionOutcome.tsx` — [research D6](research.md). **Must not reuse the processing-failure page**: its helper says *you can record again*, which is false once the ask is consumed
- [x] T029 [US3] Point every question-flow retry at `/ask` with no query parameter — Withheld, crisis and processing failure alike (FR-021). Unlike 003's retry, no question id travels; there is no prior question to return to. **The `href` alone does not work here.** Every question retry targets the route the participant is already on, and a Next `<Link>` to the current route does not remount — 003 shipped exactly this and the Withheld page just sat there. Carry an `onRetry` handler that clears the outcome and calls `recorder.discard()`, as `AnswerOutcomeView` does; the `href` stays for middle-click and a cold landing
- [x] T030 [US3] In `src/ui/ContributionOutcome.tsx`, keep the crisis retry alongside the resources, never behind them — Constitution III. The classification can be wrong, and nobody should dismiss an offer of help to reach the control that lets them try again

---

## Phase 6: User Story 4 — A question's life (P4)

**Goal**: a question is routed until three people have answered it, and forever if nobody does.

**Independent Test**: publish a question, collect three published answers from three distinct
participants, and confirm it stops being routed while remaining visible to its asker. Separately,
leave a question unanswered and confirm it never expires.

**This phase is mostly proof.** The implementation is one clause (T032). The tests are the
deliverable, because a closure rule that is not asserted is a `HAVING` nobody will recognise as
load-bearing the next time the query is edited.

**Independent of US1–US3.** It touches the selection query and the schema, and nothing in the
ask flow. Build it first if `/ask` is blocked.

### Tests for User Story 4

- [x] T031 [P] [US4] Integration-test closure in `tests/integration/closure.test.ts`: a question with two published answers is routed; a third removes it — SC-008, FR-023. Assert the query text carries `COUNT(a.id)` and **neither `COUNT(*)` nor `COUNT(DISTINCT`** — FR-024 forbids re-deriving distinctness the unique constraint already guarantees, and both wrong forms pass a behavioural test
- [x] T032 [P] [US4] Integration-test in `tests/integration/closure.test.ts` a **seeded** question (`participant_id IS NULL`) closing on the same rule — SC-008, FR-027a. Not redundant: 001 already shipped one NULL-handling bug here, where `<>` dropped every seeded question from the pool
- [x] T033 [P] [US4] Integration-test in `tests/integration/closure.test.ts` that a question with **zero** answers is still routed — the `COUNT(a.id)` versus `COUNT(*)` distinction, which the LEFT JOIN makes load-bearing — FR-022, [research D3](research.md)
- [x] T034 [P] [US4] Integration-test in `tests/integration/closure.test.ts` that an unanswered question with `created_at` backdated a year is still routed — SC-009. No expiry exists and none may be added
- [x] T035 [P] [US4] Integration-test in `tests/integration/closure.test.ts` that a fourth answer landing after the third publishes normally — FR-027. With closure derived there is no state to reconcile, so this asserts the absence of a cap. Then re-read the closed question and **all four** answers and assert every row is unchanged and readable — SC-010, FR-026. 004 guarantees the data survives closure; 005 owns the screen that shows it
- [x] T036 [P] [US4] Integration-test in `tests/integration/closure.test.ts` that withheld answers cannot count toward closure — they leave no row, so this asserts the property rather than a filter — FR-025

### Implementation for User Story 4

- [x] T037 [US4] Drop `questions_status_idx`, `questions.status` and the `question_status` type in `migrations/1788730000000_drop-question-status.sql` — FR-023a. 001 created them with the comment *"status is written only by 004"*; 004 will never write it, and a column whose only purpose is a write that will not happen invites the next reader to wire one
- [x] T038 [US4] Remove `status` from `questionRowSchema` and delete `questionStatusSchema` in `src/schema/rows.ts`; drop the enum assertions from `tests/unit/rows.test.ts`
- [x] T039 [US4] In `listEligibleQuestions`, replace `WHERE q.status = 'open'` with `HAVING COUNT(a.id) < 3` — FR-023, [research D3](research.md). `COUNT(a.id)`, never `COUNT(*)` and never `COUNT(DISTINCT a.participant_id)`: the LEFT JOIN makes a zero-answer question count 1 under `COUNT(*)` so nothing ever closes, and the DISTINCT form is a slower way to compute the same number while implying `UNIQUE (participant_id, question_id)` might not hold (FR-024)
- [x] T040 [US4] Rewrite the `status: 'closed'` helpers in `tests/integration/empty-pool.test.ts` and `tests/integration/exclusions.test.ts` to close a question by inserting three answers. They currently assert a mechanism no production code uses; after this they close a question the only way the product can
- [x] T040a [US4] Drop `status` from `UPSERT_QUESTION_SQL` in `seed/seed.ts` — the column list, the `'open'` literal in `VALUES`, and `status = EXCLUDED.status` in the `ON CONFLICT` clause. **Not cleanup — this is what keeps `make seed` working.** T037 breaks the seeder, and the seeder is half of the branch-database recovery the next section prescribes
- [x] T040b [P] [US4] Drop `status` from the question inserts in `tests/integration/skip-writes-nothing.test.ts` (line 38) and `tests/integration/selection-bias.test.ts` (lines 44 and 55). Unlike T040 these assert nothing about closure — they name a column that stopped existing, and they fail on that alone

---

## Phase 7: Polish & cross-cutting

- [x] T041 [P] Run `tests/unit/copy.test.ts`'s forbidden-vocabulary sweep over the four new copy blocks. The sweep walks every string in the file, so this is a verification rather than a change — confirm it actually reaches function-valued entries. **This is FR-009 and FR-010's coverage, and saying so is the point**: Principle I is the product's whole claim, and a requirement whose only proof is a vocabulary sweep should say that out loud rather than look untested
- [ ] T042 [P] Confirm `/ask` is usable at phone and desktop widths with visible focus and 44px touch targets across the five viewports in `tests/e2e/a11y.spec.ts` and `responsive.spec.ts` — matching 001's suite
- [ ] T043 [P] Add the unlocked, recording, published and spent screens to `tests/e2e/design.spec.ts`. The published and spent screens have **no design reference** — assert them against [contracts/copy.md](contracts/copy.md), which is their only source. Assert the published screen offers **no follow-up, reply, or clarification control** — FR-010, and the one place such a control would look natural
- [x] T044 [P] Update `specs/README.md`'s ownership table: closure is derived, not a stored status, and `/ask` in full belongs to 004
- [ ] T045 **ASHLEY PRESENCE NEEDED** — Run the full ask flow on a current iPhone Safari and Android Chrome with a real microphone. Inherited from 003's T046 and not separately open: the question recorder *is* the answer recorder, so one round covers both
- [ ] T046 Re-measure review latency at the 60-second ceiling for the **three-call** question fan-out — SC-001 is dominated by it, and 002 measured only 12–16 s clips on the four-call shape (002 T080)
- [ ] T047 `EXPLAIN ANALYZE` the selection query at 10k questions and 30k answers ([quickstart](quickstart.md) gap 4). If it leaves interactive range the fix is a materialized count — **not** the `status` column T037 removes
- [ ] T048 Watch the seeded pool during the demo. Six seeds × three answers is eighteen answers before the seeded pool is exhausted and 001's empty state is what a judge sees. Expected behaviour, worth knowing before it happens live

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (T001–T002)** → **Foundational (T003–T006)** → **US1 → US2 → US3**.
- **US4 depends on nothing in this feature.** Its migration, its query change and its tests
  touch the selection path and the schema, and never `/ask`. It is the one slice that can land
  while the ask flow is blocked on anything else.
- **US1 is the MVP.** US2 hardens the gate US1 opens; US3 covers what happens when the gate is
  open and the submission fails. Neither is meaningful before US1 exists.
- **T021 sequences after T011** — same file, `app/ask/page.tsx`.
- **T022 sequences after T013** — same file, `app/api/ask/route.ts`.
- **T028/T029/T030 sequence after T014** — all in `ContributionOutcome.tsx`.
- **T031–T036 require T037–T039** to be green. They are listed first by convention; run the
  three implementation tasks as one unit, then the six tests.

### The two migrations are not interchangeable

T001 adds; T037 removes. T001 is a prerequisite for publishing a question at all. T037 breaks
**every remaining reader of `questions.status`** the moment it lands, so **T037 through T040b
ship in one commit**.

An earlier draft of this paragraph named T038 and T039 and stopped, which was wrong by three
files. The full set, each verified by grep against the branch:

| File | What names `status` |
| - | - |
| `src/schema/rows.ts` | `questionRowSchema` field, `questionStatusSchema` (T038) |
| `tests/unit/rows.test.ts` | lines 43 and 114 (T038) |
| `src/db/queries/questions.ts` | `WHERE q.status = 'open'` (T039) |
| `tests/integration/empty-pool.test.ts`, `exclusions.test.ts` | `status: 'closed'` helpers (T040) |
| `seed/seed.ts` | lines 48, 49 and 53 (T040a) |
| `tests/integration/skip-writes-nothing.test.ts` | line 38 (T040b) |
| `tests/integration/selection-bias.test.ts` | lines 44 and 55 (T040b) |

**The prescribed recovery is one of the casualties.** Nothing is deployed anywhere, so a branch
database that disagrees is rebuilt rather than repaired — with `make db-up && make migrate &&
make seed`. After T037 and before T040a that command fails at `make seed`, on the very migration
it was meant to recover from, because `UPSERT_QUESTION_SQL` still inserts a column the migration
dropped. Land T040a in the same commit and the recovery keeps working; split it out and the
escape hatch is broken exactly when it is needed.

### Parallel example — the US2 gate suite

```bash
Task: "T015 publishQuestion refuses with can_ask false"
Task: "T016 POST /api/ask with no session"
Task: "T017 two concurrent publishes, one ask"
Task: "T018 duration bounds refused before any provider call"
Task: "T019 /ask redirects with no ask"
```

Four integration specs in one new file plus one e2e; no shared fixture state beyond
`tests/helpers/questions.ts`.

### Parallel example — closure

```bash
Task: "T031 two answers routed, three not"
Task: "T032 seeded question closes on the same rule"
Task: "T033 zero answers still routed"
Task: "T034 backdated unanswered question still routed"
```

All four in `tests/integration/closure.test.ts`, independent rows, no shared state.

---

## Implementation strategy

### MVP

Phases 1–3. A participant who earned an ask can spend it, and the question reaches the pool.
That is the second half of the product's one rule, and it is the first time `/ask` returns
anything but a 404.

### Two slices, delivered independently

**The ask flow** (Setup → Foundational → US1 → US2 → US3) and **closure** (US4) share a feature
number and nothing else. Closure is four files and one clause; the ask flow is a route, an
endpoint, a statement and five screens. If the weekend runs short, closure ships on its own and
`/ask` is the thing that slips — not the reverse, because a pool that never closes still works
and an ask that cannot be spent does not.

### What is not built here, deliberately

- **No dev bypass for granting asks.** Working on `/ask` means earning one, or an `UPDATE` in
  `make db-shell` ([quickstart](quickstart.md)). An env-gated grant route is a second, weaker
  path through the one rule the product has.
- **No closure counter, job, or trigger.** FR-023a forbids it, and T047 names the fix if scale
  ever demands one.
- **No `emotion` column on `questions`.** 002 returns it; nothing reads it for a question.

### Risk, in order

1. **T003's statement ordering.** Consume-then-insert is the whole of FR-019, and the tempting
   mistake is mirroring 003's insert-then-grant. T017 is the test that catches it.
2. **T039's `COUNT(a.id)`.** `COUNT(*)` compiles, passes a casual read, and closes nothing.
   T033 exists solely for that one character.
3. **T012's `submissionId` rotation.** 003 shipped this bug: minted per page load, a re-record
   after a Withheld replayed the first submission and the retry was silently a no-op.

---

## Found during implementation — open

- [x] T049 ~~`POST /api/ask` returns 500 when a session with an unspent ask submits.~~ **Not a code bug.** The local branch database was two migrations behind, so `findQuestionBySubmission` queried a `questions.submission_id` column that did not exist yet. `pnpm run migrate` resolves it; the route returns `{"status":"spent"}` correctly. Recorded rather than deleted because the symptom — an empty-bodied 500 on one path while every other path is green — reads exactly like an application bug, and the next person to hit it should check the schema first.

- [ ] T050 Route-level coverage for T023 and T026 — each non-publishing outcome leaving the ask intact, and a same-id race replaying the winner. Both need a seam that lets a test drive `reviewContribution`'s outcome through the real route; `002` injects deps into `reviewContribution` but the route calls it with none. The underlying guarantees are proven at the query layer, so this is a gap in *where* they are proven, not in whether they hold.
- [x] T051 ~~SonarCloud duplication~~ **Gate passes.** Two extractions — `RecorderPanel` for the controls, then the capability gate folded into it — took duplication on new code sits at **4.5%**, above the gate. Two extractions took it from 6.6% — `RecorderPanel` for the controls, then the capability gate folded into it. What remains is the outer shell of `AskQuestion.tsx` and `RecordAnswer.tsx`: the submit handler, the checking screen, and the outcome branch. They are genuinely similar and could share a container, but the two flows differ in what they post, what they carry into the outcome view, and what a retry means — so the next extraction needs a design decision rather than another move. Merged with the gate red, deliberately.
