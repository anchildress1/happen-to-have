# Feature Specification: Participant Identity and Question Pool

**Feature Branch**: `001-participant-and-pool`

**Created**: 2026-09-04

**Status**: Draft

**Input**: AI handoff "Happen to Have?" revision 5 — Arrival and Question selection sections, anonymous identity model, seeded pool requirement.

## Overview

The ground floor of **Happen to Have?**: a visitor arrives, becomes an anonymous participant,
and is handed one question somebody else asked. They can skip as long as they like until they
find one they can speak to.

No recording, no review, no asking. This spec ends at the moment a participant says
`I can answer this`.

**Depends on**: nothing. This is the first spec to build.

**Consumed by**: [003-answer-and-unlock](../003-answer-and-unlock/spec.md) picks up where this
spec's `I can answer this` leaves off.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Arrive and get a question (Priority: P1)

Someone opens the site for the first time on their phone. They see the product name, the
tagline, and one action. They tap it and are shown a single question a real person asked, as
text, with two ways forward.

**Why this priority**: Nothing else in the product can be demonstrated until a participant can
reach a question. This is also the entire first impression.

**Independent Test**: Seed the pool, open the site as a new visitor on a phone and a desktop
browser, and confirm the landing screen and a question both render correctly.

**Acceptance Scenarios**:

1. **Given** a visitor with no prior state, **When** they open the site, **Then** they see `Happen to Have?`, `Answer one. Ask one.`, and `Find me a question` as the primary action.
2. **Given** the landing screen, **When** the visitor chooses `Find me a question`, **Then** exactly one open question is displayed as text with the actions `I can answer this` and `Try another question`.
3. **Given** a visitor with no prior state, **When** they first interact with the site, **Then** they are assigned an anonymous participant identity with no username, profile, or credential, and are never asked to sign up.
4. **Given** a returning visitor in the same browser session, **When** they open the site, **Then** they are recognized as the same participant and their prior contributions and ask eligibility are intact.
5. **Given** any screen in this flow, **When** viewed on a phone or a desktop browser, **Then** the layout is usable at both sizes with no horizontal scrolling.

---

### User Story 2 - Skip until something fits (Priority: P2)

A participant is shown a question about something they know nothing about. They tap
`Try another question` and get a different one. They can do this as many times as they want.
Nothing is recorded, nothing is held against them, and they are no closer to or further from
being able to ask.

**Why this priority**: Without skipping, participants are forced to answer questions they
cannot help with, which produces exactly the low-quality content the review gate exists to
reject. Skipping is what keeps the pool honest.

**Independent Test**: With several seeded questions, skip repeatedly and confirm a different
question appears each time, no recording begins, and ask eligibility never changes.

**Acceptance Scenarios**:

1. **Given** at least two eligible questions, **When** the participant chooses `Try another question`, **Then** the pointer advances to the next eligible question in the current ordered pass.
2. **Given** the participant skips, **When** the next question is presented, **Then** no recording has started and no microphone permission has been requested.
3. **Given** the participant skips any number of times, **When** their ask eligibility is checked, **Then** it is unchanged, and no penalty, cooldown, or limit has been applied.
4. **Given** at least two eligible questions, **When** the pointer advances or wraps, **Then** the question just skipped is not immediately repeated.
5. **Given** the pointer reaches the end, **When** the participant skips again, **Then** the eligible list is refreshed, sorted, and traversal wraps to its beginning.
6. **Given** exactly one eligible question, **When** the participant skips, **Then** it remains visible with `This is the only question waiting right now.` rather than a false empty state.

---

### User Story 3 - Never the wrong question (Priority: P3)

A participant is never handed their own question, and never handed one they have already
answered. The pool also stops routing a question once it has collected enough answers, so
effort spreads across questions that still need help.

**Why this priority**: Answering your own question breaks the premise. Being shown the same
question twice makes the pool feel broken and wastes a contribution the participant already
made. A contribution that was withheld is a different matter — it never counted, so the question
is still open to them.

**Independent Test**: Create a participant with one authored question, one question they have a
published answer to, and one question from a withheld attempt that left no stored row. Request questions
repeatedly: the first two are never presented, the third still is.

**Acceptance Scenarios**:

1. **Given** a participant who authored a published question, **When** any question is selected for them, **Then** their own question is never presented.
2. **Given** a participant whose answer to a question was published, **When** any question is selected for them, **Then** that question is never presented to them again.
2a. **Given** a participant whose answer to a question was withheld or failed, **When** any question is selected for them, **Then** that question remains eligible — a contribution that did not count does not use up the question.
3. **Given** two eligible questions where one has fewer published answers, **When** a question is selected, **Then** the question with fewer published answers is preferred.
4. **Given** a question that has been closed for further routing, **When** any question is selected, **Then** the closed question is not presented.
5. **Given** a question with no answers at all, **When** any amount of time passes, **Then** it remains eligible for selection indefinitely.

---

### User Story 4 - Nothing left to answer (Priority: P4)

A participant has answered everything eligible, or authored the only questions in the pool.
Rather than a broken screen or a repeated question, they are told there is nothing waiting for
them right now and invited back.

**Why this priority**: A small pool is guaranteed during a weekend demo. An unhandled empty
state is the most likely thing a judge sees if they click twice more than expected.

**Independent Test**: Reduce the eligible pool to zero for one participant and confirm the
empty state renders rather than an error, a blank screen, or an ineligible question.

**Acceptance Scenarios**:

1. **Given** no eligible question exists for this participant, **When** they request a question, **Then** an empty state explains that nothing is waiting right now and invites them to come back.
2. **Given** the empty state is shown, **When** it renders, **Then** no ask has been granted and no ineligible question has been presented to fill the gap.
3. **Given** the pool is being loaded, **When** the participant is waiting, **Then** a loading state is shown rather than an empty or broken screen.
4. **Given** the pool cannot be loaded because of a failure, **When** the participant is waiting, **Then** a failure state with a retry action is shown.

---

### Edge Cases

- **Session reset**: the participant clears cookies or opens a private window. They become a new participant with no history and no earned ask. Documented and accepted; not solved in this build window.
- **Two tabs**: the same participant has the site open twice and requests a question in both. Both tabs may show different questions; neither tab's selection affects the other's eligibility.
- **Seeded questions**: Ashley supplies the pool before launch; seeds follow the same selection and closure rules but have no participant history owner.
- **Every question already answered by this participant**: treated as an empty pool, not as a reason to re-present a question they have a published answer to. Withheld attempts leave no stored row and do not affect this case.
- **Question closed mid-session**: a participant is looking at a question that reaches its answer limit before they act. Their in-progress attempt is allowed to proceed; the closure affects future routing only.
- **Very long question text**: the question renders in full without truncating away its meaning, and the layout does not break at phone width.

## Requirements *(mandatory)*

### Functional Requirements

#### Identity

- **FR-001**: The system MUST assign every visitor an anonymous, session-scoped participant identity on first interaction.
- **FR-002**: The system MUST NOT require or offer signup, login, or account creation.
- **FR-003**: A participant MUST have no public profile, no public username, no follower graph, and no expertise credential.
- **FR-004**: The system MUST recognize a returning visitor within the same browser session as the same participant, preserving their contributions and ask eligibility.
- **FR-005**: The system MUST hold participant ask eligibility server-side. Client-supplied identity or eligibility MUST be treated as advisory only.

#### Landing

- **FR-006**: The landing screen MUST show `Happen to Have?` and `Answer one. Ask one.`
- **FR-007**: The landing screen MUST offer `Find me a question` as its primary action.
- **FR-008**: The product name MUST retain its question mark in every occurrence, including page titles and metadata.
- **FR-009**: Copy MUST NOT use "who answers" framing, "let me ask someone else" framing, or position the product as a marketplace, expert network, therapy service, or social feed.
- **FR-010**: Copy MUST NOT describe the recorder, the review, or the processing pipeline as an agent.
- **FR-011**: Copy MUST NOT generate, imitate, or market an Appalachian dialect, and MUST NOT restrict or filter participation by region.
- **FR-012**: Routine participant-facing copy MUST NOT position the product on "safe" or safety.

#### Selection

- **FR-013**: The system MUST present exactly one open question at a time, as text.
- **FR-014**: The system MUST offer exactly two actions on a presented question: `I can answer this` and `Try another question`.
- **FR-015**: The system MUST NOT present a participant a question they authored.
- **FR-016**: The system MUST NOT present a participant a question to which they already have a **published** answer.
- **FR-016a**: A withheld or failed attempt MUST NOT exclude a question. The participant may be presented it again and may retry it directly.
- **FR-017**: The system MUST NOT present a question that has been closed for further routing.
- **FR-018**: Each selection pass MUST order eligible questions by published-answer count ascending, then creation time and id ascending; the first question is the least answered and skips advance through that order.
- **FR-019**: The system MUST keep questions with no answers eligible for selection indefinitely, with no expiry.

#### Skipping

- **FR-020**: The system MUST allow unlimited skipping.
- **FR-021**: Skipping MUST NOT start a recording or request microphone permission.
- **FR-022**: Skipping MUST NOT grant an ask, advance a participant toward one, or change ask eligibility in any way.
- **FR-023**: Skipping MUST NOT apply a penalty, cooldown, or skip limit.
- **FR-024**: Skipping MUST advance a pointer without reordering the list or adding exclusions. With two or more eligible questions, the immediately next question MUST differ; with one, keep it visible and explain that it is the only one.
- **FR-025**: Skipped questions MUST remain eligible. At the end of each pass, refresh and sort the eligible list and wrap to its beginning; re-check eligibility before displaying each question.

#### Pool content

- **FR-026**: The system MUST launch with a pre-populated question pool so the first visitor is never shown an empty pool.
- **FR-027**: Seeded questions MUST be indistinguishable from participant questions in selection and closure behavior.
- **FR-028**: Seeded questions MUST have no participant history owner; Ashley supplies their content before launch.

#### States

- **FR-029**: The system MUST show an empty state, rather than an error or an ineligible question, when no eligible question exists for a participant.
- **FR-030**: The system MUST show a loading state while a question is being selected.
- **FR-031**: The system MUST show a failure state with a retry action when question selection fails.
- **FR-032**: Every screen in this flow MUST be usable on phone and desktop widths without horizontal scrolling.

### Key Entities

- **Participant**: An anonymous, session-scoped person. Holds ask eligibility. Related to the questions they authored and the answers they gave. Carries no name or public presence.
- **Question**: A published question available to be answered. For this spec it carries only its display text, its author, its published-answer count, and whether it is still open for routing. Its creation, review, and closure rules belong to other specs.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time visitor reaches a displayed question in under ten seconds from opening the site.
- **SC-002**: Zero participants are ever presented their own question or a question they have a published answer to, across the full selection test set including repeated requests. Questions from withheld or failed attempts remain presentable in 100% of cases because no answer row was created.
- **SC-003**: Twenty consecutive skips traverse and wrap in order with no penalty or eligibility change, including two-question and single-question pools; no false empty state occurs.
- **SC-004**: Every new pass starts with the least-answered eligible question and traverses the initial count/creation/id order, with stable ties and no random selection.
- **SC-005**: Zero microphone permission prompts occur anywhere in this flow.
- **SC-006**: The landing screen and question screen render correctly on a current iPhone browser and a current Android browser with no horizontal scrolling.
- **SC-007**: The empty, loading, and failure states each render correctly when induced, with zero blank or errored screens.
- **SC-008**: The pool contains enough seeded questions that a single participant can skip through the demo without exhausting it.

## Assumptions

- **Seed volume**: at least fifteen seeded questions, enough that a demo participant skipping freely never hits the empty state.
- **Seed authorship**: Ashley will author the seed pool. TODO(SEED_CONTENT): content and recording provenance are TBD; do not generate substitutes or claim that seed readiness has passed.
- **Traversal**: an ordered list and pointer exist only in the current tab. Advancing changes only the pointer; reload starts a fresh pass and tabs do not share traversal state.
- **Selection determinism**: strict ascending answer-count order with stable ties is intentional. Concurrent participants may see the same question. Counts are refreshed on each new pass; eligibility is checked before every display.
- **Question closure**: the rule that closes a question for routing is specified in [004-ask-one](../004-ask-one/spec.md). This spec only honors the resulting closed state.
- **Identity durability**: session-scoped identity makes the reciprocity gate soft. Clearing cookies resets the participant. This is documented and accepted per the constitution.

## Out of Scope

- Recording anything. `I can answer this` is the last action in this spec.
- Any review, guardrail, or publication behavior.
- Asking a question, or any part of the ask unlock.
- The `Yours` history area.
- Public browsing of all questions, search, categories, or tags.
- Accounts, signup, cross-device continuity.
- Public profiles, usernames, followers, direct messages.
- Votes, ratings, reactions, or any ranking signal on questions.

## Dependencies

- Durable storage for participants and questions, reachable from the server.
- Human-authored seed questions available before launch.
