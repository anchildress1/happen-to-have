# Feature Specification: Ask One

**Feature Branch**: `004-ask-one`

**Created**: 2026-09-04

**Status**: Draft

**Input**: AI handoff "Happen to Have?" revision 4 — Record a question, Reciprocity, question lifecycle and closure rules.

## Overview

A participant who earned an ask spends it. They record their own question by voice, it goes
through the same review, and when it passes it joins the pool for other people to answer. The
ask is gone. To ask again, they answer again.

This is the half of the rule that comes second: **ask one**.

**Depends on**: [002-contribution-review](../002-contribution-review/spec.md) for the decision.
[003-answer-and-unlock](../003-answer-and-unlock/spec.md) grants the ask this spec spends.

**Consumed by**: [001-participant-and-pool](../001-participant-and-pool/spec.md) selects from
the questions this spec publishes and honors the closure rule defined here.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Spend the ask (Priority: P1)

A participant just earned an ask. They record their own question — up to a minute, in their own
voice. The site checks it. When it passes, their question joins the pool, their ask is spent,
and they are back to needing an answer before they can ask again.

**Why this priority**: This closes the loop. Without it the earned ask is a badge, not a right,
and the pool never grows past its seed content.

**Independent Test**: Grant a participant an ask, record a question, confirm it appears in the
pool for a second participant, and confirm the first participant can no longer ask.

**Acceptance Scenarios**:

1. **Given** a participant holding one unspent ask, **When** they enter the ask flow, **Then** they may record a question by voice.
2. **Given** a recorded question, **When** it is submitted, **Then** it is sent for review and a checking state is shown.
3. **Given** a question that passes review, **When** the outcome resolves, **Then** the processed text is published to the open pool.
4. **Given** a question that was just published, **When** a different participant requests a question to answer, **Then** the new question is eligible for selection.
5. **Given** a published question, **When** the participant's ask eligibility is checked, **Then** the ask has been consumed and they hold none.
6. **Given** a participant whose question just published, **When** they return to the site, **Then** they are back in the state of needing an answer before they can ask.
7. **Given** a question of any duration at or under sixty seconds, **When** it passes review, **Then** it publishes; no minimum duration is applied.

---

### User Story 2 - You cannot ask without answering (Priority: P2)

Someone tries to ask a question without having answered one. It does not work — not through the
interface, and not by going around it. Asks cannot be stockpiled either: two qualifying answers
still leave you holding one.

**Why this priority**: The reciprocity rule is the only rule the product has. An ask flow that
can be reached without an earned ask makes the entire premise decorative.

**Independent Test**: Attempt to submit a question as a participant with no ask, both through the
interface and by direct submission. Confirm both are refused. Then earn two asks and confirm only
one question can be submitted.

**Acceptance Scenarios**:

1. **Given** a participant with no unspent ask, **When** they attempt to reach the ask flow, **Then** it is refused and they are directed to answer a question first.
2. **Given** a participant with no unspent ask, **When** they submit a question directly, bypassing the interface, **Then** the server refuses it and nothing is published.
3. **Given** a participant who has completed two qualifying answers, **When** their eligibility is checked, **Then** they hold exactly one ask, not two.
4. **Given** a participant who just published a question, **When** they attempt to ask a second one, **Then** it is refused until they complete another qualifying answer.
5. **Given** a participant submitting two questions at nearly the same moment with one ask, **When** both are evaluated, **Then** exactly one question is published and exactly one ask is consumed.

---

### User Story 3 - The ask survives a bad outcome (Priority: P3)

A participant's question does not pass review, or the check breaks halfway through. Either way
they still hold their ask. They earned it with an answer; a rejected recording does not take it
away.

**Why this priority**: Consuming an ask on a failed submission punishes a participant for a
guardrail decision or an outage. It is the difference between a rule and a trap.

**Independent Test**: Submit a question that fails review, and separately one that hits an
infrastructure failure. Confirm the ask is still held in both cases and a retry or a fresh
recording works.

**Acceptance Scenarios**:

1. **Given** a question that fails review, **When** the outcome resolves, **Then** nothing is published and the participant still holds their unspent ask.
2. **Given** a question submission that hits an infrastructure failure, **When** the retryable state is shown, **Then** the participant still holds their unspent ask.
3. **Given** a retryable failure on a question, **When** the participant retries and review passes, **Then** the question publishes and the ask is consumed exactly once.
4. **Given** a question withheld for any reason, **When** the participant returns, **Then** they may record a different question immediately with no penalty.
5. **Given** any question submission, **When** the ask is evaluated for consumption, **Then** it is consumed only at the moment the question is successfully created.

---

### User Story 4 - A question's life (Priority: P4)

A published question waits. If nobody answers it, it waits forever. Once three different people
have answered it, it stops being handed out — those three answers are what it needed — but the
person who asked can still see it and everything that came back.

**Why this priority**: Without closure, popular questions absorb every answer in the pool and
new questions starve. Without indefinite openness, a quiet question dies before anyone sees it.

**Independent Test**: Publish a question, collect three published answers from three distinct
participants, and confirm it stops being routed while remaining fully visible to its asker.
Separately, leave a question unanswered and confirm it never expires.

**Acceptance Scenarios**:

1. **Given** a published question with no answers, **When** any amount of time passes, **Then** it remains open and eligible for routing, with no expiry.
2. **Given** a question with three published answers from three distinct participants, **When** the pool selects questions for anyone, **Then** that question is no longer routed.
3. **Given** a closed question, **When** its asker views it, **Then** the question and all of its answers remain visible to them.
4. **Given** a question with three published answers from only two distinct participants, **When** routing is evaluated, **Then** the question is still open, because closure counts distinct participants.
5. **Given** a question with withheld answers, **When** routing is evaluated, **Then** withheld answers do not count toward closure.
6. **Given** two participants submitting the third and fourth qualifying answers at nearly the same moment, **When** both resolve, **Then** both answers publish and are visible to the asker, and the question is closed for future routing.

---

### Edge Cases

- **Question recorded but never submitted**: the participant abandons the flow. Nothing is published, the ask is still held, and no recording persists.
- **Ask flow entered, then abandoned**: the participant leaves without recording. The ask remains unspent and the flow can be re-entered.
- **Question signals crisis**: withheld and routed to fixed resources exactly as an answer would be. Not published, and the ask is still held.
- **Question is unintelligible or silent**: withheld, ask still held, participant may re-record immediately.
- **Question that is not a question**: content processing publishes what was said as readable text. The product does not enforce interrogative grammar.
- **Session reset while holding an ask**: the participant becomes a new participant and loses the unspent ask. Accepted limitation of session-scoped identity.
- **Very long question**: capped by the sixty-second ceiling like any other recording.
- **Asker never returns**: the question stays in the pool and continues collecting answers until it closes.

## Requirements *(mandatory)*

### Functional Requirements

#### Access

- **FR-001**: The system MUST allow entry to the ask flow only for a participant holding one unspent ask.
- **FR-002**: The system MUST refuse a question submission, server-side, from a participant with no unspent ask, including submissions that bypass the interface.
- **FR-003**: The system MUST direct a participant with no unspent ask to answer a question first.
- **FR-004**: The system MUST evaluate ask eligibility on the server; client-supplied eligibility MUST be treated as advisory only.

#### Recording

- **FR-005**: The system MUST capture questions as voice recordings in the browser.
- **FR-006**: The system MUST stop question recording automatically at sixty seconds.
- **FR-007**: The system MUST display elapsed time and the remaining limit while recording.
- **FR-008**: The system MUST NOT enforce a minimum recording duration for questions.
- **FR-009**: The system MUST NOT answer the question, generate follow-up questions, or produce conversational prompts during submission.
- **FR-010**: The system MUST NOT offer follow-up questions on a published question.

#### Review and publication

- **FR-011**: The system MUST submit the question recording for review on the server, through the same review used for answers.
- **FR-012**: The system MUST display a checking state while question review is in progress.
- **FR-013**: The system MUST publish a question only after its review passes.
- **FR-014**: On a passing review, the system MUST persist the processed text and publish the question to the open pool.
- **FR-015**: A published question MUST become eligible for selection by other participants.

#### Ask consumption

- **FR-016**: The system MUST consume the participant's ask only at the moment the question is successfully created.
- **FR-017**: The system MUST NOT consume an ask when a question fails review.
- **FR-018**: The system MUST NOT consume an ask when a question submission hits an infrastructure failure.
- **FR-019**: The system MUST consume exactly one ask per published question, even under concurrent or duplicate submission.
- **FR-020**: On a published question, the system MUST return the participant to the state of needing an answer before they can ask again.
- **FR-021**: A withheld or failed question MUST NOT produce a penalty, cooldown, or strike, and the participant MUST be able to record another immediately.

#### Question lifecycle

- **FR-022**: A published question with no answers MUST remain open and eligible for routing indefinitely, with no expiry.
- **FR-023**: A question MUST close for further routing once it holds three published answers from three distinct participants.
- **FR-024**: Closure MUST count distinct participants, not distinct answers.
- **FR-025**: Withheld answers MUST NOT count toward closure.
- **FR-026**: A closed question and all of its answers MUST remain visible to its asker.
- **FR-027**: Closure MUST affect future routing only, and MUST NOT invalidate an answer already in progress or already published.

### Key Entities

- **Question**: One participant's published question. Carries display text, source language, its author, routing status, safety outcomes, processing state, attempt history, and a reference to its transient original recording. Related to its answers and to its asker.
- **Ask Eligibility**: A participant's right to submit one question, granted in [003-answer-and-unlock](../003-answer-and-unlock/spec.md) and consumed here. Authoritative only on the server.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A participant holding an ask goes from entering the ask flow to a published question in under two minutes, including recording and review.
- **SC-002**: One hundred percent of question submissions from participants with no unspent ask are refused, including direct submissions that bypass the interface.
- **SC-003**: A participant never publishes two questions without two qualifying answers, across all attempts including concurrent submissions.
- **SC-004**: One hundred percent of failed and infrastructure-failed question submissions leave the participant's ask unspent.
- **SC-005**: An ask is consumed exactly once per published question, with zero double-consumption under duplicate or concurrent submission.
- **SC-006**: A question published by one participant becomes selectable by another within five seconds of publication.
- **SC-007**: Question recording stops automatically at sixty seconds in every tested browser, with zero submissions exceeding the ceiling.
- **SC-008**: A question closes for routing at exactly three published answers from three distinct participants, and never earlier, across the closure test set.
- **SC-009**: Zero unanswered questions become unreachable or ineligible through the passage of time.
- **SC-010**: A closed question and all of its answers remain fully visible to its asker in one hundred percent of cases.

## Assumptions

- **Shared recording behavior**: the question recorder behaves the same as the answer recorder — same ceiling, same timer, same permission and interruption handling. It is expected to reuse that behavior rather than reimplement it.
- **Grammar**: the product does not require a question to be grammatically interrogative. Whatever the participant said is published as readable text.
- **Closure count**: three published answers from three distinct participants, per the handoff. This is a routing rule only; it does not lock, archive, or hide anything.
- **Concurrent closure**: a fourth answer landing simultaneously with the third publishes normally. Closure is evaluated for future routing, not enforced as a hard cap on stored answers.
- **Ask durability**: an unspent ask persists for the life of the participant's session. Session reset loses it, per the accepted identity limitation.
- **Question playback in the pool**: whether a question can be listened to while being answered is specified in [003-answer-and-unlock](../003-answer-and-unlock/spec.md), not here.

## Out of Scope

- The review itself, the shared result page, crisis routing, and deletion of the original recording — specified in [002-contribution-review](../002-contribution-review/spec.md).
- Granting an ask — specified in [003-answer-and-unlock](../003-answer-and-unlock/spec.md).
- Question selection and skipping — specified in [001-participant-and-pool](../001-participant-and-pool/spec.md).
- Viewing responses to a published question — specified in [005-yours-and-playback](../005-yours-and-playback/spec.md).
- Editing, deleting, withdrawing, or reopening a published question.
- Follow-up questions, clarifications, or any further turn on a published question.
- Tagging, categorizing, or targeting a question at particular people.
- Banking, transferring, or purchasing asks.
- Notifying an asker when a response arrives.

## Dependencies

- [002-contribution-review](../002-contribution-review/spec.md) for the review decision, checking state, result page, retry behavior, and audio deletion.
- [003-answer-and-unlock](../003-answer-and-unlock/spec.md) for granted ask eligibility and the shared recording behavior.
- Browser microphone recording available on current mobile and desktop browsers.
- Durable storage for questions, their routing status, and participant ask eligibility.
