---

description: "Task list for 003-answer-and-unlock"
---

# Tasks: Answer One

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: included. Every user story in the spec carries an Independent Test, and ten success
criteria are stated numerically — both are only meaningful as executable checks.

**Organization**: by user story, in priority order.

⚠️ **T023, T024, T035, T036 and T037 were marked complete in an earlier revision of this file
and the tests did not exist.** Seven ids were bulk-ticked after one e2e file landed, without
checking which subjects it covered. Two review subagents found it. They are written and
mutation-verified now; the episode stays recorded here because a task list nobody can trust is
worse than no task list.

⚠️ **Much of this feature was built before the plan existed**, because 002's engine did not
exist and 003 could not be demonstrated without it. Completed tasks are marked `[x]` and carry
the PR that landed them. The remaining work is mostly what the plan's audit found and what
quickstart.md lists as unproven — which is the honest state, not a formality.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 Add `display_text`, `source_language`, nullable `emotion` to `answers` in `migrations/1788700000000_answer-text.sql`, bounded to match `questions.display_text` (#25)
- [x] T002 Add `duration_seconds smallint CHECK BETWEEN 1 AND 60` and `submission_id uuid UNIQUE` in `migrations/1788710000000_answer-duration-idempotency.sql` — FR-013, FR-015 (#25)
- [ ] T003 Consolidate the answer-row fixture used by `tests/integration/{empty-pool,exclusions,selection-bias}.test.ts` into `tests/helpers/answers.ts`. **Two NOT NULL columns have now broken all three files in turn**, each with a different insert shape; a third will do it again

---

## Phase 2: Foundational

**⚠️ Blocks every user story.** 003 returns a decision it did not make; without 002's module
there is nothing to act on.

- [x] T004 Build 002's review engine — prompts, gate, `reviewContribution()` in `src/review/` (#24)
- [x] T005 Create `src/db/queries/answers.ts` with `PUBLISH_ANSWER_SQL` — eligibility, insert and ask grant in one statement ([research D2](research.md)) (#25)
- [x] T006 Add `getQuestionText()` to `src/db/queries/questions.ts` so the server reads the question rather than trusting the client — FR-018 (#25)
- [ ] T007 Add `readAskEligibility(participantId)` to `src/db/queries/answers.ts` returning `can_ask`, for FR-024/FR-025 and 004's gate. Server-authoritative; the client's view is advisory only

---

## Phase 3: User Story 1 — Record an answer and earn an ask (P1) 🎯 MVP

**Goal**: a relevant answer publishes under its question and grants exactly one ask.

**Independent Test**: with a seeded pool and a working review, record a relevant answer and
confirm it publishes and the participant is told an ask is available.

### Tests for User Story 1

- [x] T008 [P] [US1] Integration-test publish-and-grant in `tests/integration/answer-publish.test.ts`: `askGranted` true from `can_ask: false`, false from `can_ask: true` — SC-003, FR-021 (#25)
- [x] T009 [P] [US1] Integration-test that eligibility refuses own-question and already-answered **by calling the query directly**, bypassing the interface — SC-006, FR-016 – FR-018 (#25)
- [x] T010 [P] [US1] Integration-test that a seeded question (NULL author) is answerable — `IS DISTINCT FROM`, not `<>` ([research D2](research.md)) (#25)
- [x] T011 [P] [US1] Integration-test both duplicate guards on the statement itself; removing either alone leaves every behavioural test green (#25)
- [x] T012 [P] [US1] Integration-test idempotency: `findBySubmission` resolves a retried upload, refuses another participant's id, and a reused id cannot insert twice — SC-007 (#25)
- [ ] T013 [P] [US1] Integration-test SC-004: ask eligibility is false while a submission is in flight and no grant exists before the decision — FR-022
- [x] T014 [P] [US1] E2E in `tests/e2e/answer.spec.ts`: record → checking → published, asserting `Your answer counts. Ask one.` verbatim — FR-020

### Implementation for User Story 1

- [x] T015 [US1] Create `app/api/answer/route.ts`: session, shape, idempotency, bounds, question, review, publish — in that order, per [contracts/answer-api.md](contracts/answer-api.md) (#25)
- [x] T016 [US1] Return every terminal outcome as `200` with a decision body; `401` with no session, `499` on abort (#25)
- [x] T017 [US1] Render published, withheld, crisis, rate-limited and failed in `src/ui/AnswerOutcome.tsx` (#25)
- [x] T018 [US1] Fix the success copy to FR-020's verbatim `Your answer counts. Ask one.` in `src/copy.ts` — plan divergence D-1
- [x] T019 [US1] Distinguish `granted` from `alreadyHeld` in the published helper — FR-021; claiming a grant that did not happen is the lie the reciprocity rule cannot survive
- [ ] T020 [US1] Point the published action at `/ask` once 004 exists; today it links to a route that 404s

---

## Phase 4: User Story 2 — The minute (P2)

**Goal**: sixty seconds, stopped on its own, nothing lost, nothing that reads as a failure.

**Independent Test**: record past sixty seconds in a mobile and a desktop browser and confirm
the recording stops at the ceiling with the audio intact.

### Tests for User Story 2

- [x] T021 [P] [US2] Unit-test format selection in `tests/unit/recorder.test.ts`: WebM preferred, MP4 fallback, null when nothing is supported, and that the types stay codec-qualified (#25)
- [x] T022 [P] [US2] Integration-test the duration CHECK at both boundaries and that five seconds publishes — FR-013, SC-008
- [x] T023 [P] [US2] E2E: record past sixty seconds and assert the recorder stopped itself, the blob is non-empty, and the ceiling line renders — SC-002, FR-007
- [x] T024 [P] [US2] E2E: the elapsed/remaining readout updates and is announced — FR-005

### Implementation for User Story 2

- [x] T025 [US2] Create `src/ui/useRecorder.ts` with `MediaRecorder`, the 60 s ceiling on an interval owned by the recording state, and microphone release on stop and unmount (#25)
- [x] T026 [US2] Pick the mime type with `isTypeSupported` ([research D6](research.md)) — a hard-coded type records an empty blob on one of the two target platforms (#25)
- [x] T027 [US2] Re-check the declared duration server-side in `app/api/answer/route.ts` — FR-013, plan divergence D-3
- [ ] T028 [US2] **ASHLEY PRESENCE NEEDED** — Measure bytes-per-second for a 60 s recording in each target browser and narrow the byte bound to it ([research D3](research.md)). Until then the check is a bound, not a verification, and the contract says so

---

## Phase 5: User Story 3 — Waiting for the verdict (P3)

**Goal**: the unlock happens after the decision, never at the end of recording.

**Independent Test**: submit an answer and, while review is in flight, attempt to reach the ask
flow directly. Confirm it is refused, then confirm it opens once review passes.

### Tests for User Story 3

- [ ] T029 [P] [US3] Integration-test that no ask is granted at any point before `status === 'publish'` — FR-022, SC-004
- [ ] T030 [P] [US3] Integration-test concurrent unlock: two passing answers to different questions submitted together leave exactly one unspent ask — SC-005, spec assumption
- [x] T031 [P] [US3] E2E: the checking state blocks, offers no action, and is announced via `aria-live` — FR-012, 002 FR-029

### Implementation for User Story 3

- [x] T032 [US3] Grant the ask inside the publishing statement, guarded by `can_ask = false` — FR-021, FR-023 (#25)
- [x] T033 [US3] Render checking as a blocking state with no actions in `app/answer/record/RecordAnswer.tsx` (#25)
- [ ] T034 [US3] Refuse the ask flow server-side for a participant holding none, including direct requests — FR-025. Belongs to 004's route but the eligibility read is T007

---

## Phase 6: User Story 4 — When recording will not work (P4)

**Goal**: three failure causes, three messages, no dead screens.

**Independent Test**: deny microphone permission, then interrupt a recording mid-way, and
confirm each produces a clear state with a way forward.

### Tests for User Story 4

- [x] T035 [P] [US4] E2E: deny permission and assert the denial copy, not the processing-failure helper — FR-028, and the exact confusion plan divergence D-5 records
- [x] T036 [P] [US4] E2E: stub `MediaRecorder` away and assert the unsupported message renders **instead of** the control — FR-029
- [x] T037 [P] [US4] E2E: navigate away mid-recording and assert nothing was submitted and `can_ask` is unchanged — FR-030, SC-010

### Implementation for User Story 4

- [x] T038 [US4] Split `RecorderState` into `denied`, `noDevice` and `unsupported`, keyed off `NotAllowedError` versus `NotFoundError` ([research D5](research.md)) — plan divergence D-5
- [x] T039 [US4] Add the three copy blocks to `src/copy.ts` and render each with its own heading and helper
- [x] T040 [US4] Check `canRecord()` before rendering the control, not after pressing it — FR-029
- [ ] T041 [US4] **ASHLEY PRESENCE NEEDED** (to verify; the handling itself is mine) — Handle a backgrounded tab and a locked screen: whatever was captured is submittable or discarded cleanly, never ambiguous — spec edge case

---

## Phase 7: Polish & cross-cutting

- [x] T042 [P] Retry at `/answer/record?questionId=<same>` from every Withheld including crisis — FR-027a, plan divergence D-2
- [x] T043 [P] Rename the route's query parameter to `questionId`, matching 001's `QuestionCard` — plan divergence D-6
- [ ] T044 [P] Sweep `tests/unit/copy.test.ts`'s forbidden vocabulary over the new recording and published strings; the sweep already covers every string in the file, so this is a verification, not a change
- [ ] T045 [P] Confirm `/answer/record` is usable at phone and desktop widths with visible focus and 44px targets — FR-031, matching 001's a11y suite
- [ ] T046 **ASHLEY PRESENCE NEEDED** — Run the full flow on a current iPhone Safari and Android Chrome with a real microphone — SC-009. **Every recording so far has been a faked media stream; no real microphone has recorded into this app**
- [ ] T047 Re-measure review latency at the 60-second ceiling — SC-001 is dominated by it, and 002 measured only 12–16 s clips (002 T080)
- [ ] T048 Delete the answer-row fixture duplication T003 consolidates, and confirm a third NOT NULL column breaks nothing

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)** → **Foundational (P2)** → user stories.
- **US1 is the MVP** and blocks nothing else logically, but US3's grant timing is enforced by
  the same statement, so US1's implementation lands US3's core.
- **US2 and US4 are independent of each other** and both touch `useRecorder.ts` — sequence them
  or accept a conflict.
- **T020 and T034 block on 004** existing. They are listed here because the requirement is
  003's; the route is not.

### Parallel example — the remaining e2e

```bash
Task: "T023 record past sixty seconds"
Task: "T035 deny microphone permission"
Task: "T036 unsupported browser"
Task: "T037 navigate away mid-recording"
```

All four are new files or independent specs in `tests/e2e/answer.spec.ts`.

---

## Implementation strategy

### MVP

Phases 1–3. Record an answer, have it judged, publish it, earn an ask. That is the product's
rule and everything else either protects it or spends it.

### What is actually left

Of 48 tasks, **34 are complete**. The remainder is three groups:

1. ~~**E2E coverage**~~ — done, and done properly the second time. `answer.spec.ts` (15 tests)
   plus `answer-denied.spec.ts`, across 5 viewports. The suite navigates from `/answer` through
   the real link and reads ids back out of the URL the app produced; it no longer builds its
   own entry point, which is what let it report FR-002 green while the feature was broken.
   Chromium's fake device is scoped per spec rather than added to the shared config, so no
   other suite silently acquires a microphone.
2. **Measurements** (T028, T046, T047) — the byte bound has no measured basis, no real
   microphone has been used, and the latency figure is inherited from short clips. T028 and
   T046 are marked **ASHLEY PRESENCE NEEDED**: they need real devices, and no amount of
   Playwright substitutes for one. T047 needs 60 s recordings, which T046 produces.
3. **004-blocked** (T020, T034) — the ask flow does not exist yet.

T046 is the one where being wrong is not recoverable by a later fix: it is the whole feature,
on the only devices that matter, and it has never been done.
