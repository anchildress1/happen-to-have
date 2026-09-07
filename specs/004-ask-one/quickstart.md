# Quickstart: Ask One

**Feature**: 004-ask-one · **Date**: 2026-09-06

How to prove each success criterion, and what is honestly not proven yet.

---

## Run it

```bash
make install
make db-up && make migrate && make seed
make dev            # http://localhost:3000
```

`GEMINI_API_KEY` must be set or every submission returns `failed` — correctly, but it will look
like a bug for the thirty seconds it takes to notice.

**`/ask` is unreachable until you earn it.** That is the feature. Answer a question at
`/answer` first; the published-answer screen's `Ask your question` is the way in. Visiting
`/ask` directly with no ask redirects to `/answer`, which is FR-003 working, not a broken link.

To skip the earning while working on the ask flow:

```bash
make db-shell
# UPDATE participants SET can_ask = true WHERE id = '<your session's participant>';
```

Read the id from the session cookie, or take the most recent row. **Do not add a dev bypass to
the application** — an env-gated route that grants asks is a second, weaker path through the
one rule the product has.

```bash
make ai-checks      # format, lint, typecheck, unit, integration, secrets
make e2e            # Playwright against a disposable Neon branch
```

**`make migrate` drops columns in this feature.** Nothing is deployed anywhere, so a branch
database that disagrees is rebuilt with `make db-up && make migrate && make seed` rather than
repaired.

---

## Proving the success criteria

| SC | How | Where |
| - | - | - |
| **SC-002** no ask, no question | call `publishQuestion` directly for a participant with `can_ask = false`; then `POST /api/ask` with no session cookie at all | integration |
| **SC-003** never two questions for one ask | two qualifying submissions from one participant with one ask; assert one row, `can_ask` false | integration |
| **SC-004** the ask survives everything | stub the review to return `withheld`, `failed`, `rate_limited` in turn, and abort a fourth mid-flight; assert `can_ask` still true and zero rows after each | integration |
| **SC-005** consumed exactly once | two concurrent `publishQuestion` calls, one ask; assert exactly one row and one flip | integration |
| **SC-006** visible to others immediately | publish as A, call `listEligibleQuestions(B)`, assert it appears | integration |
| **SC-007** ceiling refused server-side | `POST /api/ask` with `durationSeconds: 61`, and again with `0`; assert refusal before any provider call is made. **Also assert a one-second question publishes** — FR-008 forbids a minimum, and a bounds-only test reads like one | integration |
| **SC-008** closes at exactly three | insert two answers → still routed; a third → gone. Repeat for a seeded question (`participant_id IS NULL`) | integration |
| **SC-009** unanswered never expires | a question with zero answers, `created_at` backdated a year; assert still routed | integration |
| **SC-010** closure hides nothing | close a question, then re-read it and every answer; assert all rows unchanged and readable — the *screen* is 005's | integration |
| **SC-011** publication is never silent | publish through the UI, assert the confirmation renders | e2e |
| **SC-012** no row for a non-publication | after each non-publishing outcome, `SELECT count(*) FROM questions` is unchanged | integration |
| **FR-003** the gate | visit `/ask` with no ask; assert the redirect to `/answer` | e2e |
| **FR-014a** replay | publish, then re-POST the same `submissionId`; assert `published` and still one row | integration |
| **research D6** spent | publish, then POST a *different* `submissionId`; assert `spent`, not `failed` | integration |

**SC-002 is tested by calling the query directly, not through the route.** Testing it through
the interface proves the interface hides the button. FR-002 requires the server to refuse
regardless of what the interface allowed, and only a direct call asks that question.

**SC-008's seeded case is not redundant.** A seeded question has `participant_id IS NULL`, and
001 already shipped one NULL-handling bug in this area — `<>` instead of `IS DISTINCT FROM`
dropped every seeded question from the pool. Closure is a new predicate over the same rows.

**The e2e suite must navigate, never construct URLs.** 003 shipped eleven green e2e tests over
a recorder no real participant could reach, because the tests built the URL themselves and
supplied a query parameter the app never sends. Reach `/ask` by answering and clicking through.

---

## ⚠️ Not proven — required before launch

### 1. Real browsers, real microphones

Inherited from 003 unchanged, and not re-opened here. Everything is Playwright with a faked
media stream; no real microphone has recorded into this app. The question recorder is the
answer recorder, so one round of device testing covers both.

| Budget | Pass |
| - | - |
| Current iPhone Safari | permission grant, 60 s recording, publishes |
| Current Android Chrome | same |

### 2. Latency at the ceiling — inherited from 002 (T080)

SC-001's two minutes is dominated by the review fan-out, measured at 2.4 s median on 12–16 s
clips and never re-measured at 60 s. A question dispatches **three** calls rather than four, so
it is the cheaper of the two flows and still unmeasured at the ceiling.

### 3. Closure under real routing load

| Budget | Pass |
| - | - |
| Six seeded questions, three participants answering steadily | the pool empties into 001's empty state rather than re-serving a closed question |

**This is expected behaviour, not a defect**, and it is worth watching during the demo: six
seeds × three answers is eighteen answers before the seeded pool is exhausted, and participant
questions are the only thing that refills it. If the demo runs long, the empty state is what a
judge sees.

### 4. The aggregate query at scale

`HAVING COUNT(a.id) < 3` aggregates every question's answers on every selection
([research D3](research.md)). Unmeasurable at demo scale and deliberately un-optimized.

| Budget | Pass |
| - | - |
| 10k questions, 30k answers, `EXPLAIN ANALYZE` the selection | if it leaves interactive range, the fix is a materialized count — not the `status` column this feature removed |

### 5. Two devices, one ask

The concurrency the row lock is supposed to make impossible. The single-statement consume
*should* make it true by construction; *should* is not a measurement.

| Budget | Pass |
| - | - |
| One participant, two browsers, two questions submitted together | exactly one question row, `can_ask` false, the loser sees `spent` |

---

## Settled — do not re-litigate

| Question | Answer | Evidence |
| - | - | - |
| Insert then consume, mirroring 003's grant? | No. Granting is idempotent; consuming is not | [D1](research.md) |
| Is the ask guard enough for idempotency? | No — it prevents double publication and makes a lost response unrecoverable | [D2](research.md) |
| Should closure flip `questions.status`? | No. It is a fact about the answers, so it is read from them | [D3](research.md) |
| Keep `status` for a future manual close? | No. Nothing asks for it, and Out of Scope names reopening | [D3](research.md) |
| Reuse `POST /api/question`? | No. That path is 001's selection endpoint and does the opposite | [D4](research.md) |
| Copy `AnswerOutcome.tsx` for questions? | No. It already carries both flows' copy; only destinations differ | [D5](research.md) |
| Reuse `ineligible` for a spent ask? | No. Its helper tells the participant to do something the server will refuse | [D6](research.md) |
| Count `DISTINCT participant_id` for closure? | No. The unique constraint already makes three answers three participants | FR-024 |
| Does 004 prove the asker can *see* a closed question? | No. It proves the data survives closure; the screen is 005's FR-015 | FR-026 |
