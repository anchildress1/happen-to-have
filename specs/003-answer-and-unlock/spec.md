# Feature Specification: Answer One

**Feature Branch**: `003-answer-and-unlock`

**Created**: 2026-09-04

**Status**: Draft

**Input**: AI handoff "Happen to Have?" revision 5 — Record an answer, Process the answer, Reciprocity, participant state model.

## Overview

A participant looks at somebody's question, taps `I can answer this`, and talks for up to a
minute. The site tells them it is checking. When the check passes, their answer is published
under that question and they have earned exactly one ask.

This is the half of the rule that comes first: **answer one**.

**Depends on**: [001-participant-and-pool](../001-participant-and-pool/spec.md) for identity and
the selected question. [002-contribution-review](../002-contribution-review/spec.md) for the
decision, the checking state, the result page, and audio deletion.

**Consumed by**: [004-ask-one](../004-ask-one/spec.md) spends the ask this spec grants.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Record an answer and earn an ask (Priority: P1)

A participant reads a question they know something about, taps `I can answer this`, and speaks.
They stop after nine seconds because that is all they needed to say. The site checks their
answer. It passes. Their answer appears under that question and they are told they have earned
one ask.

**Why this priority**: This is the product. Everything else is either upstream of it or spends
what it produces.

**Independent Test**: With a seeded pool and a working review, record a relevant answer and
confirm it publishes under the question and the participant is told an ask is available.

**Acceptance Scenarios**:

1. **Given** a displayed question, **When** the participant chooses `I can answer this`, **Then** the question remains visible as text while they record.
2. **Given** a participant recording an answer, **When** they stop and submit, **Then** the recording is sent for review and a checking state is shown.
3. **Given** a nine-second answer that addresses the question, **When** review passes, **Then** the processed text is published under that question.
4. **Given** an answer that just passed review, **When** the outcome is shown, **Then** the participant sees `Your answer counts. Ask one.` and holds exactly one ask.
5. **Given** an answer of any duration at or under sixty seconds, **When** it passes review, **Then** it qualifies; no minimum duration is applied.
6. **Given** a published answer, **When** the participant returns to the answer flow, **Then** the question they just answered is never presented to them again.

---

### User Story 2 - The minute (Priority: P2)

A participant starts talking and keeps going. A timer shows how long they have been speaking and
how much is left. At sixty seconds the recording stops on its own — no lost answer, no truncated
upload, no confusion about what happened.

**Why this priority**: The ceiling is a hard product constraint and the timer is the only thing
that makes it feel intentional rather than broken. A recording that silently overruns or cuts off
without warning loses the contribution.

**Independent Test**: Record continuously past sixty seconds in a mobile and a desktop browser
and confirm the recording stops exactly at the ceiling with the captured audio intact.

**Acceptance Scenarios**:

1. **Given** a participant is recording, **When** the recording is in progress, **Then** elapsed time and the remaining limit are both visible.
2. **Given** a participant recording continuously, **When** sixty seconds elapse, **Then** recording stops automatically and the captured audio is intact and submittable.
3. **Given** a recording that stopped at the ceiling, **When** the participant is shown what happened, **Then** they understand the recording ended because the limit was reached, not because something failed.
4. **Given** any submitted answer, **When** its duration is evaluated, **Then** it is at most sixty seconds.
5. **Given** a participant recording on a phone, **When** they record for the full minute, **Then** the recording completes without the browser interrupting it.

---

### User Story 3 - Waiting for the verdict (Priority: P3)

The participant has submitted. The site says it is checking. Asking is not available yet — not
because they were rejected, but because nobody knows yet. They wait, and then they find out.

**Why this priority**: The unlock has to happen after the decision, never at the end of
recording. Getting this wrong is the single most likely way the reciprocity rule quietly becomes
decorative.

**Independent Test**: Submit an answer and, while review is in flight, attempt to reach the ask
flow directly. Confirm it is refused, then confirm it opens once review passes.

**Acceptance Scenarios**:

1. **Given** a submitted answer under review, **When** the participant attempts to ask a question, **Then** asking is unavailable and the checking state is still shown.
2. **Given** a recording that has just ended, **When** the recording stops, **Then** no ask is granted at that moment.
3. **Given** a participant with no earned ask and a review that has not completed, **When** eligibility is checked, **Then** it is false; an already-earned ask is not revoked by another review.
4. **Given** an answer whose review did not pass, **When** the outcome is returned, **Then** no ask is granted and the participant is returned to the answer flow.
5. **Given** a participant who already holds one unspent ask, **When** they submit another passing answer, **Then** they still hold exactly one ask and asks do not accumulate.
6. **Given** a participant attempting to bypass the interface and claim an ask directly, **When** the server evaluates eligibility, **Then** the claim is refused.

---

### User Story 4 - When recording will not work (Priority: P4)

The participant denies microphone permission, or their browser blocks it, or they walk away
mid-recording. They are told what happened and what to do about it, and nothing is left in a
half-finished state.

**Why this priority**: Microphone permission is the most common real-world failure in a
voice-first web app, and it happens before any of the interesting code runs.

**Independent Test**: Deny microphone permission, then interrupt a recording mid-way, and confirm
each produces a clear state with a way forward rather than a dead screen.

**Acceptance Scenarios**:

1. **Given** the participant denies microphone permission, **When** they try to record, **Then** they are told what is needed and how to grant it, and are not left on a dead recording screen.
2. **Given** the browser does not support recording, **When** the participant reaches the flow, **Then** they are told plainly rather than shown a broken control.
3. **Given** a recording in progress, **When** the participant navigates away or their connection drops, **Then** nothing is submitted, nothing is published, and their ask eligibility is unchanged.
4. **Given** a recording that captured no audio, **When** the participant submits, **Then** it is rejected before review work is spent.
5. **Given** an upload fails, **When** the failure is shown, **Then** the participant is told to record again and the original recording is discarded; no recoverable attempt is stored.

---

### Edge Cases

- **Question closes mid-answer**: the participant is recording when the question reaches its answer limit. Their answer is still accepted and published; closure affects future routing only.
- **Question deleted or unavailable at submit**: the submission is refused with an explanation and the participant is returned to selection with no penalty.
- **Duplicate submission**: the participant submits the same answer twice through a double tap or a retry. Exactly one answer is published and exactly one ask is granted.
- **Answer submitted for a question the participant already has published**: refused server-side, even if the interface allowed it.
- **Repeated withheld attempts on one question**: allowed. Nothing caps them except the submission rate limit, which is deliberate — a cap would punish someone whose microphone is bad rather than someone acting in bad faith.
- **Answer submitted for the participant's own question**: refused server-side, even if the interface allowed it.
- **Participant already holds an unspent ask**: a further passing answer publishes normally but grants no second ask.
- **Screen locks or the app backgrounds mid-recording on a phone**: the recording ends; whatever was captured is either submittable or discarded cleanly, never left ambiguous.
- **Extremely quiet recording**: caught as silence during review and withheld, granting no ask.

## Requirements *(mandatory)*

### Functional Requirements

#### Recording

- **FR-001**: The system MUST capture spoken answers in the browser on current mobile and desktop browsers.
- **FR-002**: The system MUST display the question being answered as text throughout recording.
- **FR-003**: The system MAY offer optional spoken playback of the question in the product's single voice.
- **FR-004**: The system MUST start the answer timer when recording starts.
- **FR-005**: The system MUST display elapsed time and the remaining limit while recording.
- **FR-006**: The system MUST stop recording automatically at sixty seconds.
- **FR-007**: The system MUST make clear that a recording stopped because the limit was reached, not because of a failure.
- **FR-008**: The system MUST NOT enforce a minimum recording duration.
- **FR-009**: The system MUST NOT generate conversational prompts, follow-up questions, or answers at any point in the recording flow.
- **FR-010**: The system MUST reject a recording that captured no audio before spending review work.

#### Submission and checking

- **FR-011**: The system MUST submit the original recording for review on the server.
- **FR-012**: The system MUST display a checking state while review is in progress.
- **FR-013**: The system MUST record the answer's duration and MUST reject any answer exceeding sixty seconds.
- **FR-014**: An upload or exhausted processing failure MUST offer a fresh recording without retaining the attempt; a lost response MUST NOT be described as proof that publication failed, and any committed result remains in Yours.
- **FR-015**: The system MUST publish exactly one answer per submission, even when a submission is duplicated or retried.

#### Eligibility enforcement

- **FR-016**: The system MUST refuse, server-side, an answer submitted to a question the participant authored.
- **FR-017**: The system MUST refuse, server-side, an answer submitted to a question to which the participant already has a **published** answer.
- **FR-017a**: The system MUST accept a further answer to a question whose only prior attempts by this participant were withheld or failed.
- **FR-018**: The system MUST evaluate all eligibility rules on the server regardless of what the interface allowed.

#### Publication and unlock

- **FR-019**: Only after review passes, the system MUST atomically insert the published answer and grant an ask if none is held; no answer row exists for a pending, withheld, failed, or abandoned submission.
- **FR-020**: On a passing review, the system MUST show `Your answer counts. Ask one.`
- **FR-021**: A published passing answer MUST grant one ask if the participant holds none; it MUST NOT add another if one is already held.
- **FR-022**: The system MUST NOT grant an ask when recording ends, when a recording is submitted, or at any point before the review decision.
- **FR-023**: The system MUST NOT allow a participant to hold more than one unspent ask.
- **FR-024**: The system MUST compute and enforce ask eligibility server-side; client-supplied eligibility MUST be treated as advisory only.
- **FR-025**: The system MUST block the ask flow entirely for a participant with no unspent ask, including direct attempts that bypass the interface.
- **FR-026**: On a non-passing review, the system MUST grant no ask and return the participant to the answer flow.
- **FR-027**: A participant MUST NOT be presented again a question to which they have a published answer. A withheld or failed attempt leaves the question eligible.
- **FR-027a**: Every Withheld result, including crisis, MUST offer a fresh answer recording for the same question at `/answer/record?questionId=<same>`; fixed crisis resources remain available alongside retry.

#### Failure states

- **FR-028**: When microphone permission is denied, the system MUST explain what is needed and how to grant it.
- **FR-029**: When the browser cannot record, the system MUST say so plainly rather than presenting a non-working control.
- **FR-030**: When a recording is interrupted, the system MUST submit nothing, publish nothing, and leave ask eligibility unchanged.
- **FR-031**: Every screen in this flow MUST provide loading, failure, and retry states, and MUST be usable at phone and desktop widths.

### Key Entities

- **Answer**: One participant's response to one question. Carries its duration, published display text, source language, emotional direction, a submission id for idempotency, and publication time; only published answers are stored. Related to exactly one question and exactly one participant.
- **Ask Eligibility**: A participant's right to submit one question. Granted by a passing answer, held at a maximum of one, and spent elsewhere. Authoritative only on the server.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time participant goes from a displayed question to holding an earned ask in under three minutes, including recording and review.
- **SC-002**: Recording stops automatically at sixty seconds in every tested browser, with zero submissions exceeding the ceiling and zero recordings lost at the boundary.
- **SC-003**: A passing published answer leaves the participant holding exactly one ask, including when one was already held; non-passing submissions grant none.
- **SC-004**: Zero asks are granted before a review decision exists, verified by attempting to claim an ask during review.
- **SC-005**: A participant never holds more than one unspent ask, across repeated qualifying answers.
- **SC-006**: One hundred percent of attempts to answer one's own question or an already-answered question are refused server-side, including attempts that bypass the interface.
- **SC-007**: Duplicate or retried submissions produce exactly one published answer and one granted ask, in one hundred percent of cases.
- **SC-008**: An answer as short as five seconds qualifies when its review passes, demonstrating no minimum duration exists.
- **SC-009**: The full recording flow completes on a current iPhone browser and a current Android browser, including microphone permission grant.
- **SC-010**: Denied microphone permission, unsupported browsers, and interrupted recordings each produce a clear state with a way forward, with zero dead screens.

## Assumptions

- **Question playback**: optional spoken playback of the question is a convenience, not a requirement. It is dropped before the ceiling, the timer, or the unlock if the build window tightens.
- **Duration source**: the recording's duration is measured and enforced during recording, and re-checked on the server at submission. The client value alone is not trusted.
- **Recording format**: whatever the browser produces natively is used. Format conversion is a planning concern, not a specification one.
- **Backgrounded recording**: a phone locking or backgrounding the app ends the recording. Whatever was captured up to that point is treated as a normal short recording.
- **Retry**: 002 retries failed checks within the active submission. Upload failure, exhausted processing, or Withheld offers a fresh recording; leaving the page discards the attempt.
- **Concurrent unlock**: two simultaneous passing answers from the same participant still result in one unspent ask, resolved server-side.

## Out of Scope

- The review itself, its checks, its decision, the shared result page, crisis routing, and deletion of the original recording — all specified in [002-contribution-review](../002-contribution-review/spec.md).
- Question selection, skipping, and the pool — specified in [001-participant-and-pool](../001-participant-and-pool/spec.md).
- Recording or publishing a question — specified in [004-ask-one](../004-ask-one/spec.md).
- Viewing answers after the fact — specified in [005-yours-and-playback](../005-yours-and-playback/spec.md).
- Playback or review of the participant's own original recording, anywhere.
- Editing, deleting, or withdrawing a published answer.
- Drafts, saved recordings, or resuming an interrupted recording.
- Banking, transferring, or purchasing asks.
- Votes, ratings, reactions, or any signal on an answer.

## Dependencies

- [001-participant-and-pool](../001-participant-and-pool/spec.md) for participant identity and the selected question.
- [002-contribution-review](../002-contribution-review/spec.md) for the review decision, checking state, result page, retry behavior, and audio deletion.
- Browser microphone recording available on current mobile and desktop browsers.
- Durable storage for answers and participant ask eligibility.
