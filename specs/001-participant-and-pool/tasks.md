# Tasks: Participant Identity and Question Pool

**Input**: Design documents from `/specs/001-participant-and-pool/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: **Included and mandatory.** Constitution v2.0.0 requires automated tests on the
reciprocity gate and makes the handoff's Required Validation Cases the acceptance floor. These are
not optional here.

**Organization**: Grouped by user story so each is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel — different files, no dependency on incomplete work
- **[Story]**: US1–US4, mapping to the user stories in [spec.md](spec.md)
- Every task carries an exact file path

## Path conventions

Single Next.js application at the repository root, per [plan.md](plan.md): `app/` for routing and
UI, `src/` for testable units, `dataconnect/` for schema and operations, `tests/` mirroring the
split.

> **001 carries the project scaffold.** It is the first feature built, so Phase 1 and Phase 2 are
> unusually heavy. That work is real and is planned here rather than pretended away.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: A repository that installs, lints, type-checks, tests, and deploys before any
product code exists.

- [ ] T001 Initialize the pnpm workspace at the repository root: `package.json` with `"type": "module"`, `engines.node >=24`, and `packageManager: pnpm@11.25.0`
- [ ] T002 [P] Pin the runtime in `.nvmrc` (Node 24) per research D1
- [ ] T003 Install Next.js 16.3.4, React 19.2.8, and React DOM 19.2.8 into `package.json`
- [ ] T004 Install TypeScript 7.0.2 and create `tsconfig.json` with `strict: true`, `moduleResolution: bundler`, ESM only
- [ ] T005 [P] Create `next.config.ts`; do **not** set `experimental.useTypeScriptCli` — the `tsc` CLI checker is the default and turning it off breaks the build under TypeScript 7 (research D2)
- [ ] T006 [P] Configure Biome 2.5.12 in `biome.json` for lint and format; do not install ESLint or Prettier (research D3)
- [ ] T007 [P] Install Vitest 5.0.0 and create `vitest.config.ts` with `unit` and `integration` projects
- [ ] T008 [P] Install Playwright 1.62.1 and create `playwright.config.ts` with device projects at 402, 767, 768, 1100, and 1440 px widths (design.md breakpoints)
- [ ] T009 Create the `Makefile` exposing `install`, `dev`, `format`, `format-check`, `lint`, `typecheck`, `test`, `build`, `e2e`, `perf`, `secret-scan`, `clean`, plus `db-up`, `schema`, `seed`, `db-shell`, `ai-checks`
- [ ] T010 [P] Configure Lefthook in `lefthook.yml`: pre-commit (format, lint, secret scan, actionlint), commit-msg (commitlint), pre-push (typecheck, unit, e2e)
- [ ] T011 [P] Configure commitlint 21.2.2 in `commitlint.config.js` with the RAI attribution plugin
- [ ] T012 [P] Create `.env.example` with `SESSION_SECRET`, `FIREBASE_PROJECT_ID`, and `DATACONNECT_EMULATOR_HOST` placeholders; never a real value
- [ ] T013 [P] Add `.github/workflows/ci.yml` running install, format-check, lint, typecheck, test, build, and the SonarCloud scan; job-level permissions, timeouts, concurrency group, and `paths-ignore`
- [ ] T014 [P] Add `.github/workflows/codeql.yml` and `.github/workflows/release-please.yml`
- [ ] T015 [P] Add `.github/dependabot.yml` grouping npm and github-actions with `open-pull-requests-limit: 2` and `cooldown.default-days: 7`
- [ ] T016 [P] Add `.github/CODEOWNERS` containing `* @anchildress1`
- [ ] T017 Create the `Dockerfile` on a Node 24 base and `deploy.sh` at the repository root targeting Cloud Run in `us-east1` via Artifact Registry
- [ ] T018 Verify the toolchain end to end from the repository root: `make install && make ai-checks` passes with **zero warnings** on an empty project

**Checkpoint**: The repository builds and every gate is green before a line of product code.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database, identity, validation, and the shared design system that every user story
and every later spec builds on. **No user story can start until this phase completes.**

### Database — Firebase SQL Connect

- [ ] T019 Provision Firebase SQL Connect in the same GCP project as Cloud Run using the default configuration, and record the service id in `.env.example` (research D7)
- [ ] T020 Create `dataconnect/dataconnect.yaml` and `dataconnect/schema/schema.gql` declaring `participants`, `questions`, and `answers` exactly as specified in [data-model.md](data-model.md) — **published answers only**, no status enum, no processing columns
- [ ] T021 Add the `UNIQUE (participant_id, question_id)` constraint on `answers` in `dataconnect/schema/schema.gql`, preventing two published answers by one participant to one question
- [ ] T022 [P] Declare the indexes from [data-model.md](data-model.md) in `dataconnect/schema/schema.gql`: `questions (status)`, `answers (participant_id, question_id)`, `answers (question_id)`
- [ ] T023 Create `dataconnect/connector/` with generated operations for find-participant, create-participant, and get-question-by-id; run codegen and commit the output configuration
- [ ] T024 Implement the SQL Connect client in `src/db/client.ts`, server-side only, and assert it is never imported from a client component
- [ ] T025 Wire `make db-up` to the Firebase emulator suite and `make schema` to deploy `dataconnect/` and regenerate the SDK

### Validation

- [ ] T026 [P] Define Zod 4.5.4 parsers for every row shape in `src/schema/rows.ts` — participant, question, answer — with `display_text` bounded to 1–2000 characters
- [ ] T027 [P] Write unit tests in `tests/unit/rows.test.ts` asserting each parser rejects malformed rows rather than passing them through

### Identity

- [ ] T028 Implement the iron-session configuration in `src/session/session.ts` per [contracts/session.md](contracts/session.md): cookie `hth_session`, `httpOnly`, `sameSite: Lax`, `secure` in production, 30-day `maxAge`
- [ ] T029 Fail application boot when `SESSION_SECRET` is absent or shorter than 32 characters in `src/session/session.ts`; never fall back to a default
- [ ] T030 Implement `getOrCreateParticipant` in `src/session/session.ts` covering all three branches from [contracts/session.md](contracts/session.md), including the **missing-row branch** that must not 500
- [ ] T031 Implement participant queries in `src/db/queries/participants.ts` using generated SQL Connect operations
- [ ] T032 [P] Write integration tests in `tests/integration/session.test.ts`: no cookie creates a participant; a valid cookie reuses it; a cookie referencing a deleted row creates a new one without a 500; a tampered cookie does the same; an unreachable database returns 500 and never a silent new identity
- [ ] T033 [P] Write a unit test in `tests/unit/session-authority.test.ts` asserting the serialized session contains only `participantId` — no `canAsk`, no counts, no history

### Design system

- [ ] T034 [P] Load Bricolage Grotesque alone via `next/font/google` in `app/layout.tsx` — **no Figtree, no Space Grotesk** (research D13)
- [ ] T035 [P] Define every colour and type token from [contracts/design.md](contracts/design.md) as CSS custom properties on `:root` in `src/ui/tokens.css`
- [ ] T036 [P] Build `src/ui/Button.tsx` with `primary` and `ghost` variants at 56px and 52px min-height, and a **visible `:focus-visible` ring** — `all: unset` strips the default outline and that is the one accessibility regression this design introduces if copied literally
- [ ] T037 [P] Build `src/ui/AppHeader.tsx` with contextual left and right slots, rendering the Arrival-mobile (right only) and default (name + `Yours`) variants
- [ ] T038 [P] Build `src/ui/Watermark.tsx` — the decorative `?` at 9% opacity, `aria-hidden="true"`, clipped by the screen container
- [ ] T039 Create the responsive screen shell in `app/layout.tsx` and a shared screen wrapper: mobile padding `78px 28px 52px`, desktop `28px 56px 40px`, breakpoint **768px**, `overflow: hidden` for the watermark
- [ ] T040 Point the header's `Yours` link in `src/ui/AppHeader.tsx` at a placeholder route so it **does not 404**; the real area is delivered by 005 ([contracts/routes.md](contracts/routes.md))

### Seed content

- [ ] T041 Reach the 15-question floor in `seed/questions.json`. Six are authored; roughly nine remain. Ids are uuid5 over the file's namespace and `displayText`, so a new question needs no hand-picked id and reseeding stays idempotent
- [ ] T042 Implement the idempotent seeding script in `seed/seed.ts`: upsert each entry from `seed/questions.json` by `id`, with `participant_id = NULL` and `status = 'open'`, and wire `make seed`

**Checkpoint**: Database, identity, validation, and the design system all work and are tested.
User stories can now proceed in any order.

---

## Phase 3: User Story 1 — Arrive and get a question (Priority: P1) 🎯 MVP

**Goal**: A first-time visitor lands, becomes an anonymous participant, and is shown one open
question with two ways forward.

**Independent test**: Seed the pool, open the site as a new visitor on a phone and a desktop
browser, and confirm the landing screen and a question both render correctly.

### Tests for User Story 1

- [ ] T043 [P] [US1] E2E test in `tests/e2e/arrival.spec.ts`: `/` renders `Happen to Have?`, `Answer one. Ask one.`, `Find me a question`, and the helper line verbatim from [contracts/copy.md](contracts/copy.md)
- [ ] T044 [P] [US1] E2E test in `tests/e2e/arrival.spec.ts`: the product name retains its question mark, including in `<title>`
- [ ] T045 [P] [US1] Integration test in `tests/integration/identity-on-interaction.test.ts`: loading `/` creates **no** participant row; interacting does
- [ ] T046 [P] [US1] E2E test in `tests/e2e/selection.spec.ts`: `/answer` renders one question with `I can answer this` and `Try another question`
- [ ] T047 [P] [US1] E2E test in `tests/e2e/no-microphone.spec.ts`: `navigator.mediaDevices.getUserMedia` is never invoked on any route (SC-005)

### Implementation for User Story 1

- [ ] T048 [US1] Build the landing screen in `app/page.tsx` — status dot, H1, tagline, primary action, helper; desktop adds the footer line and the `1fr 1fr` grid with a 520px copy column
- [ ] T049 [US1] Write the native-SQL selection query in `src/db/queries/questions.ts` exactly as specified in [data-model.md](data-model.md). Use `IS DISTINCT FROM` for the own-question exclusion — plain `<>` silently drops every seeded row, whose `participant_id` is `NULL`. This is the easiest bug in the feature to write
- [ ] T050 [US1] Compute published-answer counts relationally with `COUNT` in `src/db/queries/questions.ts`. Introducing a denormalized counter is forbidden by the constitution: it drifts, and a drifted count silently corrupts both the fewer-answers bias and 004's closure rule
- [ ] T051 [US1] Implement `POST /api/questions/next` in `app/api/questions/next/route.ts` per [contracts/routes.md](contracts/routes.md), returning `{ question }` or `{ question: null }`, and `export const dynamic = 'force-dynamic'`
- [ ] T052 [US1] Build `src/ui/QuestionCard.tsx` — question text and both actions, **with no eyebrow label above it** (research D15)
- [ ] T053 [US1] Build the selection screen in `app/answer/page.tsx` using QuestionCard; desktop uses the `minmax(0,1.4fr) minmax(0,1fr)` grid with the actions in a `--green-06` panel
- [ ] T054 [US1] Create identity through `POST /api/questions/next`, not during Server Component rendering, per [contracts/session.md](contracts/session.md)
- [ ] T055 [US1] Point `I can answer this` at a disabled or placeholder target for `/answer/record`; 003 delivers it, and it must never request microphone permission from this feature's code

**Checkpoint**: US1 is independently demoable. This is the MVP.

---

## Phase 4: User Story 2 — Skip until something fits (Priority: P2)

**Goal**: Unlimited skipping with no penalty, no recording, and no effect on ask eligibility.

**Independent test**: With several seeded questions, skip repeatedly and confirm a different
question appears each time, no recording begins, and ask eligibility never changes.

### Tests for User Story 2

- [ ] T056 [P] [US2] E2E test in `tests/e2e/skip.spec.ts`: twenty consecutive skips each yield a different question (SC-003)
- [ ] T057 [P] [US2] Integration test in `tests/integration/skip-writes-nothing.test.ts`: skipping writes **nothing** to `participants` or `answers`, and `can_ask` is unchanged
- [ ] T058 [P] [US2] Integration test in `tests/integration/skip-no-repeat.test.ts`: the question just skipped is never the immediately next one (FR-024)

### Implementation for User Story 2

- [ ] T059 [US2] Implement tab-local traversal in `app/answer/page.tsx` — an ordered id list and a pointer held in page memory, per [contracts/session.md](contracts/session.md). Skipping advances the pointer and **never** mutates the cookie
- [ ] T060 [US2] Implement `POST /api/questions/skip` in `app/api/questions/skip/route.ts`: no write to `participants`, no write to `answers`, no penalty, no cooldown, no rate limit
- [ ] T061 [US2] In `app/api/questions/skip/route.ts`, return 400 only for a malformed or missing `skippedQuestionId`; an unknown-but-well-formed uuid is accepted and ignored, because validating it costs a round trip to prevent nothing
- [ ] T062 [US2] Wire `Try another question` in `src/ui/QuestionCard.tsx` to advance without requesting microphone permission

**Checkpoint**: US1 and US2 both work independently.

---

## Phase 5: User Story 3 — Never the wrong question (Priority: P3)

**Goal**: A participant is never handed their own question or one they already have published, and
closed questions stop being routed.

**Independent test**: Create a participant with one authored question, one question they have a
published answer to, and one carrying only a withheld attempt. Request repeatedly: the first two
never appear, the third still does.

### Tests for User Story 3

- [ ] T063 [P] [US3] Integration test in `tests/integration/exclusions.test.ts`: a participant's own question is never selected
- [ ] T064 [P] [US3] Integration test in `tests/integration/exclusions.test.ts`: a question with a **published** answer from this participant is never selected
- [ ] T065 [P] [US3] Integration test in `tests/integration/exclusions.test.ts`: a question carrying only a withheld or failed attempt **stays selectable**. Under Principle V no row exists for those attempts at all, so this holds by construction — the test guards against a future regression that starts persisting them
- [ ] T066 [P] [US3] Integration test in `tests/integration/exclusions.test.ts`: a closed question is never selected
- [ ] T067 [P] [US3] Integration test in `tests/integration/selection-bias.test.ts`: across 100 selections, lower-count questions appear materially more often than higher-count ones (SC-004)
- [ ] T068 [P] [US3] Integration test in `tests/integration/exclusions.test.ts`: seeded questions, whose `participant_id` is `NULL`, are still selectable — the `IS DISTINCT FROM` regression guard

### Implementation for User Story 3

- [ ] T069 [US3] Apply the own-question and published-answer exclusions in `src/db/queries/questions.ts`
- [ ] T070 [US3] Apply the closed-question exclusion in `src/db/queries/questions.ts`, reading the `status` that 004 owns and writes
- [ ] T071 [US3] Order by published-answer count ascending with a tiebreak in `src/db/queries/questions.ts`, per research D10 — a bias, not a strict ordering, so concurrent participants do not collide
- [ ] T072 [US3] Enforce every exclusion server-side in `app/api/questions/next/route.ts` regardless of what the interface allowed

**Checkpoint**: Selection is correct under all exclusion rules.

---

## Phase 6: User Story 4 — Nothing left to answer (Priority: P4)

**Goal**: Empty, loading, and failure states that never show a broken screen or an ineligible
question.

**Independent test**: Reduce the eligible pool to zero for one participant and confirm the empty
state renders rather than an error, a blank screen, or an ineligible question.

### Tests for User Story 4

- [ ] T073 [P] [US4] Integration test in `tests/integration/empty-pool.test.ts`: zero eligible questions returns `{ question: null }`, not an error
- [ ] T074 [P] [US4] E2E test in `tests/e2e/states.spec.ts`: the empty state renders its copy and no ineligible question is shown to fill the gap
- [ ] T075 [P] [US4] E2E test in `tests/e2e/states.spec.ts`: an induced selection failure renders the failure state with a working retry

### Implementation for User Story 4

- [ ] T076 [P] [US4] Build `src/ui/EmptyPool.tsx` using the copy in [contracts/copy.md](contracts/copy.md). No design exists for this state — it is authored, and flagged for a design pass
- [ ] T077 [P] [US4] Build the loading state in `app/answer/loading.tsx`
- [ ] T078 [P] [US4] Build the failure state with a retry action in `app/answer/error.tsx`
- [ ] T079 [US4] Return `{ error: "selection_failed" }` with a 500 from `app/api/questions/next/route.ts` on query failure — never a stack trace, never a database message

**Checkpoint**: All four user stories complete.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T080 [P] E2E test in `tests/e2e/design.spec.ts`: **no device or browser frame** renders anywhere — those exist only in the design canvas
- [ ] T081 [P] E2E test in `tests/e2e/design.spec.ts`: only Bricolage Grotesque is requested; zero network requests for Figtree or Space Grotesk
- [ ] T082 [P] E2E test in `tests/e2e/design.spec.ts`: no uppercase eyebrow label renders on any screen
- [ ] T083 [P] E2E test in `tests/e2e/a11y.spec.ts`: every interactive element shows a visible `:focus-visible` ring; primary ≥56px, ghost ≥52px, header ≥44px
- [ ] T084 [P] E2E test in `tests/e2e/a11y.spec.ts`: the watermark and status dot are `aria-hidden`
- [ ] T085 [P] E2E test in `tests/e2e/responsive.spec.ts`: `scrollWidth <= clientWidth` at 402, 767, 768, 1100, and 1440 px, and the desktop grid engages at exactly 768px
- [ ] T086 [P] E2E test in `tests/e2e/copy.spec.ts`: a case-insensitive scan of every rendered route finds none of the forbidden terms in [contracts/copy.md](contracts/copy.md) — no "expert", no "agent", no "safe", no dialect spelling
- [ ] T087 [P] Add `firebase.json` and commit the SQL Connect deploy configuration; verify a console-authored change is overwritten by `make schema`
- [ ] T088 Walk every scenario in [quickstart.md](quickstart.md) end to end against a fresh clone of the repository root
- [ ] T089 Run `make ai-checks` from the repository root and confirm **zero warnings** — the constitution treats warnings as hard errors
- [ ] T090 Deploy to Cloud Run via `./deploy.sh` and run the full flow on a real iPhone and a real Android device (SC-006, SC-009)

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 (Setup)** — no dependencies
- **Phase 2 (Foundational)** — depends on Phase 1. **Blocks every user story**
- **Phase 3 (US1)** — depends on Phase 2
- **Phase 4 (US2)** — depends on Phase 2; builds on US1's screen in practice
- **Phase 5 (US3)** — depends on Phase 2 and US1's selection query
- **Phase 6 (US4)** — depends on Phase 2 and US1's route handler
- **Phase 7 (Polish)** — depends on all user stories

### User story dependencies

US1 is the only story that must come first, because it builds the selection query and the two
screens the others extend. US2, US3, and US4 are independent of each other once US1 lands.

```text
Setup ──► Foundational ──► US1 ──┬──► US2
                                 ├──► US3
                                 └──► US4  ──► Polish
```

### Parallel opportunities

- **Phase 1**: T002, T005–T008, T010–T016 all run in parallel
- **Phase 2**: the design-system block (T034–T038) is independent of the database block
  (T019–T025) and the identity block (T028–T033); three people could work at once
- **Phase 3–6**: every test task marked `[P]` writes to a different file
- **Phase 7**: T080–T087 are all independent

### Parallel example — Phase 2

```text
Track A (database):  T019 → T020 → T021 → T022 → T023 → T024 → T025
Track B (identity):  T026 → T027 → T028 → T029 → T030 → T031 → T032 → T033
Track C (design):    T034 → T035 → T036 → T037 → T038 → T039 → T040
Track D (content):   T041 → T042
```

---

## Implementation strategy

### MVP first

**Phase 1 → Phase 2 → Phase 3 (US1).** That yields a deployable site where a visitor arrives,
becomes a participant, and sees a real question. It is demoable on its own and it is the first
impression the challenge is judged on.

### Incremental delivery

Add US2 next — skipping is what keeps the pool honest and it is cheap. US3 hardens correctness.
US4 covers the states a judge hits by clicking once more than expected.

### Scope note — components deferred on purpose

[contracts/design.md](contracts/design.md) specifies eleven components across the whole product.
001 builds only the six its own two screens render: tokens, header, primary and ghost buttons,
watermark, question card, and the empty state.

The muted button, recorder dial, waveform, progress dots, status badge, resource list, list row,
and segmented tabs are **documented and not built**. Each belongs to the spec that first renders
it. Building them now would be speculative work, which Principle VI forbids.

### Risk to watch

`make typecheck` against dependency type definitions is the one unproven step. TypeScript 7.0.2
is two months old and no dependency here declares a TypeScript peer range. Run T018 before
writing product code. The documented fallback is TypeScript 6.0.3, which also restores ESLint and
`eslint-config-next` in place of Biome — research D2 and D3.

---

## Notes

- `[P]` means a different file and no dependency on incomplete work
- Every task names an exact path
- Commit after each task; never push without being asked
- Stop and surface exact errors after three failed validation attempts
- Verify each story's independent test criterion before starting the next phase
