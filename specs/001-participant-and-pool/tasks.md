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
UI, `src/` for testable units, `migrations/` for schema, `tests/` mirroring the
split.

> **001 carries the project scaffold.** It is the first feature built, so Phase 1 and Phase 2 are
> unusually heavy. That work is real and is planned here rather than pretended away.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: A repository that installs, lints, type-checks, tests, and deploys before any
product code exists.

- [x] T001 Initialize the pnpm workspace at the repository root: `package.json` with `"type": "module"`, `engines.node >=24`, and `packageManager: pnpm@11.25.0`
- [x] T002 [P] Pin the runtime in `.nvmrc` (Node 24) per research D1
- [x] T003 Install Next.js 16.3.4, React 19.2.8, and React DOM 19.2.8 into `package.json`
- [x] T004 Install TypeScript 7.0.2 and create `tsconfig.json` with `strict: true`, `moduleResolution: bundler`, ESM only
- [x] T005 [P] Create `next.config.ts`; do **not** set `experimental.useTypeScriptCli` — the `tsc` CLI checker is the default and turning it off breaks the build under TypeScript 7 (research D2)
- [x] T006 [P] Configure Biome 2.5.12 in `biome.json` for lint and format; do not install ESLint or Prettier (research D3)
- [x] T007 [P] Install Vitest 5.0.0 and create `vitest.config.ts` with `unit` and `integration` projects
- [x] T008 [P] Install Playwright 1.62.1 and create `playwright.config.ts` with device projects at 402, 767, 768, 1100, and 1440 px widths (design.md breakpoints)
- [x] T009 Create the `Makefile` exposing `install`, `dev`, `format`, `format-check`, `lint`, `typecheck`, `test`, `build`, `e2e`, `perf`, `secret-scan`, `clean`, plus `db-up`, `schema`, `seed`, `db-shell`, `ai-checks`
- [x] T010 [P] Configure Lefthook in `lefthook.yml`: pre-commit (format, lint, secret scan, actionlint), commit-msg (commitlint), pre-push (typecheck, unit, e2e)
- [x] T011 [P] Configure commitlint 21.2.2 in `commitlint.config.js` with the RAI attribution plugin
- [x] T012 [P] Create `.env.example` with `SESSION_SECRET`, `FIREBASE_PROJECT_ID`, and `DATACONNECT_EMULATOR_HOST` placeholders; never a real value
- [x] T013 [P] Add `.github/workflows/ci.yml` running install, format-check, lint, typecheck, test, build, and the SonarCloud scan; job-level permissions, timeouts, concurrency group, and `paths-ignore`
- [x] T014 [P] Add `.github/workflows/codeql.yml` and `.github/workflows/release-please.yml`
- [x] T015 [P] Add `.github/dependabot.yml` grouping npm and github-actions with `open-pull-requests-limit: 2` and `cooldown.default-days: 7`
- [x] T016 [P] Add `.github/CODEOWNERS` containing `* @anchildress1`
- [x] T017 Create the `Dockerfile` on a Node 24 base and `deploy.sh` at the repository root targeting Cloud Run in `us-east1` via Artifact Registry
- [x] T018 Verify the toolchain end to end from the repository root: `make install && make ai-checks` passes with **zero warnings** on an empty project

**Checkpoint**: The repository builds and every gate is green before a line of product code.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database, identity, validation, and the shared design system that every user story
and every later spec builds on. **No user story can start until this phase completes.**

### Database — Neon

- [x] T019 Create the Neon project in org `org-bold-hat-14494774` and record the project id; every git branch gets a copy-on-write Neon branch via `neon checkout` (research D7, D7a)
- [x] T020 Write the initial migration in `migrations/*_initial-schema.sql` declaring `participants`, `questions`, and `answers` exactly as specified in [data-model.md](data-model.md) — **published answers only**, no status enum, no processing columns
- [x] T021 Add the `UNIQUE (participant_id, question_id)` constraint on `answers`, preventing two published answers by one participant to one question
- [x] T022 [P] Declare the indexes from [data-model.md](data-model.md): `questions (status)` and `answers (question_id)`; the unique constraint covers `(participant_id, question_id)`
- [x] T023 Implement `src/db/queries/participants.ts`: find-by-id and create, parameterized, each row parsed with Zod before it leaves the module
- [x] T024 Implement the pool in `src/db/client.ts` — `@neondatabase/serverless`, `server-only`, `max` capped low enough that pool × Cloud Run max-instances stays inside Neon's connection limit
- [x] T025 Wire `make db-up` to `neon branches create` + `neon checkout`, and `make migrate` to `node-pg-migrate up`. Note: on CLI 4.14.1 `neon checkout` does **not** create a missing branch, contrary to the docs

### Validation

- [x] T026 [P] Define Zod 4.5.4 parsers for every row shape in `src/schema/rows.ts` — participant, question, answer — with `display_text` bounded to 1–2000 characters
- [x] T027 [P] Write unit tests in `tests/unit/rows.test.ts` asserting each parser rejects malformed rows rather than passing them through

### Identity

- [x] T028 Implement the iron-session configuration in `src/session/session.ts` per [contracts/session.md](contracts/session.md): cookie `hth_session`, `httpOnly`, `sameSite: Lax`, `secure` in production, 30-day `maxAge`
- [x] T029 Fail application boot when `SESSION_SECRET` is absent or shorter than 32 characters in `src/session/session.ts`; never fall back to a default
- [x] T030 Implement `getOrCreateParticipant` in `src/session/session.ts` covering all three branches from [contracts/session.md](contracts/session.md), including the **missing-row branch** that must not 500
- [x] T031 Implement participant queries in `src/db/queries/participants.ts` with parameterized SQL, each row Zod-parsed at the boundary
- [x] T032 [P] Write integration tests in `tests/integration/session.test.ts`: no cookie creates a participant; a valid cookie reuses it; a cookie referencing a deleted row creates a new one without a 500; a tampered cookie does the same; an unreachable database returns 500 and never a silent new identity
- [x] T032a **Remove `--passWithNoTests` from the `test:integration` script in `package.json`.** It was added during the scaffold so `make ai-checks` could pass before any integration test existed. Once T027 and T032 land it is not merely redundant — it actively masks integration tests silently failing to be *discovered*, which is exactly the failure a green suite should never hide
- [x] T033 [P] Write a unit test in `tests/unit/session-authority.test.ts` asserting the serialized session contains only `participantId` — no `canAsk`, no counts, no history

### Design system

- [x] T034 [P] Load **Sour Gummy** (display, variable wght + wdth) and **Source Sans 3** (everything else, variable) via `next/font/google` in `app/layout.tsx`, and nothing else. Do not add `font-variant-numeric: tabular-nums` to the timer — Google strips GSUB features from its subsets, so it is a no-op, and Source Sans 3's digits are already monospaced (research D13)
- [x] T035 [P] Define every colour and type token from [contracts/design.md](contracts/design.md) as CSS custom properties on `:root` in `src/ui/tokens.css`
- [x] T036 [P] Build `src/ui/Button.tsx` with `primary` and `ghost` variants at 56px and 52px min-height, and a **visible `:focus-visible` ring** — `all: unset` strips the default outline and that is the one accessibility regression this design introduces if copied literally
- [x] T037 [P] Build `src/ui/AppHeader.tsx` with contextual left and right slots, rendering the Arrival-mobile (right only) and default (name + `Yours`) variants
- [x] T038 [P] Build `src/ui/Watermark.tsx` — the decorative `?` at 9% opacity, `aria-hidden="true"`, clipped by the screen container
- [x] T039 Create the responsive screen shell in `app/layout.tsx` and a shared screen wrapper: mobile padding `78px 28px 52px`, desktop `28px 56px 40px`, breakpoint **768px**, `overflow: hidden` for the watermark
- [x] T040 Point the header's `Yours` link in `src/ui/AppHeader.tsx` at a placeholder route so it **does not 404**; the real area is delivered by 005 ([contracts/routes.md](contracts/routes.md))

### Seed content

- [ ] T041 Reach the 15-question floor in `seed/questions.json`. Six are authored; roughly nine remain. Ids are uuid5 over the file's namespace and `displayText`, so a new question needs no hand-picked id and reseeding stays idempotent
- [x] T042 Implement the idempotent seeding script in `seed/seed.ts`: upsert each entry from `seed/questions.json` by `id`, with `participant_id = NULL` and `status = 'open'`, and wire `make seed`. Runs under `node --conditions=react-server` so the `server-only` guard in `client.ts` resolves to its empty build

**Checkpoint**: Database, identity, validation, and the design system all work and are tested.
User stories can now proceed in any order.

---

## Phase 3: User Story 1 — Arrive and get a question (Priority: P1) 🎯 MVP

**Goal**: A first-time visitor lands, becomes an anonymous participant, and is shown one open
question with two ways forward.

**Independent test**: Seed the pool, open the site as a new visitor on a phone and a desktop
browser, and confirm the landing screen and a question both render correctly.

### Tests for User Story 1

- [x] T043 [P] [US1] E2E test in `tests/e2e/copy.spec.ts`: `/` renders `Happen to Have?`, `Answer one. Ask one.`, `Find me a question`, and the helper line verbatim from [contracts/copy.md](contracts/copy.md)
- [x] T044 [P] [US1] E2E test in `tests/e2e/copy.spec.ts`: the product name retains its question mark, including in `<title>`
- [x] T045 [P] [US1] Integration test in `tests/integration/identity-on-interaction.test.ts`: loading `/` creates **no** participant row; interacting does
- [x] T046 [P] [US1] E2E test in `tests/e2e/copy.spec.ts`: `/answer` renders one question with `I can answer this` and `Try another question`
- [x] T047 [P] [US1] E2E test in `tests/e2e/a11y.spec.ts`: `navigator.mediaDevices.getUserMedia` is never invoked on any route (SC-005)

### Implementation for User Story 1

- [x] T048 [US1] Build the landing screen in `app/page.tsx` — status dot, H1, tagline, primary action, helper; desktop adds the footer line and the `1fr 1fr` grid with a 520px copy column
- [x] T049 [US1] Write the native-SQL selection query in `src/db/queries/questions.ts` exactly as specified in [data-model.md](data-model.md). Use `IS DISTINCT FROM` for the own-question exclusion — plain `<>` silently drops every seeded row, whose `participant_id` is `NULL`. This is the easiest bug in the feature to write
- [x] T050 [US1] Compute published-answer counts relationally with `COUNT` in `src/db/queries/questions.ts`. Introducing a denormalized counter is forbidden by the constitution: it drifts, and a drifted count silently corrupts both the fewer-answers bias and 004's closure rule
- [x] T051 [US1] Implement `POST /api/questions/next` in `app/api/questions/next/route.ts` per [contracts/routes.md](contracts/routes.md), returning `{ question }` or `{ question: null }`, and `export const dynamic = 'force-dynamic'`
- [x] T052 [US1] Build `src/ui/QuestionCard.tsx` — question text and both actions, **with no eyebrow label above it** (research D15)
- [x] T053 [US1] Build the selection screen in `app/answer/page.tsx` using QuestionCard; desktop uses the `minmax(0,1.4fr) minmax(0,1fr)` grid with the actions in a `--green-06` panel
- [x] T054 [US1] Create identity through `POST /api/questions/next`, not during Server Component rendering, per [contracts/session.md](contracts/session.md)
- [x] T055 [US1] Point `I can answer this` at a disabled or placeholder target for `/answer/record`; 003 delivers it, and it must never request microphone permission from this feature's code

**Checkpoint**: US1 is independently demoable. This is the MVP.

---

## Phase 4: User Story 2 — Skip until something fits (Priority: P2)

**Goal**: Unlimited skipping with no penalty, no recording, and no effect on ask eligibility.

**Independent test**: With several seeded questions, skip repeatedly and confirm a different
question appears each time, no recording begins, and ask eligibility never changes.

### Tests for User Story 2

- [x] T056 [P] [US2] E2E test in `tests/e2e/skip.spec.ts`: twenty consecutive skips each yield a different question (SC-003)
- [x] T057 [P] [US2] Integration test in `tests/integration/skip-writes-nothing.test.ts`: skipping writes **nothing** to `participants` or `answers`, and `can_ask` is unchanged
- [x] T058 [P] [US2] Integration test, folded into `tests/integration/skip-writes-nothing.test.ts` as its own describe block: the question just skipped is never the immediately next one (FR-024)

### Implementation for User Story 2

- [x] T059 [US2] Implement tab-local traversal in `src/ui/QuestionCard.tsx` — the ordered `queue` from `/next` plus a pointer in React state. Advancing wraps at the end and **never** writes a cookie or calls the server
- [x] T060 [US2] **No skip endpoint.** `/next` returns the full eligible `queue`, so a skip never leaves the tab — every no-write requirement holds by construction rather than by promise. Reconciled in [contracts/routes.md](contracts/routes.md)
- [x] T061 [US2] Obsolete with T060. Staleness is caught at submission by 003's authorship and published-answer checks, not by re-validating on every skip
- [x] T062 [US2] Wire `Try another question` in `src/ui/QuestionCard.tsx` to advance without requesting microphone permission

**Checkpoint**: US1 and US2 both work independently.

---

## Phase 5: User Story 3 — Never the wrong question (Priority: P3)

**Goal**: A participant is never handed their own question or one they already have published, and
closed questions stop being routed.

**Independent test**: Create a participant with one authored question, one question they have a
published answer to, and one carrying only a withheld attempt. Request repeatedly: the first two
never appear, the third still does.

### Tests for User Story 3

- [x] T063 [P] [US3] Integration test in `tests/integration/exclusions.test.ts`: a participant's own question is never selected
- [x] T064 [P] [US3] Integration test in `tests/integration/exclusions.test.ts`: a question with a **published** answer from this participant is never selected
- [x] T065 [P] [US3] Integration test in `tests/integration/exclusions.test.ts`: a question carrying only a withheld or failed attempt **stays selectable**. Under Principle V no row exists for those attempts at all, so this holds by construction — the test guards against a future regression that starts persisting them
- [x] T066 [P] [US3] Integration test in `tests/integration/exclusions.test.ts`: a closed question is never selected
- [x] T067 [P] [US3] Integration test in `tests/integration/selection-bias.test.ts`: across 100 selections, lower-count questions appear materially more often than higher-count ones (SC-004)
- [x] T068 [P] [US3] Integration test in `tests/integration/exclusions.test.ts`: seeded questions, whose `participant_id` is `NULL`, are still selectable — the `IS DISTINCT FROM` regression guard

### Implementation for User Story 3

- [x] T069 [US3] Apply the own-question and published-answer exclusions in `src/db/queries/questions.ts`
- [x] T070 [US3] Apply the closed-question exclusion in `src/db/queries/questions.ts`, reading the `status` that 004 owns and writes
- [x] T071 [US3] Order by published-answer count ascending with a tiebreak in `src/db/queries/questions.ts`, per research D10 — a bias, not a strict ordering, so concurrent participants do not collide
- [x] T072 [US3] Enforce every exclusion server-side in `app/api/questions/next/route.ts` regardless of what the interface allowed

**Checkpoint**: Selection is correct under all exclusion rules.

---

## Phase 6: User Story 4 — Nothing left to answer (Priority: P4)

**Goal**: Empty, loading, and failure states that never show a broken screen or an ineligible
question.

**Independent test**: Reduce the eligible pool to zero for one participant and confirm the empty
state renders rather than an error, a blank screen, or an ineligible question.

### Tests for User Story 4

- [x] T073 [P] [US4] Integration test in `tests/integration/empty-pool.test.ts`: zero eligible questions returns `{ question: null }`, not an error
- [x] T074 [P] [US4] E2E test in `tests/e2e/states.spec.ts`: the empty state renders its copy and no ineligible question is shown to fill the gap
- [x] T075 [P] [US4] E2E test in `tests/e2e/states.spec.ts`: an induced selection failure renders the failure state with a working retry

### Implementation for User Story 4

- [x] T076 [P] [US4] Empty state renders inside `src/ui/QuestionCard.tsx` rather than a separate `EmptyPool.tsx`. The pool is empty only when the client's fetch returns `queue: []`, so the state belongs with the component that knows that. No design exists for it — authored copy, flagged for a design pass
- [x] T077 [P] [US4] Loading state renders inside `src/ui/QuestionCard.tsx`. A route-level `app/answer/loading.tsx` would never appear: `/answer` is a Server Component that awaits nothing, so no Suspense boundary ever suspends. Adding one would be a file that cannot execute
- [x] T078 [P] [US4] Two failure paths, deliberately. `src/ui/QuestionCard.tsx` handles the selection request failing — client-side and recoverable in place. `app/answer/error.tsx` is the route boundary for the Server Component itself throwing, which would otherwise surface as Next's default error page
- [x] T079 [US4] Return `{ error: "selection_failed" }` with a 500 from `app/api/questions/next/route.ts` on query failure — never a stack trace, never a database message

**Checkpoint**: All four user stories complete.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T080 [P] E2E test in `tests/e2e/design.spec.ts`: **no device or browser frame** renders anywhere — those exist only in the design canvas
- [x] T081 [P] E2E test in `tests/e2e/design.spec.ts`: only Sour Gummy and Source Sans 3 are requested; zero network requests for any other family, and no participant content is set in Sour Gummy
- [x] T082 [P] E2E test in `tests/e2e/design.spec.ts`: no uppercase eyebrow label renders on any screen
- [x] T083 [P] E2E test in `tests/e2e/a11y.spec.ts`: every interactive element shows a visible `:focus-visible` ring; primary ≥56px, ghost ≥52px, header ≥44px
- [x] T084 [P] E2E test in `tests/e2e/a11y.spec.ts`: the watermark and status dot are `aria-hidden`
- [x] T085 [P] E2E test in `tests/e2e/responsive.spec.ts`: `scrollWidth <= clientWidth` at 402, 767, 768, 1100, and 1440 px, and the desktop grid engages at exactly 768px
- [x] T086 [P] E2E test in `tests/e2e/copy.spec.ts`: a case-insensitive scan of every rendered route finds none of the forbidden terms in [contracts/copy.md](contracts/copy.md) — no "expert", no "agent", no "safe", no dialect spelling
- [x] T087 [P] Verify `.neon` and `.env` are gitignored and that a fresh `make db-up && make migrate && make seed` reproduces the schema and pool on a new Neon branch
- [x] T088 Walk every scenario in [quickstart.md](quickstart.md) end to end against a fresh clone of the repository root
- [x] T089 Run `make ai-checks` from the repository root and confirm **zero warnings** — the constitution treats warnings as hard errors
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
  (T019–T025) and the identity block (T028–T033); three people could work at once. T032a must
  follow T027 and T032, never precede them
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

---

## Phase 8: Convergence

- [ ] T091 Reach the 15-question floor in `seed/questions.json`; it currently holds six. Seeds MUST be human-authored per `TODO(SEED_CONTENT)` — do not generate substitutes or claim seed readiness has passed per FR-026, SC-008 (partial)
- [x] T092 Add the fixed string `This is the only question waiting right now.` to `src/copy.ts` and render it in `src/ui/QuestionCard.tsx` when `queue.length === 1`, so the sole eligible question stays visible with an explanation instead of silently re-rendering per FR-024, US2/AC6 (missing)
- [x] T093 Re-fetch `POST /api/questions/next` when the pointer wraps past the end in `src/ui/QuestionCard.tsx`, so each new pass starts from a refreshed, re-sorted eligible list; reconcile the "never re-request" bullet in `specs/001-participant-and-pool/contracts/routes.md` with the requirement per FR-025, US2/AC5, plan: tab-local traversal refreshes on wrap (partial)
- [x] T094 Write `tests/integration/identity-on-interaction.test.ts` asserting that loading `/` creates no `participants` row and that `POST /api/questions/next` does per FR-001 (missing)
- [x] T095 Extend `tests/e2e/skip.spec.ts` to traverse and wrap against one-question and two-question pools, not only the seeded pool per SC-003 (missing)
- [ ] T096 Cap the queue `POST /api/questions/next` returns in `src/db/queries/questions.ts`, and re-fetch as the pointer nears the end. Deliberately deferred: the seeded pool is small enough that sending it whole is fine, and a cap written before the pool is large is a guess. Do not build until the pool makes it matter per plan: tab-local traversal, FR-025 (partial)
