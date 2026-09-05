# Specification Quality Checklist: Ask One

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-04
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
- [x] Review behavior is consumed, not restated
- [x] Recording behavior is explicitly reused from 003 rather than respecified
- [x] Shared ownership is identified; cross-flow enforcement references its owning spec

## Constitution Alignment (v2.0.0)

| Principle | Covered by |
|-----------|------------|
| I. Human Contribution Is The Product | FR-009, FR-010 |
| II. Server-Authoritative Reciprocity | FR-001 – FR-004, FR-016 – FR-027, SC-002 – SC-005, SC-008 |
| III. Aggregate Guardrail Gate | FR-011 – FR-013 |
| V. Structured Output Or Failure | FR-014, FR-021 |

## Validation Notes

- FR-024 and FR-025 make the closure rule precise where the handoff was terse: closure counts
  three *distinct participants* with published answers; a unique participant/question constraint
  prevents duplicate published answers from one participant.
- FR-027 and the concurrent-closure Assumption resolve an unstated race: a fourth answer landing
  with the third publishes normally. Closure governs future routing, not a hard cap on stored
  answers.
- Interrogative grammar is explicitly not enforced (Edge Cases, Assumptions). The product
  publishes what the participant said.
- Publication and ask consumption are atomic; no unpublished question rows are retained.
- All Withheld variants, including crisis, return question retry to `/ask` with the ask intact.
- Zero [NEEDS CLARIFICATION] markers.

## Notes

- Specification decisions are synchronized; implementation validation remains pending.
