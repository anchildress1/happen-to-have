---

description: "Task list for 002-contribution-review"
---

# Tasks: Contribution Review

**Input**: Design documents from `/specs/002-contribution-review/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/review.md](contracts/review.md),
[contracts/copy.md](contracts/copy.md)

**Tests**: included. The spec carries 12 success criteria, design.md carries a 002 test-obligations
table, and the constitution requires a validation loop. This is the highest-risk feature in the
split — the one where being wrong causes harm outside the software.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable — different file, no dependency on an incomplete task
- **[Story]**: US1–US5, matching spec.md's user stories
- Every task names its file

## Path conventions

Single Next.js project at the repository root, established by 001. 002 adds `src/review/`, four
components in `src/ui/`, one migration, and fixtures. It adds **no route** — 003 and 004 own the
endpoints that call this module ([research D10](research.md)).

---

## Phase 1: Setup

**Purpose**: dependency, secret, and the fixture set the guardrail suite runs on.

- [ ] T001 Install `@google/genai` 2.21.0 as a production dependency in `package.json`; do not add any other provider SDK
- [ ] T002 [P] Add `HTH_RATE_LIMIT_MAX` and `HTH_RATE_LIMIT_WINDOW_SECONDS` to `.env.example` with commented defaults and the Secret Manager id convention, matching the existing `GEMINI_API_KEY` entry
- [ ] T003 [P] Create `tests/fixtures/audio/` and commit the 16 spike recordings; note in a sibling `README.md` that they are generated speech, not participant data
- [ ] T004 [P] Create `tests/fixtures/cases.ts` carrying each fixture's id, kind, question text, and adjudicated `{ illegal, crisis, relevant }` labels from [research D11](research.md)
- [ ] T005 [P] Add a `fixtures` target to the `Makefile` that runs the live-provider fixture script, kept out of `ai-checks` so the default loop stays free and deterministic ([research D12](research.md))

**Checkpoint**: the SDK is installed, the secret is documented, and the regression set exists.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: everything every check needs. No user story can start until this is done.

**⚠️ CRITICAL**: T006–T020 block all of Phase 3 onward.

### Provider client

- [ ] T006 Create `src/review/client.ts` with `import 'server-only'`, a lazily constructed `GoogleGenAI` from `process.env.GEMINI_API_KEY`, and a thrown error naming the missing variable — mirroring `src/db/client.ts`
- [ ] T007 Export a `GenAiClient` interface from `src/review/client.ts` narrow enough for tests to implement, following the `SqlClient` seam 001 established ([research D12](research.md))
- [ ] T008 [P] Define the `BLOCK_NONE` safety-settings constant in `src/review/client.ts` for the content call only, and document that the three boolean checks pass no `safetySettings` so the provider's defaults stay in force ([research D3](research.md)); add a comment that ratings are never returned at any threshold and `candidate.safetyRatings` must not be read

### Validation

- [ ] T009 [P] Create `src/review/schemas.ts` with `contentResultSchema` (`canPublish`, `displayText` 1–2000, `sourceLanguage`, nullable `emotion`) and `booleanCheckSchema` (`canPublish`), per [data-model.md](data-model.md)
- [ ] T010 [P] Define the `CheckResult`, `ContentPayload`, `ActiveSubmission`, and `ReviewOutcome` types in `src/review/types.ts` as discriminated unions, so a caller cannot read `displayText` off a rejection
- [ ] T011 [P] Unit-test `src/review/schemas.ts` in `tests/unit/review-schemas.test.ts`: valid payloads parse, `emotion: null` is accepted, over-length `displayText` and missing `canPublish` are rejected

### Bounded retry and deadline

- [ ] T012 Create `src/review/retry.ts` exposing a `runCheck` wrapper: at most 3 invocations, 20-second per-invocation timeout, waits of 1s then 2s, honouring an `AbortSignal` (FR-039)
- [ ] T013 Classify faults in `src/review/retry.ts` — network error, timeout, **no candidate**, undefined `response.text`, JSON parse failure, Zod failure — and return `outcome: 'fault'` for each, never `'refuse'` ([contracts/review.md](contracts/review.md))
- [ ] T014 [P] Unit-test bounded retry in `tests/unit/review-retry.test.ts`: exactly 3 invocations before exhaustion, 1s/2s backoff, timeout at 20s, abort mid-flight stops further attempts
- [ ] T015 [P] Unit-test in `tests/unit/review-retry.test.ts` that an empty-candidate response retries as a fault and never resolves to a rejection, for a default-threshold check as well as the content call (FR-008b1)

### Rate limiting

- [ ] T016 Create `migrations/<ts>_rate-limits.sql` adding `submission_rate_limits` (`participant_id` PK referencing `participants`, `window_started_at`, `submission_count`) with a Down migration; add no contribution, outcome, or audio column
- [ ] T017 [P] Add `rateLimitRowSchema` to `src/schema/rows.ts`, matching 001's row-parsing boundary rule
- [ ] T018 Create `src/db/queries/rateLimits.ts` with a single upsert-on-conflict that opens or increments the window and returns the count plus `retryAt`, reading limits from `HTH_RATE_LIMIT_MAX` and `HTH_RATE_LIMIT_WINDOW_SECONDS` with in-code defaults (FR-048)
- [ ] T019 [P] Integration-test the limiter in `tests/integration/rate-limit.test.ts` against PGlite: window opens, increments, refuses past the max, reopens after expiry, and concurrent submissions cannot create a second row
- [ ] T020 [P] Extend the existing `db-sweep` job in `scripts/sweep-participants.ts` to delete rate-limit rows whose window closed long ago; do not add a second scheduled task

### Copy

- [ ] T021 [P] Add every string from [contracts/copy.md](contracts/copy.md) to `src/copy.ts` — Checking, five Withheld variants, crisis heading and body, the four resource rows, processing failure, and rate limited — authoring no string at a call site
- [ ] T022 [P] Unit-test in `tests/unit/copy.test.ts` that FR-025 and FR-026's two strings match the spec byte for byte, and that no string contains a Principle VII forbidden term

**Checkpoint**: the provider client, validation, retry, limiter, and copy all exist and are tested. No review has run yet.

---

## Phase 3: User Story 1 — A recording becomes publishable text (Priority: P1) 🎯 MVP

**Goal**: audio in, validated text and a single verdict out. This is the entire engine; neither contribution flow exists without it.

**Independent Test**: feed the fixture recordings straight to `reviewContribution()` with no interface, and confirm each returns structurally correct text and one decision.

### Tests for User Story 1

- [ ] T023 [P] [US1] Integration-test the answer fan-out in `tests/integration/review-fanout.test.ts` with a faked client: exactly four calls, each receiving the original audio, none receiving another check's output (FR-004, FR-005)
- [ ] T024 [P] [US1] Integration-test the question fan-out in `tests/integration/review-fanout.test.ts`: exactly three calls, relevance never invoked (FR-003)
- [ ] T025 [P] [US1] Unit-test the gate in `tests/unit/review-gate.test.ts`: publishes only when every applicable check permits; a missing result is not a permit (FR-019)
- [ ] T026 [P] [US1] Contract-test each prompt module in `tests/unit/review-prompts.test.ts`: every system instruction carries its `<never>` block, and content processing forbids adding advice or altering substance

### Implementation for User Story 1

- [ ] T027 [P] [US1] Write `src/review/prompts/content.ts` with the system instruction and response schema from [contracts/review.md](contracts/review.md), on `gemini-3.8-flash`, `temperature: 0`, applying the `BLOCK_NONE` settings — this is the only call that overrides the provider's thresholds (FR-008b)
- [ ] T028 [P] [US1] Write `src/review/prompts/crisis.ts` on `gemini-3.5-flash-lite`, carrying FR-008f's `<never>` block and all four examples ([research D4](research.md))
- [ ] T029 [P] [US1] Write `src/review/prompts/illegal.ts` on `gemini-3.5-flash-lite`, carrying the compositional hunting/firearm example pair (FR-008c)
- [ ] T030 [P] [US1] Write `src/review/prompts/relevance.ts` on `gemini-3.5-flash-lite`, carrying FR-008g's constraint that unlawful content is still relevant ([research D5](research.md))
- [ ] T031 [US1] Create `src/review/gate.ts` implementing unanimity to publish and the crisis → illegal → relevance → content precedence for reason selection only (FR-022)
- [ ] T032 [US1] Create `src/review/index.ts` exporting `reviewContribution()`, ordering rate limit → cheap audio validation → fan-out → aggregate → release, per [contracts/review.md](contracts/review.md)
- [ ] T033 [US1] Reject empty, silent, or implausibly short audio in `src/review/index.ts` before any provider call, resolving `withheld/content` (FR-050)
- [ ] T034 [US1] Throw on programmer error in `src/review/index.ts` — `kind: 'answer'` with a null `questionText` — while returning `failed` rather than throwing for any provider outcome
- [ ] T035 [US1] Create `scripts/review-once.ts` running one fixture through the module and printing the outcome, satisfying US1's independent test
- [ ] T036 [P] [US1] Create `scripts/review-fixtures.ts` running all 16 fixtures against the live provider with `--timing` and `--cost` flags, printing a verdict table against the adjudicated labels
- [ ] T037 [US1] Create `src/ui/CheckingState.tsx` per [contracts/copy.md](contracts/copy.md): no header, no actions, watermark `.05`, progress dots, and an `aria-live` region (FR-029)

**Checkpoint**: the review runs end to end and returns a decision. This is the MVP — 003 could call it.

---

## Phase 4: User Story 2 — A contribution that cannot be shared (Priority: P2)

**Goal**: every rejection renders one shared page with the right text and the right way back.

**Independent Test**: submit prepared irrelevant and illegal recordings; each renders the shared page with its own text, publishes nothing, and returns the participant to the flow with no penalty.

### Tests for User Story 2

- [ ] T038 [P] [US2] E2E-test in `tests/e2e/withheld.spec.ts` that all five content variants render one layout with the correct heading and the shared sub-line
- [ ] T039 [P] [US2] E2E-test in `tests/e2e/withheld.spec.ts` that answer retry targets `/answer/record?questionId=<same>` and question retry targets `/ask` (FR-027b)
- [ ] T040 [P] [US2] Integration-test in `tests/integration/review-reason.test.ts` that an unlawful but on-topic recording resolves `reason: 'illegal'`, **not** `'relevance'` — the [research D5](research.md) bleed
- [ ] T041 [P] [US2] Unit-test in `tests/unit/review-gate.test.ts` that precedence selects copy only, and never delays resolution to wait for an unfinished check (FR-022)

### Implementation for User Story 2

- [ ] T042 [US2] Create `src/ui/WithheldPage.tsx` taking `reason` and `kind`, rendering the withheld badge, heading, sub-line, primary and ghost from `src/copy.ts` (FR-024)
- [ ] T043 [US2] Map the content check's signal to the three `content` sub-variants in `src/ui/WithheldPage.tsx`, falling back to the general recording line when indistinguishable ([contracts/copy.md](contracts/copy.md))
- [ ] T044 [US2] Wire contribution-specific actions in `src/ui/WithheldPage.tsx` so a withheld question always returns to a question recorder, never an answer one (US2 scenario 6c)
- [ ] T045 [US2] Assert in `src/review/index.ts` that no withheld path writes a row, records a strike, or sets a cooldown (FR-028, FR-023)

**Checkpoint**: every rejection reason renders correctly and leaves nothing behind.

---

## Phase 5: User Story 3 — Someone in crisis (Priority: P3)

**Goal**: crisis is withheld everywhere and routed to fixed, human-authored help.

**Independent Test**: submit crisis recordings as both an answer and a question; neither publishes, both route to the resources, and the resources are reachable by a participant who has never contributed.

### Tests for User Story 3

- [ ] T046 [P] [US3] E2E-test in `tests/e2e/crisis.spec.ts` that all four resource rows render verbatim with their qualifiers and values (FR-033)
- [ ] T047 [P] [US3] E2E-test in `tests/e2e/crisis.spec.ts` that resources and the fresh-recording action are visible together, with no dismissal required (FR-027c)
- [ ] T048 [P] [US3] Integration-test in `tests/integration/review-crisis.test.ts` that crisis applies to questions as well as answers (FR-030)
- [ ] T049 [P] [US3] Fixture-test in `tests/integration/review-crisis.test.ts` that `crisis-quiet`, `crisis-plan` and `crisis-question` withhold, while `grief-not-crisis` and `metaphor-not-crisis` publish

### Implementation for User Story 3

- [ ] T050 [P] [US3] Create `src/ui/CrisisResources.tsx` rendering the four static rows from `src/copy.ts`, with no generated text and no claim of intervention (FR-034)
- [ ] T051 [US3] Add the crisis variant to `src/ui/WithheldPage.tsx`: `30px` heading, body, resources, and the contribution-specific fresh-recording action (FR-032)
- [ ] T052 [US3] Ensure `src/ui/CrisisResources.tsx` is a component reachable without an earned ask, not a route behind the reciprocity gate (FR-035)

**Checkpoint**: crisis routes correctly from both flows and publishes nowhere.

---

## Phase 6: User Story 4 — Retry only what broke (Priority: P4)

**Goal**: a provider fault costs one retry of one check, never a participant rejection and never a rerun of work that already passed.

**Independent Test**: force one check to fail then succeed and verify only it runs again; separately exhaust retries and confirm a fresh recording is offered with no stored state.

### Tests for User Story 4

- [ ] T053 [P] [US4] Integration-test in `tests/integration/review-retry.test.ts` that with three passing checks and one fault, only the failed check is re-invoked, reusing the same audio (US4 scenario 1)
- [ ] T054 [P] [US4] Integration-test in `tests/integration/review-retry.test.ts` that a passing check is never re-invoked inside the active submission (FR-019)
- [ ] T055 [P] [US4] Integration-test in `tests/integration/review-retry.test.ts` that a definitive rejection arriving during an in-flight retry resolves Withheld immediately and ignores the late result (FR-022, US4 scenario 3)
- [ ] T056 [P] [US4] Integration-test in `tests/integration/review-retry.test.ts` that exhaustion and deadline expiry both produce `failed`, never `withheld` (FR-040)
- [ ] T057 [P] [US4] E2E-test in `tests/e2e/processing-failed.spec.ts` that the failure page offers a fresh recording and never blames the participant

### Implementation for User Story 4

- [ ] T058 [US4] Add a shared `AbortController` to `src/review/index.ts`, chained from the caller's `signal`, aborted on the first validated refusal ([research D6](research.md))
- [ ] T059 [US4] Freeze permitted results in `src/review/gate.ts` so no passing check is retried within the submission (FR-019)
- [ ] T060 [US4] Enforce the 90-second submission deadline in `src/review/index.ts`, resolving `failed / deadline` when it expires (FR-039)
- [ ] T061 [US4] Ignore results arriving after resolution in `src/review/gate.ts`; they may not publish or change the outcome (FR-022)
- [ ] T062 [US4] Create `src/ui/ProcessingFailed.tsx` per [contracts/copy.md](contracts/copy.md), with answer and question headings and both actions (FR-040)
- [ ] T063 [US4] Assert in `src/review/index.ts` that the `failed` path grants and consumes nothing, so a failed question keeps its ask unspent (FR-042)

**Checkpoint**: faults retry in isolation, rejections win immediately, and exhaustion is honest about whose fault it was.

---

## Phase 7: User Story 5 — The recording disappears (Priority: P5)

**Goal**: the original audio never has an address and never outlives its request.

**Independent Test**: submit contributions reaching each terminal outcome, then attempt direct retrieval of the original from outside the system; every attempt fails and no stored copy remains.

### Tests for User Story 5

- [ ] T064 [P] [US5] Integration-test in `tests/integration/audio-lifecycle.test.ts` that the buffer is released on all five exits — publish, withheld, failed, rate limited, abort (FR-044)
- [ ] T065 [P] [US5] Integration-test in `tests/integration/audio-lifecycle.test.ts` that aborting the caller's signal mid-fan-out cancels in-flight calls and releases the audio (FR-045)
- [ ] T066 [P] [US5] Static-assert in `tests/unit/audio-no-storage.test.ts` that `src/review/` contains no bucket client, signed URL, object key, or filesystem write ([research D1](research.md))
- [ ] T067 [P] [US5] Static-assert in the same test that nothing in `src/review/` reads `candidate.safetyRatings` ([research D3](research.md))
- [ ] T067a [P] [US5] Static-assert in `tests/unit/review-config.test.ts` that only `prompts/content.ts` passes `safetySettings`, and that the three boolean prompts pass none — the split is easy to "tidy" into uniformity by a later reader (FR-008b)
- [ ] T068 [P] [US5] E2E-test in `tests/e2e/audio-lifecycle.spec.ts` that no surface offers review or playback of a participant's own original recording (FR-047)

### Implementation for User Story 5

- [ ] T069 [US5] Release the audio buffer in a `finally` in `src/review/index.ts` so every exit path drops it, including thrown programmer errors
- [ ] T070 [US5] Pass audio to each check as inline data built per call in `src/review/index.ts`; never write it to disk, a bucket, or the Files API ([research D1](research.md))
- [ ] T071 [US5] Document in `src/review/index.ts` why there is no deletion routine — there is no object to delete — referencing the FR-046 deviation in [plan.md](plan.md)

**Checkpoint**: all five user stories complete. The engine is done.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T072 [P] Create `src/ui/RateLimited.tsx` interpolating `retryAt` into the heading so the participant is told when they may try again (FR-049)
- [ ] T073 [P] E2E-test in `tests/e2e/rate-limited.spec.ts` that the heading names a time and the muted action goes to Yours
- [ ] T074 Integration-test in `tests/integration/rate-limit.test.ts` that a rate-limited submission leaves nothing in flight and no contribution unresolvable (FR-052)
- [ ] T075 [P] E2E-test in `tests/e2e/checking.spec.ts` that the Checking state announces via `aria-live`, per design.md's 002 test obligation
- [ ] T076 [P] Add `HTH_GEMINI_API_KEY` binding to `deploy.sh` alongside the existing secrets, bound only when present
- [ ] T077 [P] Update `README.md`'s What's next list, checking off 002
- [ ] T078 Run the `ai-checks` target in `Makefile` and fix every warning; warnings are hard errors under the constitution
- [ ] T079 Run `pnpm exec tsx scripts/review-fixtures.ts` and require 16/16 against the adjudicated labels before this feature is called done

### ⚠️ Required before launch — not optional polish

These are the open items from [quickstart.md](quickstart.md). Each is a real gap, not a nicety.

- [ ] T080 Add 60-second recordings to `tests/fixtures/audio/` and measure fan-out latency via `scripts/review-fixtures.ts --timing`; if p95 approaches 30s, revisit the blocking-request decision ([research D8](research.md)) before 003 builds on it
- [ ] T081 Measure cost per contribution via `scripts/review-fixtures.ts --cost` and record the figure in `specs/002-contribution-review/quickstart.md`; SC-012 requires this before interface work depends on it
- [ ] T082 Author fresh understated-crisis recordings appearing nowhere in `src/review/prompts/crisis.ts`, add them to the fixture set, and require them to pass — the prompt is currently fitted to its own failing case ([research D4](research.md))
- [ ] T083 Add multilingual recordings to `tests/fixtures/audio/` with labels in `tests/fixtures/cases.ts`, and verify SC-007's ninety-percent readable-English threshold
- [ ] T084 Add privacy and fidelity recordings to `tests/fixtures/audio/` with labels in `tests/fixtures/cases.ts`, and verify SC-005 and SC-006; **redaction is the only failure in this product that cannot be retried**

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 Setup**: no dependencies
- **Phase 2 Foundational**: depends on Phase 1 — **blocks every user story**
- **Phase 3 US1**: depends on Phase 2. Delivers the engine
- **Phase 4 US2**: depends on US1 — there is no rejection to render until the gate returns one
- **Phase 5 US3**: depends on US2's `WithheldPage`, which the crisis variant extends
- **Phase 6 US4**: depends on US1's fan-out; independent of US2 and US3
- **Phase 7 US5**: depends on US1's audio path; independent of US2, US3, US4
- **Phase 8 Polish**: depends on all five

### Story dependencies — honest version

The template's ideal is fully independent stories. That is not true here and pretending otherwise
would mislead whoever picks this up:

- **US2 and US3 are UI over US1's decision.** They cannot be built or tested before the gate returns a reason.
- **US3 extends US2's component.** Building it first means building `WithheldPage` inside it and refactoring later.
- **US4 and US5 are genuinely parallel with US2/US3** once US1 exists — they touch retry and lifecycle, not screens.

### Parallel opportunities

- T002–T005 in Setup
- T008–T011 and T014–T022 in Foundational — three groups touching different files
- **T027–T030**: all four prompts, four separate files, no shared state. The single biggest parallel win
- All test tasks within a phase, marked [P]
- **US4 and US5 together** after US1, if two people are working

### Parallel example — the four prompts

```bash
Task: "Write src/review/prompts/content.ts"
Task: "Write src/review/prompts/crisis.ts"
Task: "Write src/review/prompts/illegal.ts"
Task: "Write src/review/prompts/relevance.ts"
```

---

## Implementation strategy

### MVP

Phase 1 → Phase 2 → Phase 3. That yields a callable `reviewContribution()` that returns a real
decision. **Stop and validate with `scripts/review-once.ts` before building any screen.** If the
engine is wrong, every screen built on it is wrong too.

### Incremental delivery

1. Setup + Foundational → the pieces exist
2. US1 → the engine decides → **validate with fixtures**
3. US2 → rejections render
4. US3 → crisis routes → **the one that must not ship broken**
5. US4 + US5 → faults and audio behave
6. Polish → rate-limit screen, then the four pre-launch gaps

### Weekend reality

The two-day plan puts 001, 002 and 003 on Day 1. Phases 1–3 are the part of 002 that Day 1
actually needs; US2 and US3 are needed before anything is demoed to a person, because a demo that
hits a rejection with no page is worse than no demo.

**T082 is not a Day 2 nicety.** The crisis prompt is fitted to its own failing case, and this is
the one failure in the product that causes harm outside the software.

### Scope notes

- **No route is created.** 003 and 004 own the endpoints; 002 is a module and four components ([research D10](research.md))
- **No columns are added to `questions` or `answers`.** The flows that publish own those migrations
- **No object storage, job queue, poller, or cache service.** Each rejected with reasoning in [research.md](research.md)

### Risk to watch

`src/review/index.ts` is touched by T032, T033, T034, T058, T060, T069, T070 and T071 across four
phases. It is the one real serialization point in this plan — none of those are marked [P], and
two people working it at once will conflict.
