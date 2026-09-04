# Feature Specification: Yours and Playback

**Feature Branch**: `005-yours-and-playback`

**Created**: 2026-09-04

**Status**: Draft

**Input**: AI handoff "Happen to Have?" revision 5 — Receive responses, Personal history, Audio output.

## Overview

Giving advice into a void is not an exchange. `Yours` is where a participant sees what became of
what they gave, and what came back for what they asked.

Two sections. Their published answers, with the question each one addressed. Their
questions, with every response as text and a `Listen` action that speaks it aloud in the
product's voice.

No ranking. No votes. No best answer. Just what people said.

**Depends on**: [003-answer-and-unlock](../003-answer-and-unlock/spec.md) for published answers
and [004-ask-one](../004-ask-one/spec.md) for published questions.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what came back (Priority: P1)

A participant asked a question yesterday. Today they open `Yours` and three strangers have
answered. All three are there as text, in a plain list, none of them ranked above the others.
They read all three.

**Why this priority**: This is the receiving half of the exchange. Without it a participant gives
advice, spends an ask, and never finds out whether anyone helped them.

**Independent Test**: Seed a participant with one published question carrying three responses,
open `Yours`, and confirm all three render as a flat unranked list with the question text and a
response count.

**Acceptance Scenarios**:

1. **Given** a participant with a published question, **When** they open `Yours`, **Then** the `Your Questions` section shows the processed question text.
2. **Given** a question with three responses, **When** the participant views it, **Then** the number of responses is shown and each response appears as text.
3. **Given** multiple responses to one question, **When** they are displayed, **Then** they appear as a flat list with no nesting.
4. **Given** multiple responses, **When** they are displayed, **Then** none is ranked, marked best, scored, or ordered by any quality signal.
5. **Given** any response, **When** it is displayed, **Then** no votes, likes, reactions, ratings, comments, or reply controls are offered.
6. **Given** a question that closed after three answers, **When** its asker views it, **Then** the question and all of its answers remain fully visible to them.
7. **Given** a participant with a published question and no responses yet, **When** they open `Yours`, **Then** an empty state explains that nothing has come back yet.

---

### User Story 2 - See what you gave (Priority: P2)

A participant opens Yours and sees their published answers with each original question.
Unpublished attempts are not retained or listed.

**Why this priority**: History records contributions that reached another person without becoming
an attempt-recovery system.

**Independent Test**: Publish an answer, separately withhold and fail submissions, then open Yours
and confirm that only the published answer is present.

**Acceptance Scenarios**:

1. **Given** a participant with published answers, **When** they open Yours, **Then** Your Answers lists all published answers and their original questions.
2. **Given** a listed answer, **When** it renders, **Then** its processed text and Published label are visible.
3. **Given** a pending, withheld, failed, or abandoned submission, **When** Yours is opened, **Then** no entry or recovery control exists for it.
4. **Given** any contribution, **When** Yours is viewed, **Then** no original-recording playback exists.
5. **Given** no published answers, **When** Yours opens, **Then** the empty state points toward answering a question.

---

### User Story 3 - Hear it (Priority: P3)

A participant taps `Listen` on a response. The product speaks the processed text aloud in one
consistent voice. Not the original recording — that is gone — but the words, spoken.

**Why this priority**: The contributions arrive as speech and are received as text. Playback
returns the human quality of the exchange without ever exposing the original recording.

**Independent Test**: Open a response that has never been played, choose `Listen`, and confirm
audio is produced from the processed text in the product's voice. Choose it again and confirm the
same audio is reused.

**Acceptance Scenarios**:

1. **Given** a response the participant has not played, **When** they choose `Listen`, **Then** playback audio is produced from the processed text and becomes available.
2. **Given** playback audio that already exists for a response, **When** anyone chooses `Listen` on it again, **Then** the existing audio is reused rather than produced again.
3. **Given** any playback in the product, **When** it plays, **Then** it uses one consistent voice used everywhere else in the product.
4. **Given** any playback, **When** it is produced, **Then** it is produced from the processed text and never from an original participant recording.
5. **Given** a response is being prepared for playback, **When** the participant is waiting, **Then** a loading state is shown on that response only.
6. **Given** playback production fails, **When** the failure occurs, **Then** the response's text remains fully readable and a retry is offered for the audio.

---

### User Story 4 - Text does not wait on audio (Priority: P4)

A response is published and readable the instant it passes review. No audio exists for it yet and
none needs to. Audio is made the first time somebody actually wants to hear it.

**Why this priority**: Producing audio for every published contribution up front spends money on
recordings nobody plays and delays publication behind a step nobody asked for.

**Independent Test**: Publish a response, immediately view it, and confirm the text renders with
no audio in existence. Then confirm audio is produced only on the first `Listen`.

**Acceptance Scenarios**:

1. **Given** a response that just passed review, **When** it is viewed, **Then** its text is readable immediately.
2. **Given** a response that has never been played, **When** it is published and viewed, **Then** no playback audio has been produced for it.
3. **Given** a contribution being published, **When** publication completes, **Then** it was not delayed by audio production.
4. **Given** playback audio production is unavailable entirely, **When** a participant views `Yours`, **Then** all text still renders and only the `Listen` action degrades.

---

### Edge Cases

- **Very long response list**: a question with many responses renders them all without breaking the layout at phone width.
- **Response arrives while `Yours` is open**: the participant sees it on their next view. Live updating is not required.
- **Answer still checking when `Yours` is opened**: no entry exists until publication; navigating away abandons the active submission unless publication has already committed.
- **Withheld answer, including crisis**: no history entry exists; reason and retry appear only on the current flow's shared Withheld page.
- **Question withheld before publication**: it never appears in `Your Questions`, because it was never published.
- **Playback requested for a withheld contribution**: not offered. Only published text has a `Listen` action.
- **Playback requested twice at once**: exactly one audio production occurs and both requests receive the same result.
- **Seeded question receives answers**: no personal history view exists for a seed identity, so those answers are visible only to the participants who gave them.
- **Participant has never contributed anything**: `Yours` renders both empty states rather than a blank or errored screen.

## Requirements *(mandatory)*

### Functional Requirements

#### Structure

- **FR-001**: The system MUST provide one `Yours` area containing exactly two sections: `Your Answers` and `Your Questions`.
- **FR-002**: `Yours` MUST show only the requesting participant's published questions and answers, plus published responses to their questions.
- **FR-003**: Every screen in `Yours` MUST be usable at phone and desktop widths without horizontal scrolling.

#### Your Answers

- **FR-004**: `Your Answers` MUST list every answer the participant published and no unpublished attempts.
- **FR-005**: Each listed answer MUST show the original question it addressed.
- **FR-006**: Each listed answer MUST show its Published label.
- **FR-007**: Each published answer MUST show its published processed text.
- **FR-008**: Pending, withheld, failed, and abandoned submissions MUST NOT appear in Yours or expose a restore/retry control.
- **FR-009**: `Your Answers` MUST show an empty state when the participant has published none.

#### Your Questions

- **FR-010**: `Your Questions` MUST list every question the participant published.
- **FR-011**: Each listed question MUST show its processed question text.
- **FR-012**: Each listed question MUST show its number of responses.
- **FR-013**: Each response MUST be shown as text.
- **FR-014**: Each response MUST offer a `Listen` action.
- **FR-015**: A closed question and all of its answers MUST remain fully visible to its asker.
- **FR-016**: `Your Questions` MUST show an empty state when the participant has published none, and a per-question empty state when a question has no responses yet.

#### Display constraints

- **FR-017**: Responses MUST be displayed as a flat list with no nesting or reply trees.
- **FR-018**: Responses MUST NOT be ranked, scored, or ordered by any quality signal.
- **FR-019**: The system MUST NOT offer a best-answer selection.
- **FR-020**: The system MUST NOT offer votes, likes, reactions, ratings, or comments on any response.
- **FR-021**: Withheld content and unpublished attempt state MUST NOT be stored or displayed in Yours, including to the author.
- **FR-022**: The system MUST NOT offer review or playback of a participant's own original recording anywhere.

#### Playback

- **FR-023**: Playback MUST be produced from published processed text; TTS MUST NOT request structured output, and returned audio type and nonempty payload MUST be validated before use.
- **FR-024**: Playback MUST NOT be produced from, or expose, an original participant recording.
- **FR-025**: Playback MUST use one consistent voice everywhere in the product.
- **FR-026**: Playback MUST be produced lazily, on the first `Listen` request for that contribution.
- **FR-027**: Playback audio MUST be cached and reused for every subsequent request.
- **FR-028**: Concurrent first requests for the same contribution MUST result in exactly one production.
- **FR-029**: Playback production MUST NOT block or delay publication of a contribution's text.
- **FR-030**: A contribution's text MUST be readable before any playback audio exists for it.
- **FR-031**: A `Listen` action MUST be offered only for published contributions.
- **FR-032**: While playback is being produced, the system MUST show a loading state scoped to that response.
- **FR-033**: When playback production fails, the text MUST remain readable and a retry MUST be offered for the audio only.
- **FR-034**: When playback production is unavailable entirely, all text MUST still render and only the `Listen` action MUST degrade.

### Key Entities

- **Generated Playback**: Audio produced from a published contribution's processed text in the product's single voice. Created on first request, cached for reuse, and associated with the contribution and the voice used.
- **Answer History Entry**: One of the participant's answers as they see it — the question it addressed, its Published label, and its published text.
- **Question History Entry**: One of the participant's published questions as they see it — its text, its response count, and its responses.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A participant sees every response to their question, as text, within two seconds of opening `Yours`.
- **SC-002**: Published response text is readable before any playback audio exists for it, in one hundred percent of cases.
- **SC-003**: Zero playback audio is produced for contributions nobody has requested, verified by counting productions against `Listen` requests.
- **SC-004**: A repeated `Listen` on the same response produces zero additional audio, reusing the cached result every time.
- **SC-005**: Concurrent first `Listen` requests for the same response result in exactly one production.
- **SC-006**: Zero original participant recordings are exposed, offered, or playable anywhere in `Yours`.
- **SC-007**: Zero pending, withheld, failed, or abandoned submissions appear in history or survive as recoverable attempts.
- **SC-008**: Zero ranking, scoring, voting, rating, reaction, or best-answer controls exist anywhere in the response display.
- **SC-009**: Both empty states, the loading state, and the playback failure state each render correctly when induced, with zero blank or errored screens.
- **SC-010**: `Yours` renders correctly on a current iPhone browser and a current Android browser, including a question with at least ten responses.
- **SC-011**: With playback production entirely unavailable, one hundred percent of text content still renders.

## Assumptions

- **Freshness**: `Yours` reflects state as of the moment it is opened. Live updating, push notification, and background refresh are not required for the MVP.
- **Ordering**: responses are shown in the order they were published. This is chronology, not ranking, and carries no quality signal.
- **Voice**: the single product voice used for playback is the same voice used for optional question playback elsewhere. The specific voice is a planning decision, not a specification one.
- **Cache durability**: cached playback audio persists for the life of the contribution. It is not regenerated on each session.
- **History boundary**: only published contributions persist; unpublished outcomes exist only in the current flow and are discarded when it ends.
- **Access**: `Yours` is scoped to the participant's session identity. A session reset loses access to prior history, per the accepted identity limitation.
- **Volume**: a weekend-scale participant has a small history. Pagination is unnecessary; the list renders in full.

## Out of Scope

- Attempt history, recovery, processing-retry controls, live updating, notifications, email, or alerts.
- Public browsing of other participants' questions, answers, or history.
- Playback or review of any participant's original recording.
- Editing, deleting, withdrawing, or hiding a published contribution.
- Replying to a response, following up, or any further turn on a question.
- Votes, likes, reactions, ratings, comments, best-answer selection, leaderboards.
- Ranking, sorting controls, filtering, or search within history.
- Sharing, exporting, or permalinking a question or response.
- Downloading generated playback audio.
- Pagination and infinite scroll.

## Dependencies

- [003-answer-and-unlock](../003-answer-and-unlock/spec.md) for published answers.
- [004-ask-one](../004-ask-one/spec.md) for published questions and their closure state.
- [002-contribution-review](../002-contribution-review/spec.md) for processed text and contribution outcomes.
- A text-to-speech capability providing one consistent voice.
- Durable storage for cached playback audio, associated with contributions.
