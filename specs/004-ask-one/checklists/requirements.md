# Specification Quality Checklist: Ask One

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-04
**Last revised**: 2026-09-06 — re-validated after the hole-finding pass against shipped 001–003.
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [ ] Implementation meets measurable outcomes defined in Success Criteria (runtime proof pending)
- [x] No implementation details leak into specification

## Split Integrity

- [x] Owns ask consumption and the question lifecycle; 003 owns granting
- [x] Owns the closure rule; 001 honors the resulting state without redefining it
- [x] Owns every state at `/ask`, including the unlocked screen 003 links to and does not build
- [x] Review behavior is consumed, not restated
- [x] Recording behavior is explicitly reused from 003 rather than respecified
- [x] Rate limiting is consumed from 002; only its effect on the ask is stated here
- [x] Shared ownership is identified; cross-flow enforcement references its owning spec
- [x] Closed-question visibility is 005's FR-015; 004 guarantees only that closure destroys nothing

## Constitution Alignment (v5.0.1)

| Principle | Covered by |
|-----------|------------|
| I. Human Contribution Is The Product | FR-009, FR-010 |
| II. Server-Authoritative Reciprocity | FR-001 – FR-004a, FR-016 – FR-027a, SC-002 – SC-005, SC-008 |
| III. Aggregate Guardrail Gate | FR-006a, FR-008a, FR-011 – FR-013 |
| V. Structured Output Or Failure | FR-014, FR-014a, FR-021, SC-012 |
| VI. Scope Discipline | FR-023a (no stored status, no job, no counter), Out of Scope |
| VII. Voice And Provenance | FR-015a defers wording to the copy contract; no string is invented here |

## Holes closed in the 2026-09-06 revision

Each was found by reading the spec against the code 001–003 actually shipped.

| Hole | Closed by |
|------|-----------|
| Closure mechanism never specified; 001 shipped a `questions.status` enum nothing writes | FR-023a, Assumptions "Closure is derived" |
| No terminal state for a question that publishes — no design screen, no copy, no requirement | FR-015a, US1 AS6, SC-011 |
| Sixty-second ceiling was recorder-only; no server-side refusal, unlike 003 FR-013 | FR-006a, US2 AS7, SC-007 |
| No submission idempotency; a lost response would strand a spent ask with no question visible | FR-014a, US3 AS8 |
| Rate-limited submission was neither "fails review" nor "infrastructure failure" | FR-018, US3 AS5, Assumptions "Rate limiting" |
| Sessionless submission unaddressed | FR-002a, US2 AS3, SC-002 |
| Refusal path for a participant with no ask left as "direct them", with no screen or destination | FR-003 |
| Declining the ask (`Not now — it'll keep`) had a string in the design and no destination | FR-004a, US1 AS9 |
| Seeded questions never mentioned; they have no asker and FR-026 had no subject for them | FR-026, FR-027a, US4 AS5 |
| FR-026 and SC-010 restated 005's FR-015 verbatim while Out of Scope delegated the same rule to 005 — and neither had a task, because the screen is 005's | FR-026 and SC-010 narrowed to the data guarantee 004 can prove; Out of Scope names 005's FR-015 explicitly |
| Empty-audio rejection specified in 003, absent here | FR-008a |
| Abandonment mid-review not stated as an ask-preserving outcome | FR-018, US3 AS9 |
| FR-024 stated a distinctness count the schema already makes unrepresentable | FR-024 rewritten to reference 003's rule instead of re-deriving it |
| Emotion returned by review for every contribution, with no statement of what a question does with it | Assumptions "Emotion" |
| `design.md` heads the unlocked screen "003" while its route map assigns `/ask` to 004 | Assumptions "Design coverage" |

## Validation Notes

- FR-023a is the load-bearing decision of this revision. Closure is a fact about a question's
  answers, so it is read from them. A stored status would have to be written from inside 003's
  shipped publication statement, can disagree with the rows it summarizes, and buys nothing the
  existing `answers_question_id_idx` does not already serve.
- FR-024 no longer asserts a countable rule. One participant cannot publish two answers to one
  question — 003 enforces it — so "three published answers" and "three distinct participants"
  are the same statement, and writing them as two invited a redundant check.
- FR-027 and the concurrent-closure Assumption resolve the fourth-answer race by removing it:
  with closure derived there is no state to reconcile after the fact.
- Interrogative grammar is explicitly not enforced (Edge Cases, Assumptions). The product
  publishes what the participant said.
- Publication and ask consumption are atomic; no unpublished question rows are retained.
- All Withheld variants, including crisis, return question retry to `/ask` with the ask intact.
- FR-015a fixes the shape of the published-question state and its destinations, not its wording.
  Participant-facing strings are authored in the copy contract under Principle VII; a spec that
  invented them would be putting generated copy in front of a reader.
- FR-026 and SC-010 were the one place this spec broke its own ownership rule. They asserted a
  screen 004 does not build, in the same words 005 already uses, while Out of Scope pointed at
  005 for exactly that. Both now state what 004 can actually prove — closure changes routing and
  nothing else — and the visibility requirement is referenced rather than restated.
- Zero [NEEDS CLARIFICATION] markers.

## Notes

- Specification decisions are synchronized; implementation validation remains pending.
- Two open items belong to `/speckit-plan`, not here: dropping the unused `questions.status`
  column and its index in a 004 migration, and the wording of the published-question copy.
