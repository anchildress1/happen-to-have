# Feature Specification: Contribution Review

**Feature Branch**: `002-contribution-review`

**Created**: 2026-09-04

**Status**: Draft

**Input**: AI handoff "Happen to Have?" revision 4 — Guardrail outcomes, processing contract, audio output, contribution state model, abuse and cost protection.

## Overview

Everything a person records passes through one review before anyone else sees it. The review
transcribes, translates, strips identifying details, and runs independent checks that decide a
single question: can this be published?

The review never writes advice. It never counsels. It returns one decision, and the original
recording is deleted the moment that decision is final.

This is the engine both contribution flows run on. It has no flow of its own — it owns a
decision, two screens, and an audio lifecycle.

**Depends on**: [001-participant-and-pool](../001-participant-and-pool/spec.md) for participant
identity.

**Consumed by**: [003-answer-and-unlock](../003-answer-and-unlock/spec.md) and
[004-ask-one](../004-ask-one/spec.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A recording becomes publishable text (Priority: P1)

Someone records sixty seconds of spoken advice. The review listens to it, writes down what they
said, translates it if they spoke another language, takes out the name of their sister and the
town they live in, and hands back clean readable text plus a single verdict: this can be
published.

**Why this priority**: This is the entire engine. Neither contribution flow exists without a
decision to act on.

**Independent Test**: Feed a set of prepared recordings directly to the review — no interface —
and confirm each returns validated, structurally correct text and a single decision.

**Acceptance Scenarios**:

1. **Given** a recording of relevant spoken advice, **When** the review runs, **Then** it returns readable display text, the detected source language, and a decision of published.
2. **Given** a recording in a language other than the display language, **When** the review runs, **Then** the returned text is in the display language and is readable, with no participant asked to approve it.
3. **Given** a recording naming a person, an employer, a street address, or a phone number, **When** the review runs, **Then** those details are removed or generalized from the returned text.
4. **Given** a recording, **When** the review runs, **Then** the returned text contains no advice, facts, recommendations, or judgments that were not in the recording, and does not alter the substance of what was said.
5. **Given** an answer submission, **When** the review runs, **Then** four independent checks are performed on the original recording — content processing, relevance to the question, crisis signalling, and illegal or dangerous content.
6. **Given** a question submission, **When** the review runs, **Then** three independent checks are performed — content processing, crisis signalling, and illegal or dangerous content — and relevance is not evaluated.
7. **Given** any check, **When** it runs, **Then** it receives the original recording directly and does not consume another check's transcript or output.
8. **Given** all checks complete, **When** the decision resolves, **Then** it is published only if the content decision passed, relevance is true where applicable, crisis is false, and illegal or dangerous is false.
9. **Given** a recording where a broad emotional direction is reliably detectable, **When** the review runs, **Then** that direction is recorded alongside the text.

---

### User Story 2 - A contribution that cannot be shared (Priority: P2)

Someone records something the review will not publish. It might not answer the question at all.
It might describe something illegal. They see one page, with text that matches what actually
happened, and they are sent back to try again. Nothing is published. Nothing is held against
them.

**Why this priority**: Publishing an unpublishable contribution is the failure that ends the
product. Handling the rejection gracelessly is the failure that loses the participant.

**Independent Test**: Submit prepared irrelevant and illegal recordings and confirm each renders
the shared result page with its own text, publishes nothing, and returns the participant to the
flow with no penalty.

**Acceptance Scenarios**:

1. **Given** an answer that does not address its question, **When** the review completes, **Then** the decision is irrelevant, nothing is published, and the result page reads `That response doesn't appear to answer this question. Try another.`
2. **Given** a recording describing illegal or dangerous activity, **When** the review completes, **Then** the decision is illegal-withheld, nothing is published, and the result page reads `That response can't be shared here. Try another.`
3. **Given** a recording that is silent, unintelligible, spam, deliberate nonsense, or harassing, **When** the review completes, **Then** the contribution is withheld and nothing is published.
4. **Given** a recording whose identifying details cannot be safely removed, **When** the review completes, **Then** the contribution is withheld rather than published in partially redacted form.
5. **Given** any non-passing outcome, **When** the result page renders, **Then** it is the same page for every outcome, differing only in its text, and its text is short and non-argumentative.
6. **Given** a withheld contribution, **When** the participant returns to the flow, **Then** they may record again immediately with no penalty, cooldown, or strike recorded against them.
7. **Given** crisis and illegal-or-dangerous outcomes, **When** they are recorded, **Then** they remain distinct results so the correct page text can be selected.

---

### User Story 3 - Someone in crisis (Priority: P3)

Someone records something that signals they are in real trouble. It is not published anywhere.
They are shown fixed, human-written routing to real help — US and international — that a person
wrote in advance. The product does not counsel them and does not pretend to intervene.

**Why this priority**: This is the one outcome where getting it wrong causes harm outside the
software. It ships with the engine or the engine does not ship.

**Independent Test**: Submit prepared crisis-signalling recordings as both an answer and a
question, confirm neither is published anywhere and both route to the fixed resources, and
confirm those resources are reachable by a participant who has never contributed.

**Acceptance Scenarios**:

1. **Given** a recording signalling a personal crisis, **When** the review completes, **Then** the decision is crisis-routed and the recording is withheld from the public pool entirely.
2. **Given** a crisis outcome, **When** the result page renders, **Then** it shows fixed, human-authored routing text including both US and international resources.
3. **Given** a crisis outcome, **When** the page renders, **Then** no counseling text is generated and no claim of emergency intervention is made.
4. **Given** a participant who has never contributed anything, **When** they need crisis resources, **Then** those resources are reachable without earning an ask.
5. **Given** a crisis recording submitted as a question, **When** the review completes, **Then** crisis detection applies exactly as it does to an answer and the question is not published.
6. **Given** a crisis-routed contribution, **When** any other participant views any part of the product, **Then** its content appears nowhere.

---

### User Story 4 - Something broke on our side (Priority: P4)

The review cannot complete because the network dropped or the provider is down. The participant
is told the check did not finish — not that they failed — and is offered a retry. Their
recording is held just long enough to try again.

**Why this priority**: Infrastructure failure is certain on a two-day build. Silently discarding
a recording somebody just spent sixty seconds making is the worst thing this product can do.

**Independent Test**: Force the review path to fail, confirm a retryable state appears with
`Try processing again`, restore the path, retry, and confirm the contribution completes normally.

**Acceptance Scenarios**:

1. **Given** the review path is unavailable, **When** a contribution is submitted, **Then** the outcome is a retryable failure offering `Try processing again`, and the participant is not told they failed.
2. **Given** a retryable failure, **When** the participant retries and the review passes, **Then** the contribution publishes exactly as it would have on the first attempt.
3. **Given** a review result that does not match its expected structure, **When** it is evaluated, **Then** it is treated as an infrastructure failure and retried, never as a guardrail rejection.
4. **Given** any review result, **When** it is used, **Then** it has been validated against its expected structure first, and unvalidated output never reaches storage or the interface.
5. **Given** a retryable failure, **When** the participant does not retry, **Then** nothing is published and no ask is granted or consumed.
6. **Given** repeated failures on the same contribution, **When** attempts are recorded, **Then** the attempt count and the last error are retained for diagnosis.

---

### User Story 5 - The recording disappears (Priority: P5)

The moment a decision is final — published or withheld or failed for good — the original
recording is gone. It was never reachable by anyone else while it existed. Nothing in the
product ever plays it back.

**Why this priority**: People speak honestly only when the raw recording cannot resurface. Every
other privacy control in this product is decoration if the audio persists.

**Independent Test**: Submit contributions reaching each terminal outcome, then attempt direct
retrieval of the original recording from outside the system and confirm all attempts fail and
no stored copy remains.

**Acceptance Scenarios**:

1. **Given** an original recording at any point in its life, **When** retrieval is attempted from outside the system, **Then** it is not reachable at any address.
2. **Given** a contribution reaching a published outcome, **When** the outcome is recorded, **Then** the original recording is deleted immediately.
3. **Given** a contribution reaching an irrelevant, crisis-routed, illegal-withheld, or failed outcome, **When** the outcome is recorded, **Then** the original recording is deleted immediately.
4. **Given** a retryable infrastructure failure, **When** the recording is retained, **Then** it is retained only long enough to retry and is deleted on the terminal outcome.
5. **Given** any part of the product, **When** a participant looks for their own original recording, **Then** no review or playback of it is offered anywhere.
6. **Given** the storage holding original recordings, **When** it is inspected, **Then** a lifecycle deletion rule exists as a backstop and no recording predates it.

---

### Edge Cases

- **Partial check failure**: three checks succeed and one fails. The aggregate decision does not resolve; the contribution is a retryable failure, never a partial pass.
- **Conflicting signals**: a recording is both irrelevant and crisis-signalling. Crisis routing takes precedence in what the participant is shown, because the participant's safety outranks telling them their answer missed the point.
- **Crisis inside an otherwise good answer**: the answer is withheld anyway. A contribution that signals crisis is never published regardless of its other qualities.
- **Empty or corrupt audio**: rejected before spending review work, and recorded as a withheld contribution rather than an infrastructure failure.
- **Recording at the sixty-second ceiling**: reviewed normally. The ceiling is enforced during recording, not by the review.
- **Review succeeds but storage deletion fails**: the contribution's outcome still stands; deletion is retried, and the lifecycle rule catches anything the retry misses.
- **Rate limit hit mid-cycle**: the participant is told when they may retry, and no partial contribution is left in an unresolvable state.
- **Text with no reliable emotional signal**: no emotional direction is recorded rather than a guessed one.

## Requirements *(mandatory)*

### Functional Requirements

#### Review structure

- **FR-001**: The system MUST review every submitted recording before publishing it.
- **FR-002**: An answer review MUST perform four independent checks: content processing, relevance to the question being answered, crisis signalling, and illegal or dangerous content.
- **FR-003**: A question review MUST perform three independent checks: content processing, crisis signalling, and illegal or dangerous content. Relevance MUST NOT be evaluated for a question.
- **FR-004**: Each check MUST receive the original recording independently.
- **FR-005**: No check MUST consume another check's transcript, text, or output.
- **FR-006**: The relevance check MUST additionally receive the text of the question being answered.
- **FR-007**: The aggregate decision MUST resolve only after every applicable check completes successfully.
- **FR-008**: The system MUST NOT substitute relevance alone, or any single check alone, for the full set.

#### Content processing

- **FR-009**: Content processing MUST transcribe the recording.
- **FR-010**: Content processing MUST detect the source language.
- **FR-011**: Content processing MUST translate the content to the display language when it is not already in it.
- **FR-012**: Content processing MUST remove or generalize identifying information, including names, addresses, employers, and contact details.
- **FR-013**: Content processing MUST produce readable display text.
- **FR-014**: Content processing MUST NOT add advice, facts, recommendations, or moral judgment absent from the recording.
- **FR-015**: Content processing MUST NOT alter the participant's substantive advice.
- **FR-016**: Content processing MUST identify recordings that are silent, unintelligible, spam, deliberate nonsense, harassing, or unsafe to publish for privacy reasons, and MUST withhold them.
- **FR-017**: Content processing MUST record a broad emotional direction when one is reliably detectable, and MUST record none when it is not.
- **FR-018**: Translation MUST be invisible to the participant. The system MUST NOT present a translation review or approval screen at any point.

#### Decision

- **FR-019**: A contribution MUST be published only when the content decision passed, relevance is true where applicable, crisis is false, and illegal or dangerous is false.
- **FR-020**: The system MUST resolve every contribution to exactly one terminal outcome: published, irrelevant, crisis-routed, illegal-withheld, or failed.
- **FR-021**: The system MUST keep crisis and illegal-or-dangerous outcomes as distinct recorded results.
- **FR-022**: Where a recording signals both crisis and another non-passing condition, the participant MUST be shown crisis routing.
- **FR-023**: The system MUST record processing state, attempt count, and last error for every contribution.

#### Result presentation

- **FR-024**: The system MUST render one shared result page for every non-passing outcome, differing only in its text.
- **FR-025**: The relevance failure text MUST be `That response doesn't appear to answer this question. Try another.`
- **FR-026**: The illegal or dangerous text MUST be `That response can't be shared here. Try another.`
- **FR-027**: Result page text MUST be short and non-argumentative, and MUST NOT explain, justify, or debate the decision.
- **FR-028**: A withheld contribution MUST NOT produce a penalty, cooldown, strike, or any recorded consequence for the participant.
- **FR-029**: The system MUST display a checking state to the participant while a review is in progress.

#### Crisis routing

- **FR-030**: Crisis detection MUST be applied to both questions and answers.
- **FR-031**: Crisis content MUST be withheld from the public pool entirely and MUST appear nowhere in any other participant's view.
- **FR-032**: The crisis result MUST present fixed, human-authored routing text.
- **FR-033**: Crisis routing MUST include both US and international resources.
- **FR-034**: The system MUST NOT generate counseling text or claim emergency intervention.
- **FR-035**: Crisis resources MUST be reachable by any participant without having earned an ask.

#### Failure and validation

- **FR-036**: Every review result MUST be validated against its expected structure before use.
- **FR-037**: Unvalidated review output MUST NOT reach storage or the interface.
- **FR-038**: A structurally invalid or unparseable result MUST be treated as an infrastructure failure and retried, never as a guardrail rejection.
- **FR-039**: Network or provider failure MUST produce a retryable failure state offering `Try processing again`.
- **FR-040**: A retryable failure MUST NOT be characterized to the participant as their failure.
- **FR-041**: A retryable failure MUST preserve the pending recording long enough to retry.
- **FR-042**: A contribution in a retryable failure state MUST NOT be published, and MUST NOT grant or consume an ask.

#### Audio lifecycle

- **FR-043**: An original recording MUST NOT be reachable from outside the system at any address, at any time.
- **FR-044**: An original recording MUST be deleted immediately upon any terminal outcome, including published, irrelevant, crisis-routed, illegal-withheld, and failed.
- **FR-045**: On a retryable failure, an original recording MUST be retained only long enough to retry, then deleted on the terminal outcome.
- **FR-046**: The storage holding original recordings MUST carry a lifecycle deletion rule as a backstop, which MUST NOT be the primary deletion mechanism.
- **FR-047**: The system MUST NOT offer review or playback of a participant's own original recording anywhere.

#### Abuse and cost protection

- **FR-048**: The submission path MUST enforce a server-side rate limit whose numeric values are configurable without a code change.
- **FR-049**: A rate-limited response MUST state when the participant may try again.
- **FR-050**: The system MUST reject silent, empty, or invalid audio before spending avoidable review work.
- **FR-051**: Rate limit values MUST be validated against a complete answer-then-ask cycle before launch rather than copied from another product.
- **FR-052**: A rate-limited submission MUST NOT leave a contribution in an unresolvable state.

### Key Entities

- **Contribution**: A submitted recording awaiting or holding a decision. Progresses from received, through processing, to exactly one terminal outcome. Carries display text, source language, emotional direction, every individual check result, processing state, attempt count, last error, and a reference to its transient original recording.
- **Review Outcome**: The combined result of the independent checks on one recording, resolving to a single decision that determines both what gets published and what the participant is shown.
- **Crisis Routing Content**: Fixed, human-authored text and resource links covering US and international help. Static content, never generated.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From the moment a recording is submitted, a decision is returned within fifteen seconds in the median case and thirty seconds at the ninety-fifth percentile.
- **SC-002**: Zero original recordings are retrievable from outside the system at any point in their life, verified by direct retrieval attempts against every terminal outcome.
- **SC-003**: Zero original recordings remain in storage more than sixty seconds after their contribution reaches a terminal outcome.
- **SC-004**: One hundred percent of crisis-signalling submissions are withheld and route to fixed resources; zero appear in any other participant's view.
- **SC-005**: Zero published texts contain names, street addresses, employers, phone numbers, or comparable identifying details present in the source recording, across the privacy test set.
- **SC-006**: Zero published texts contain advice, facts, recommendations, or judgments absent from the source recording, across the fidelity test set.
- **SC-007**: Non-English recordings produce readable display text in the display language in at least ninety percent of the multilingual test set.
- **SC-008**: One hundred percent of prepared irrelevant, crisis, and illegal recordings resolve to their correct distinct outcome and render the correct page text.
- **SC-009**: Every induced infrastructure failure produces a retryable state and a successful retry, with zero recordings lost and zero misreported as participant failures.
- **SC-010**: One hundred percent of structurally invalid review results are retried rather than surfaced as guardrail rejections.
- **SC-011**: The complete answer-then-ask cycle at normal participant pace never triggers the rate limit.
- **SC-012**: The measured cost per contribution of running all checks on the original recording is known and recorded before interface work depends on it.

## Assumptions

- **Display language**: English is the display and translation target for the MVP. Contributions in other languages are translated into English. Policy beyond the weekend is unsettled.
- **Emotional direction**: best effort and broad only. The product does not claim to preserve the original delivery. If the technical spike shows this is unreliable, it is dropped rather than shipped as a guess.
- **Crisis precedence**: where a recording signals both crisis and another failure, the participant sees crisis routing. The handoff does not name this case; safety takes precedence.
- **Crisis content authorship**: routing text and resource links are written and verified by a person before launch, and are static.
- **Rate limit values**: specific numbers come from testing a complete cycle, not from another product. They are configurable without a code change.
- **Latency budget**: the fifteen-second median in SC-001 is a target set before measurement. The technical spike measures the real figure first; if the real figure is materially worse, either the check structure or the checking-state experience changes before interface work proceeds.
- **Terminal outcome ordering**: deletion of the original recording follows the recorded outcome. A deletion failure does not reopen a resolved outcome.

## Out of Scope

- Any recording interface, timer, or microphone handling.
- Question selection, skipping, or the pool.
- Granting or consuming an ask. This spec returns a decision; the flows act on it.
- The `Yours` history area.
- Generated playback of processed text.
- Publishing, reviewing, or playing back original participant recordings.
- A pre-publication review or approval screen for the participant.
- Human moderation, appeals, or review of withheld contributions.
- CAPTCHA, IP blocking, and account suspension.
- Conversational prompts, follow-up questions, or generated advice of any kind.

## Dependencies

- [001-participant-and-pool](../001-participant-and-pool/spec.md) for participant identity.
- A speech-processing capability that accepts recorded audio and returns validated structured results for transcription, translation, privacy redaction, relevance, crisis signalling, and illegal-or-dangerous content.
- Storage for transient original recordings with no external access path and a lifecycle deletion backstop.
- Durable storage for contribution state, check results, and attempt history.
- Human-authored crisis routing content covering US and international resources.
