# Implementation Plan: Answer One

**Branch**: `003-answer-and-unlock` · **Date**: 2026-09-06 · **Spec**: [spec.md](spec.md)

## Summary

Record an answer, have 002 judge it, publish it, earn exactly one ask.

This is the first half of the product's rule and the only feature that *creates* the thing 004
spends. Everything here is either recording (client) or the one statement that publishes and
grants (server). The review itself belongs to 002 and is consumed, not rebuilt.

**A substantial part of this is already built and merged behind #24 and #25**, ahead of this
plan, because 002's engine did not exist and 003 could not be demonstrated without it. This
document is therefore partly a plan and partly an audit: the Divergences section below lists
every place the built code disagrees with the spec, and those are the first tasks.

## Technical Context

**Language/Version**: TypeScript 7.0.2 on Node.js 24 LTS, ESM only. Imports in `src/` and `app/`
carry no file extension, matching 001 and 002.

**Primary Dependencies**: no new ones. Next.js 16.3.4, React 19.2.8,
`@neondatabase/serverless` 1.1.0, `iron-session` 9.0.1, Zod 4.5.4, `@google/genai` 2.21.0 —
reached only through `src/review`, never directly from this feature.

**Browser APIs**: `MediaRecorder` and `getUserMedia`. Both are the first hard dependency in this
product on a capability the browser may simply refuse, which is why FR-028 – FR-031 exist and
why they are P4 rather than an afterthought.

**Storage**: `answers` gains the published text, its duration, and a submission id. Ask
eligibility stays where 001 put it — `participants.can_ask` — because it is a boolean permission,
not a ledger, and FR-023 caps it at one.

**Testing**: Vitest for the publish statement against real Postgres via PGlite; Playwright for the
recorder and the four terminal states. `getUserMedia` is faked at the browser level in e2e —
there is no honest unit test of a permission prompt.

**Target Platform**: current mobile Safari and Android Chrome (SC-009), plus desktop.

**Performance Goals**: SC-001's three minutes end to end is dominated by 002's fan-out, measured
at 2.4 s median on short clips and **not yet re-measured at the 60-second ceiling**. That gap is
002's T080 and is inherited here rather than re-opened.

**Constraints**: 60 s hard ceiling enforced client-side and re-checked server-side; exactly one
unspent ask; no row for anything that did not publish.

**Scale/Scope**: weekend challenge scale. One route, one endpoint, one statement, six terminal states (published, withheld, crisis, rate limited, failed, lost).

## Constitution Check

Checked against constitution **v5.0.0**. Re-checked after Phase 1 design; result unchanged.

| Principle | Applies here? | Status | Evidence |
| - | - | - | - |
| I. Human Contribution Is The Product | Yes | **PASS** | FR-009 forbids generated prompts, follow-ups or answers anywhere in the recording flow. Nothing in this feature writes text a participant did not say. |
| II. Server-Authoritative Reciprocity | **Yes — this is the feature** | **PASS** | FR-019 makes publication and the grant one statement. FR-024/FR-025 put eligibility on the server and treat the client's view as advisory. The ask is granted by the decision, never by the recording ending (FR-022). |
| III. Aggregate Guardrail Gate | Consumed | **PASS** | 003 calls `reviewContribution()` and acts on the outcome. It does not re-implement, bypass, or second-guess a check, and it writes nothing for a non-publish outcome. |
| IV. Original Audio Is Transient | Yes | **PASS** | The recording exists in the browser and in one request body. FR-030 discards an interrupted one; no draft, no resume, no object key (spec Out of Scope). |
| V. Structured Output Or Failure | Yes | **PASS** | Only published answers become rows (FR-019). Withheld, failed and abandoned leave nothing — which is what makes FR-017a's retry work with no status column to reconcile. |
| VI. Scope Discipline | Yes | **PASS** | No drafts, no resume, no editing, no ratings, no ask ledger. Each is in Out of Scope with the reason. |
| VII. Voice And Provenance | Yes | **PASS** | Every string fixed in [contracts/copy.md](contracts/copy.md). FR-020 fixes the success line verbatim. |

### Feature-specific gates

| Gate | Status | Note |
| - | - | - |
| No ask granted before a decision exists | **PASS** | The grant is inside the same statement as the insert, which runs only on `status === 'publish'`. |
| Eligibility enforced in SQL, not by a read-then-write | **PASS** | Every rule is a race; see [research D2](research.md). |
| Duration re-checked server-side | **PASS** | Route rejects a declared duration outside 1–60; `answers.duration_seconds` carries the CHECK (D-3). |
| Retry targets the same question | **PASS** | Every Withheld, crisis included, links `?questionId=<same>`; asserted in e2e against the id the app navigated with (D-2). |

## Divergences — found by this plan, now closed

The plan was written after most of the feature was built, so its first job was an audit. All
six are fixed; the table is kept because the *reasons* are the useful part, and because a
resolved-defect list is how the next reader learns what this feature got wrong.

| # | Spec | Was | Closed by |
| - | - | - | - |
| D-1 | FR-020 fixes `Your answer counts. Ask one.` | Invented copy — `Shared. Thank you.` | T018, T019 |
| D-2 | FR-027a: retry at `/answer/record?questionId=<same>` | Links carried no question, so every Withheld retry landed on an empty recorder | T042 |
| D-3 | Answer carries a duration; FR-013 re-checks it server-side | Ceiling enforced only by the recorder, which a crafted request skips | T002, T027 |
| D-4 | SC-007 wants idempotency across retries | Unique constraint alone — handled the double-tap, missed the retried upload | T002, T012 |
| D-5 | FR-028/FR-029 want three failure states | Denial reused the processing-failure helper | T038, T039, T040 |
| D-6 | Query param named `questionId` | Route read `q`; 001's `QuestionCard` had always sent `questionId` | T043 |

**A seventh, found later by review rather than by this audit.** The recorder read the question
text from a `text` query parameter that nothing in the app supplies, so it rendered
`Recording isn't built yet` to every real participant while eleven e2e tests reported FR-002
green — because those tests built the URL themselves. The page reads `getQuestionText` on the
server now, and the suite navigates from `/answer` through the real link. Recorded here
because it is the same class as D-1..D-6 and the audit missed it.

## Project Structure

### Documentation (this feature)

```
specs/003-answer-and-unlock/
├── plan.md              # this file
├── research.md          # the four decisions worth recording
├── data-model.md        # the answers columns and why can_ask is not a ledger
├── contracts/
│   ├── answer-api.md    # POST /api/answer — request, outcomes, status codes
│   └── copy.md          # every fixed string, FR-020 verbatim
├── quickstart.md        # how to prove each SC, and what is not proven
└── tasks.md             # generated by /speckit-tasks
```

### Source Code (repository root)

```
app/
├── answer/
│   ├── page.tsx                 # 001's selection, unchanged
│   └── record/
│       ├── page.tsx             # server Suspense boundary
│       └── RecordAnswer.tsx     # client: record, submit, render outcome
└── api/answer/route.ts          # the endpoint

src/
├── db/queries/answers.ts        # publishAnswer + PUBLISH_ANSWER_SQL
├── review/                      # 002, consumed only
└── ui/
    ├── useRecorder.ts           # MediaRecorder, the minute, format choice
    └── AnswerOutcome.tsx        # every terminal state

migrations/
└── *_answer-text.sql            # display_text, source_language, emotion (+ duration, submission id)

tests/
├── integration/answer-publish.test.ts
├── unit/recorder.test.ts
└── e2e/answer.spec.ts           # permission denial, the minute, the four states
```

## Complexity Tracking

| Deviation | Why it is necessary | Simpler alternative rejected because |
| - | - | - |
| A submission id column on `answers` | SC-007 asks for idempotency across *retries*, not just double-taps. The unique constraint covers one participant answering one question twice; it does not make the same upload retried after a dropped response safe. | Relying on `(participant_id, question_id)` alone. It silently satisfies the double-tap case and fails the network-retry case, which is the one that actually loses an answer. |
| Duration stored as well as checked | FR-013 requires it recorded, and 005 will want it. Checking without storing means re-deriving it from audio nobody kept. | Checking and discarding. Cheaper now, unmeasurable later. |
