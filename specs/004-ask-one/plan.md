# Implementation Plan: Ask One

**Branch**: `004-ask-one` · **Date**: 2026-09-06 · **Spec**: [spec.md](spec.md)

## Summary

Spend the ask. Record a question, have 002 judge it, publish it, consume the ask — and stop
routing a question once three people have answered it.

Two halves that share nothing but a feature number:

- **`/ask`** — the whole route. 003 shipped a `Link href="/ask"` and no route behind it, so
  today the one screen that says *Ask one* leads to a 404. Everything at that URL is built here.
- **Closure** — 001 shipped `questions.status` with a comment saying only 004 writes it.
  Nothing ever does, and [FR-023a](spec.md) says nothing ever will: closure is derived from
  published answers at selection time. The column and its enum come out.

The review itself belongs to 002 and is consumed. Recording belongs to 003 and is reused.

## Technical Context

**Language/Version**: TypeScript 7.0.2 on Node.js 24 LTS, ESM only. Extensionless imports in
`src/` and `app/`, matching 001–003.

**Primary Dependencies**: none new. Next.js 16.3.4, React 19.2.8, `@neondatabase/serverless`
1.1.0, `iron-session` 9.0.1, Zod 4.5.4. `@google/genai` is reached only through `src/review`.

**Browser APIs**: `MediaRecorder` and `getUserMedia`, through 003's `useRecorder` unchanged.
This feature adds no browser capability and must not fork the recorder.

**Storage**: `questions` gains `duration_seconds` and `submission_id`, and **loses** `status`
and the `question_status` enum. `participants.can_ask` flips false here and nowhere else.

**Testing**: Vitest against real Postgres via PGlite for the publish statement and closure;
Playwright for the `/ask` gate, the recorder, and the terminal states. The existing
`tests/unit/copy.test.ts` sweep picks up the new strings automatically.

**Target Platform**: current mobile Safari and Android Chrome, plus desktop.

**Performance Goals**: SC-001's two minutes is dominated by 002's fan-out — three calls for a
question rather than four, since relevance is not dispatched. Still measured only on 12–16 s
clips ([002 T080](../002-contribution-review/tasks.md)); inherited, not re-opened.

**Constraints**: exactly one unspent ask; the ask is consumed only by a successful insert; no
row for anything that did not publish; closure never writes.

**Scale/Scope**: one route with three flow states (unlocked, recording, checking) and five
terminal ones, one endpoint, one statement, two migrations — one adding, one dropping — and
one changed line in 001's selection query.

## Constitution Check

Checked against constitution **v5.0.1**. Re-checked after Phase 1 design; result unchanged.

| Principle | Applies here? | Status | Evidence |
| - | - | - | - |
| I. Human Contribution Is The Product | Yes | **PASS** | FR-009/FR-010 forbid generated prompts, answers or follow-ups anywhere in the ask flow. The published question is what the participant said, processed to text and nothing more. |
| II. Server-Authoritative Reciprocity | **Yes — this is the feature** | **PASS** | FR-002/FR-002a/FR-004 put the gate on the server. FR-014 makes consumption and insertion one statement. FR-023/FR-023a hold the closure rule the constitution states. |
| III. Aggregate Guardrail Gate | Consumed | **PASS** | `reviewContribution({ kind: 'question' })` dispatches content, crisis and illegal — relevance is absent rather than null, which 002 already implements. Nothing here re-judges or bypasses a check. |
| IV. Original Audio Is Transient | Yes | **PASS** | The recording exists in the browser and in one request body. No draft, no resume, no object key. `recorder.discard()` on every exit, as 003 does. |
| V. Structured Output Or Failure | Yes | **PASS** | Only published questions become rows (FR-014). Withheld, failed, rate-limited and abandoned leave nothing — and FR-023a keeps closure out of the database too, so there is no derived state to reconcile either. |
| VI. Scope Discipline | Yes | **PASS** | No editing, withdrawing, reopening, tagging, or notifying — each in Out of Scope with a reason. FR-023a explicitly forbids adding a job or counter for closure. |
| VII. Voice And Provenance | Yes | **PASS** | Every string fixed in [contracts/copy.md](contracts/copy.md). The spec fixes FR-015a's *shape*; the wording is authored there. |

### Feature-specific gates

| Gate | Status | Note |
| - | - | - |
| `spent` does not add a guardrail outcome | **PASS** | Principle III enumerates outcomes for *rejections* — Withheld with a reason, or processing failure. `spent` is an eligibility refusal, not a verdict on the recording, and sits in the same class as 003's shipped `ineligible` ([research D6](research.md)). No review outcome is added, renamed, or bypassed. |
| Ask consumed only by a successful insert | **PASS** | The `UPDATE … WHERE can_ask = true` is the first CTE and the insert selects from it; no consume, no row ([research D1](research.md)). |
| Ask survives every non-publishing outcome | **PASS** | Review returns before anything is written, exactly as 003's route does. |
| Closure adds no write path | **PASS** | One `HAVING` clause in 001's selection query. No trigger, no job, no counter ([research D3](research.md)). |
| Duration re-checked server-side | **PASS** | FR-006a. Route rejects a declared duration outside 1–60 before review; the column carries the CHECK. |
| Idempotent across a repeated request | **PASS** | `submission_id UNIQUE` on `questions`, replayed before review. One recording sent twice, which is what the id covers; a re-record mints a new id and gets `spent` instead ([research D2](research.md), [D6](research.md)). |
| `/ask` unreachable without an ask | **PASS** | Server component redirects; the endpoint refuses independently (FR-002, FR-004). |

## Decisions this plan makes

Six, each with the alternative it beat. Full reasoning in [research.md](research.md).

| # | Decision |
| - | - |
| D1 | Consume-then-insert in one statement. Reversing the order lets two requests both insert. |
| D2 | `submission_id uuid NULL UNIQUE` on `questions`, same shape as 003. A lost response here strands a *spent* ask, which is worse than the answer-side case — and the id recovers the repeated-request half of it, never the re-record half. |
| D3 | Closure is a `HAVING COUNT(a.id) < 3` in the selection query. `questions.status` and its enum are dropped rather than left asserting a state nothing maintains. |
| D4 | The endpoint is `POST /api/ask`, not `/api/question` — 001 already owns that path for *selection*, and a submit endpoint sharing it would be two opposite operations under one name. |
| D5 | `AnswerOutcome.tsx` is generalized to a kind-parameterized outcome view rather than copied. It already carries both flows' copy; only the destinations differ. |
| D6 | A spent-ask race renders its own state, not 003's processing-failure page. "You can record again" is false once the ask is gone. |

## Divergences — found by this plan

Two, both inherited rather than introduced. Neither blocks the build; both are first tasks.

| # | What | Fix |
| - | - | - |
| D-1 | `AnswerOutcomeView` links to `/ask`, which 404s. 003 shipped the door with nothing behind it. | Closed by this feature existing. Not a separate task. |
| D-2 | `questions.status`, `questions_status_idx`, `question_status`, `questionStatusSchema` and `questionRowSchema.status` all exist to serve a closure mechanism this feature will not use. Two integration test helpers set `status: 'closed'` to fake closure. | Migration drops all three schema objects; `rows.ts` loses the field; the two helpers switch to inserting three answers, which is what closure now means. |

## Project Structure

### Documentation (this feature)

```text
specs/004-ask-one/
├── plan.md              # this file
├── research.md          # the six decisions worth recording
├── data-model.md        # what questions gains, what it loses, and why closure has no column
├── contracts/
│   ├── ask-api.md       # POST /api/ask — request, outcomes, status codes
│   └── copy.md          # every fixed string, including the two new states
├── quickstart.md        # how to prove each SC, and what is not proven
├── checklists/
│   └── requirements.md  # spec quality gate, plus the holes this revision closed
└── tasks.md             # generated by /speckit-tasks
```

### Source Code (repository root)

```text
app/
├── ask/
│   ├── page.tsx                 # server: reads can_ask, redirects when absent (FR-001–FR-004)
│   └── AskQuestion.tsx          # client: unlocked → record → checking → outcome
└── api/ask/route.ts             # the endpoint (D4)

src/
├── db/queries/questions.ts      # + publishQuestion, findQuestionBySubmission;
│                                #   listEligibleQuestions loses `status`, gains HAVING
├── schema/rows.ts               # questionRowSchema loses `status`; enum schema deleted
├── ui/
│   ├── ContributionOutcome.tsx  # renamed from AnswerOutcome.tsx, kind-parameterized (D5)
│   └── useRecorder.ts           # unchanged — reused, not forked
└── copy.ts                      # + ask.unlocked, ask.recording, review.publishedQuestion,
                                 #   review.spent — see contracts/copy.md

migrations/
├── 1788720000000_question-publication.sql   # + duration_seconds, submission_id
└── 1788730000000_drop-question-status.sql   # − status, its index, its enum (FR-023a)

tests/
├── integration/question-publish.test.ts   # consume-then-insert, races, idempotency
├── integration/closure.test.ts            # the three-answer rule, seeded and authored
├── integration/empty-pool.test.ts         # helper switched off `status`
├── integration/exclusions.test.ts         # same
└── e2e/ask.spec.ts                        # gate, unlocked, record, five terminal states
```

**Structure Decision**: unchanged from 001–003. One Next.js app, App Router, `src/` for
everything that is not a route. `/ask` is a single route with client-side state rather than
`/ask` plus `/ask/record`, because the design's route map gives both screens the same URL and
because the unlocked state has nothing to fetch.

## Complexity Tracking

| Deviation | Why it is necessary | Simpler alternative rejected because |
| - | - | - |
| A migration that **drops** columns rather than only adding | `questions.status` describes a mechanism FR-023a forbids. Left in place it is a schema-level claim that something maintains it, and the next reader wires a write to it. Nothing is deployed anywhere, so the drop costs a re-migrate of a dev branch and nothing else. | Leaving the column and ignoring it. That is how a stale field becomes a source of truth in someone's next query — 001's own comment already promises 004 will write it. |
| Renaming a shipped component (`AnswerOutcome` → `ContributionOutcome`) | It already renders both flows' copy and is about to render both flows' destinations. Keeping the answer-specific name while it serves questions makes every future reader check. | Copying it into `QuestionOutcome.tsx`. Ninety duplicated lines whose only differences are two strings and three hrefs, and two places to fix the next crisis-copy change. |
| A dedicated state for the spent-ask race (D6) | 003's `ineligible` renders the processing-failure page, whose helper says *you can record again*. For a consumed ask that is false, and it is the one lie the reciprocity rule cannot afford. | Reusing `ineligible`. Cheaper by one copy block, and it tells a participant to do something the server will refuse. |
