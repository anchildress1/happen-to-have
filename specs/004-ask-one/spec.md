# Feature Specification: Ask One

**Feature Branch**: `004-ask-one`

**Created**: 2026-09-04

**Last revised**: 2026-09-06 — hole-finding pass against shipped 001–003, then a review pass
that named the closure stale-queue window and what the duration check does not measure.

**Status**: Draft

**Input**: AI handoff "Happen to Have?" revision 5 — Record a question, Reciprocity, question
lifecycle and closure rules. Revised after 003 shipped, against the running code.

## Overview

A participant who earned an ask spends it. They record their own question by voice, it goes
through the same review, and when it passes it joins the pool for other people to answer. The
ask is gone. To ask again, they answer again.

This is the half of the rule that comes second: **ask one**.

**Depends on**: [002-contribution-review](../002-contribution-review/spec.md) for the decision.
[003-answer-and-unlock](../003-answer-and-unlock/spec.md) grants the ask this spec spends.

**Consumed by**: [001-participant-and-pool](../001-participant-and-pool/spec.md) selects from
the questions this spec publishes and honors the closure rule defined here.

**Owns the whole of `/ask`.** 003 shipped a published-answer action pointing at `/ask` and no
route behind it; every state at that URL — unlocked, recording, checking, published, withheld,
failed, and rate limited — is this feature's to build. The no-ask case is not one of those
states: a participant holding no ask is refused server-side and sent to the answer flow, so
`/ask` never renders anything for them (FR-003).

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

1. **Given** a participant holding one unspent ask, **When** they arrive at the ask flow, **Then** they are shown the unlocked state and may start recording a question by voice.
2. **Given** a recorded question, **When** it is submitted, **Then** it is sent for review and a checking state is shown.
3. **Given** a question that passes review, **When** the outcome resolves, **Then** the processed text is published to the open pool.
4. **Given** a question that was just published, **When** a different participant requests a question to answer, **Then** the new question is eligible for selection.
5. **Given** a published question, **When** the participant's ask eligibility is checked, **Then** the ask has been consumed and they hold none.
6. **Given** a question that just published, **When** the outcome resolves, **Then** a confirmation state says the question is live and the ask is spent, and its primary action returns the participant to answering.
7. **Given** a participant whose question just published, **When** they return to the site, **Then** they are back in the state of needing an answer before they can ask.
8. **Given** a question of any duration at or under sixty seconds, **When** it passes review, **Then** it publishes; no minimum duration is applied.
9. **Given** a participant holding an ask who declines to spend it now, **When** they leave the unlocked state, **Then** the ask is still held and they are returned to answering.

---

### User Story 2 - You cannot ask without answering (Priority: P2)

Someone tries to ask a question without having answered one. It does not work — not through the
interface, and not by going around it. Asks cannot be stockpiled either: two qualifying answers
still leave you holding one.

**Why this priority**: The reciprocity rule is the only rule the product has. An ask flow that
can be reached without an earned ask makes the entire premise decorative.

**Independent Test**: Attempt to reach and submit to the ask flow as a participant with no ask,
both through the interface and by direct request. Confirm both are refused. Then earn two asks
and confirm only one question can be submitted.

**Acceptance Scenarios**:

1. **Given** a participant with no unspent ask, **When** they request the ask flow, **Then** it is refused server-side and they are sent to answer a question first.
2. **Given** a participant with no unspent ask, **When** they submit a question directly, bypassing the interface, **Then** the server refuses it and nothing is published.
3. **Given** a request carrying no session at all, **When** a question is submitted, **Then** it is refused, no participant is created, and nothing is published.
4. **Given** a participant who has completed two qualifying answers, **When** their eligibility is checked, **Then** they hold exactly one ask, not two.
5. **Given** a participant who just published a question, **When** they attempt to ask a second one, **Then** it is refused until they complete another qualifying answer.
6. **Given** a participant submitting two questions at nearly the same moment with one ask, **When** both are evaluated, **Then** exactly one question is published and exactly one ask is consumed.
7. **Given** a submitted question whose declared duration exceeds sixty seconds, **When** the server evaluates it, **Then** it is refused before any review work is spent and the ask is still held.

---

### User Story 3 - The ask survives a bad outcome (Priority: P3)

A participant's question does not pass review, or the check breaks halfway through, or they hit
the daily submission limit. Either way they still hold their ask. They earned it with an answer;
a rejected recording does not take it away.

**Why this priority**: Consuming an ask on a failed submission punishes a participant for a
guardrail decision or an outage. It is the difference between a rule and a trap.

**Independent Test**: Submit a question that fails review, one that hits an infrastructure
failure, and one that is rate limited. Confirm the ask is still held in all three cases and a
fresh recording works.

**Acceptance Scenarios**:

1. **Given** a question that fails review, **When** the outcome resolves, **Then** nothing is published and the participant still holds their unspent ask.
2. **Given** a question submission that hits an infrastructure failure, **When** the retryable state is shown, **Then** the participant still holds their unspent ask.
3. **Given** a transient check failure, **When** its independent retry succeeds and all checks pass, **Then** the question publishes and consumes the ask exactly once.
4. **Given** processing retries are exhausted or the submission deadline expires, **When** the participant tries again, **Then** `/ask` starts a fresh recording with the original ask intact and no saved attempt.
5. **Given** a question submission refused by the daily submission limit, **When** the outcome resolves, **Then** nothing is published, no review work is spent, and the ask is still held.
6. **Given** a question withheld for any reason, **When** the participant returns, **Then** they may record a different question immediately with no penalty.
7. **Given** any question submission, **When** the ask is evaluated for consumption, **Then** it is consumed only at the moment the question is successfully created.
8. **Given** a question that published but whose response never reached the participant, **When** they resubmit the same recording, **Then** the original outcome is replayed and no second question is published.
9. **Given** a participant who abandons the page mid-review, **When** the request is cancelled, **Then** nothing is published, the ask is still held, and no attempt is retained.

---

### User Story 4 - A question's life (Priority: P4)

A published question waits. If nobody answers it, it waits forever. Once three different people
have answered it, it stops being handed out — those three answers are what it needed — but the
person who asked can still see it and everything that came back.

**Why this priority**: Without closure, popular questions absorb every answer in the pool and
new questions starve. Without indefinite openness, a quiet question dies before anyone sees it.

**Independent Test**: Publish a question, collect three published answers from three distinct
participants, and confirm it stops being routed while it and its answers stay fully readable.
Separately, leave a question unanswered and confirm it never expires.

**Acceptance Scenarios**:

1. **Given** a published question with no answers, **When** any amount of time passes, **Then** it remains open and eligible for routing, with no expiry.
2. **Given** a question with three published answers, **When** the pool selects questions for anyone, **Then** that question is no longer routed.
3. **Given** a question with two published answers, **When** the pool selects questions, **Then** it is still routed.
4. **Given** a closed question, **When** it and its answers are retrieved, **Then** both are unchanged and fully readable; closure removed it from routing and nothing else.
5. **Given** a seeded question with three published answers, **When** the pool selects questions, **Then** it closes on the same rule, and its lack of an asker changes nothing about closure.
6. **Given** concurrent submissions from the same participant to the same question, **When** publication is attempted, **Then** at most one answer row is created and that participant contributes only one to closure.
7. **Given** a question with withheld answers, **When** routing is evaluated, **Then** withheld answers do not count toward closure.
8. **Given** two participants submitting the third and fourth qualifying answers at nearly the same moment, **When** both resolve, **Then** both answers publish and are visible to the asker, and the question is closed for future routing.
9. **Given** every open question has closed, **When** a participant requests one to answer, **Then** the empty state is shown rather than a closed question.
10. **Given** a participant whose queue was fetched before a question's third answer published, **When** they skip to that question and their answer passes review, **Then** the answer publishes and is readable by the asker; closure is not re-checked at publication.

---

### Edge Cases

- **Question recorded but never submitted**: the participant abandons the flow. Nothing is published, the ask is still held, and no recording persists.
- **Ask flow entered, then abandoned**: the participant leaves without recording. The ask remains unspent and the flow can be re-entered.
- **Question signals crisis**: the shared Withheld page shows fixed resources and a fresh-question action at `/ask`; nothing publishes and the ask is still held.
- **Question is unintelligible or silent**: withheld, ask still held, participant may re-record immediately.
- **Question that is not a question**: content processing publishes what was said as readable text. The product does not enforce interrogative grammar.
- **Session reset while holding an ask**: the participant becomes a new participant and loses the unspent ask. Accepted limitation of session-scoped identity.
- **Very long question**: capped by the sixty-second ceiling in the recorder, and refused by the server if a crafted request exceeds it.
- **Asker never returns**: the question stays in the pool and continues collecting answers until it closes.
- **Ask earned, then rate limited**: the ask is held but unspendable until the window resets. Session-scoped identity means a long enough window can outlive the session and the ask with it. Accepted; the limit is the abuse control and the ask is not a currency worth protecting past a session.
- **Seed pool exhaustion**: the launch pool is small, and closure removes each question from routing after its third answer. A sustained run of answers can empty the pool into 001's empty state before new questions arrive. Expected behavior, not a defect.
- **Question published while its asker is mid-answer elsewhere**: unaffected. Publishing a question does not touch an in-flight answer, and the asker is simply excluded from their own new question.

## Requirements *(mandatory)*

### Functional Requirements

#### Access

- **FR-001**: The system MUST allow entry to the ask flow only for a participant holding one unspent ask.
- **FR-002**: The system MUST refuse a question submission, server-side, from a participant with no unspent ask, including submissions that bypass the interface.
- **FR-002a**: The system MUST refuse a question submission carrying no session, and MUST NOT create a participant while doing so.
- **FR-003**: The system MUST send a participant with no unspent ask to the answer flow rather than rendering an ask screen.
- **FR-004**: The system MUST evaluate ask eligibility on the server; client-supplied eligibility MUST be treated as advisory only.
- **FR-004a**: The system MUST present an unlocked state to a participant holding an ask, offering both starting a question and declining without spending it; declining MUST leave the ask intact and return the participant to the answer flow.

#### Recording

- **FR-005**: The system MUST capture questions as voice recordings in the browser.
- **FR-006**: The system MUST stop question recording automatically at sixty seconds.
- **FR-006a**: The system MUST record the question's duration and MUST refuse, server-side, any question exceeding sixty seconds, before spending review work.
- **FR-007**: The system MUST display elapsed time and the remaining limit while recording.
- **FR-008**: The system MUST NOT enforce a minimum recording duration for questions.
- **FR-008a**: The system MUST reject a question recording that captured no audio before spending review work.
- **FR-009**: The system MUST NOT answer the question, generate follow-up questions, or produce conversational prompts during submission.
- **FR-010**: The system MUST NOT offer follow-up questions on a published question.
- **FR-010a**: The recording, permission, no-device, unsupported-browser, and interruption behaviors MUST be the ones specified in [003](../003-answer-and-unlock/spec.md), reused rather than reimplemented.

#### Review and publication

- **FR-011**: The system MUST submit the question recording for review on the server, through the same review used for answers, with relevance not evaluated.
- **FR-012**: The system MUST display a checking state while question review is in progress.
- **FR-013**: The system MUST publish a question only after its review passes.
- **FR-014**: Only after review passes, the system MUST atomically insert the published question and consume the ask; no pending, withheld, failed, or abandoned question row may be stored.
- **FR-014a**: The system MUST publish exactly one question per submission, even when a submission is duplicated or retried; a resubmission of a submission that already published MUST replay its original outcome rather than report a refusal.
- **FR-015**: A published question MUST become eligible for selection by other participants.
- **FR-015a**: On a published question, the system MUST show a confirmation state naming that the question is live and the ask is spent, whose primary action returns the participant to the answer flow and whose secondary action leads to their history.

#### Ask consumption

- **FR-016**: The system MUST consume the participant's ask only at the moment the question is successfully created.
- **FR-017**: The system MUST NOT consume an ask when a question fails review.
- **FR-018**: The system MUST NOT consume an ask when a question submission hits an infrastructure failure, expires the submission deadline, is abandoned, or is refused by the submission rate limit.
- **FR-019**: The system MUST consume exactly one ask per published question, even under concurrent or duplicate submission.
- **FR-020**: On a published question, the system MUST return the participant to the state of needing an answer before they can ask again.
- **FR-021**: A withheld or failed question MUST NOT produce a penalty, cooldown, or strike; every retry action, including the crisis variant, MUST start a fresh question recording at `/ask` with the ask intact.

#### Question lifecycle

- **FR-022**: A published question with no answers MUST remain open and eligible for routing indefinitely, with no expiry.
- **FR-023**: A question MUST stop being routed once it holds three published answers.
- **FR-023a**: Closure MUST be derived from the question's published answers at selection time, not stored as a status the routing query trusts. No write, scheduled job, or counter may be introduced to maintain it.
- **FR-024**: Three published answers means three distinct participants: a participant MUST NOT be able to publish more than one answer to the same question, which [003](../003-answer-and-unlock/spec.md) already enforces. Closure MUST NOT re-derive distinctness on top of that rule.
- **FR-025**: Withheld answers MUST NOT count toward closure.
- **FR-026**: Closure MUST NOT delete, archive, hide, or make unreadable a question or any of its answers. They remain retrievable exactly as before; only routing changes. Presenting them to the asker is [005](../005-yours-and-playback/spec.md)'s FR-015, not restated here.
- **FR-027**: Closure MUST affect future routing only, and MUST NOT invalidate an answer already in progress or already published.
- **FR-027a**: Closure MUST apply uniformly to seeded and participant-authored questions.

### Key Entities

- **Question**: One participant's published question. Carries display text, source language, its author, duration, submission id, and publication time; only published questions are stored. Related to its answers and to its asker. It carries no routing-status field: whether it is still routed is read from its answers (FR-023a).
- **Ask Eligibility**: A participant's right to submit one question, granted in [003-answer-and-unlock](../003-answer-and-unlock/spec.md) and consumed here. Authoritative only on the server.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A participant holding an ask goes from entering the ask flow to a published question in under two minutes, including recording and review.
- **SC-002**: One hundred percent of question submissions from participants with no unspent ask are refused, including direct submissions that bypass the interface and submissions carrying no session.
- **SC-003**: A participant never publishes two questions without two qualifying answers, across all attempts including concurrent submissions.
- **SC-004**: One hundred percent of failed, deadline-expired, abandoned, and rate-limited question submissions leave the participant's ask unspent.
- **SC-005**: An ask is consumed exactly once per published question, with zero double-consumption under duplicate or concurrent submission.
- **SC-006**: A question published by one participant becomes selectable by another within five seconds of publication.
- **SC-007**: Question recording stops automatically at sixty seconds in every tested browser, and one hundred percent of submissions whose **declared** duration exceeds sixty seconds are refused by the server before any review call is made. What is measured is the declared value; see the duration assumption below for what that leaves uncovered.
- **SC-008**: A question stops being routed at exactly three published answers, and never earlier, across the closure test set — including a seeded question.
- **SC-009**: Zero unanswered questions become unreachable or ineligible through the passage of time.
- **SC-010**: A closed question and every one of its answers remain retrievable in one hundred percent of cases; closure changes routing and nothing else.
- **SC-011**: Every participant reaching a published question sees a confirmation naming the outcome; zero publications resolve to a silent redirect.
- **SC-012**: Zero question rows exist for a submission that was not published, across the full outcome test set.

## Assumptions

- **Shared recording behavior**: the question recorder behaves the same as the answer recorder — same ceiling, same timer, same permission and interruption handling. It is expected to reuse that behavior rather than reimplement it.
- **Duration is a declared bound, not a measurement**: the sixty-second refusal (FR-006a) reads
  the duration the submission declares. Nothing decodes the audio to confirm the two agree, so a
  crafted request that attaches longer audio while declaring sixty seconds passes the check and
  reaches paid review. This is deliberately identical to how 003 already treats answers — its
  [research D3](../003-answer-and-unlock/research.md) settled on "two honest bounds, not a
  correlation": the declared duration is bounded to 1–60, the audio is bounded by 002's 1 KB
  floor and 5 MB ceiling, and nothing compares one against the other. D3 considered and rejected
  a byte-length cross-check as unimplementable without a measured bytes-per-second figure that
  does not exist. The byte ceiling caps what an over-long recording can cost; it does not verify
  its length.
- **Grammar**: the product does not require a question to be grammatically interrogative. Whatever the participant said is published as readable text.
- **Closure count**: three published answers, per the handoff. This is a routing rule only; it does not lock, archive, or hide anything.
- **Closure is derived**: the routing query counts published answers. The `status` column 001 created for this purpose is not used and should be dropped rather than left asserting a state nothing maintains. Chosen over a stored transition because a stored one denormalizes a count that is already relational, has to be written from inside 003's shipped publication statement, and can disagree with the answers it describes.
- **Concurrent closure**: a fourth answer landing simultaneously with the third publishes normally. With closure derived there is nothing to race — the fourth answer's eligibility was evaluated when it was still the third or fourth in line, and no state has to be reconciled afterward.
- **Closure has a stale-queue window**: 001 ships the whole eligible queue to the browser in one
  selection response and skipping walks it tab-local, refetching only when the participant wraps
  past its end or reloads. A queue fetched before a question's third answer published still
  contains that question, so a participant can skip to it and publish an answer to a question
  that has already closed — a fourth, or a fifth, for as long as stale queues are in flight. Not
  harmless, and not a race that resolves itself: the only bound is 003's rule of one answer per
  participant per question, which limits each participant to one such answer. Accepted
  rather than closed. A re-check at publication would put a closure read inside the publish path,
  which is exactly the write-side state FR-023a forbids, and FR-027 already commits to letting a
  fourth answer publish. Making the limit explicit is the fix; hiding it is not.
- **Ask durability**: an unspent ask persists for the life of the participant's session. Session reset loses it, per the accepted identity limitation.
- **Rate limiting**: the submission limit specified in [002](../002-contribution-review/spec.md) covers question submissions on the same counter as answers. A limited submission spends no review work and consumes no ask.
- **Emotion**: content processing returns an emotional direction for every contribution. A published question does not store or display one; nothing in the product reads it for a question.
- **Abandoned attempt**: leaving or refreshing discards unpublished audio and state; there is no recovery entry in Yours.
- **Question playback in the pool**: whether a question can be listened to while being answered is specified in [003-answer-and-unlock](../003-answer-and-unlock/spec.md), not here.
- **Design coverage**: [`001/contracts/design.md`](../001-participant-and-pool/contracts/design.md) heads the unlocked-ask screen "003 — Ask unlocked" while its own route map assigns `/ask` to 004. The route map is correct; the heading is a numbering artifact of the design import. The design carries no published-question state at all, so FR-015a's screen is authored here rather than imported.

## Out of Scope

- The review itself, the shared result page, crisis routing, rate limiting, and deletion of the original recording — specified in [002-contribution-review](../002-contribution-review/spec.md).
- Granting an ask — specified in [003-answer-and-unlock](../003-answer-and-unlock/spec.md).
- Question selection, skipping, and the empty state — specified in [001-participant-and-pool](../001-participant-and-pool/spec.md).
- Viewing responses to a published question, and showing an asker their closed question — specified in [005-yours-and-playback](../005-yours-and-playback/spec.md) FR-015. 004 guarantees the data survives closure; 005 owns the screen that shows it.
- Editing, deleting, withdrawing, or reopening a published question.
- Follow-up questions, clarifications, or any further turn on a published question.
- Tagging, categorizing, or targeting a question at particular people.
- Banking, transferring, or purchasing asks.
- Notifying an asker when a response arrives.
- Reopening a closed question, or any control that adjusts the closure threshold.

## Dependencies

- [002-contribution-review](../002-contribution-review/spec.md) for the review decision, checking state, result page, retry behavior, rate limiting, and audio deletion.
- [003-answer-and-unlock](../003-answer-and-unlock/spec.md) for granted ask eligibility, the server-side eligibility read, and the shared recording behavior.
- [001-participant-and-pool](../001-participant-and-pool/spec.md)'s selection query, which this feature changes to derive closure.
- Browser microphone recording available on current mobile and desktop browsers.
- Durable storage for questions and participant ask eligibility.
