# Feature Specification: Contribution Review

**Feature Branch**: `002-contribution-review`

**Created**: 2026-09-04

**Status**: Draft

**Input**: AI handoff "Happen to Have?" revision 5 — Guardrail outcomes, processing contract, audio output, contribution state model, abuse and cost protection.

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

1. **Given** a recording of relevant spoken advice, **When** the review runs, **Then** it returns readable display text, the detected source language, and permission to publish.
2. **Given** a recording in a language other than the display language, **When** the review runs, **Then** the returned text is in the display language and is readable, with no participant asked to approve it.
3. **Given** a recording naming a person, an employer, a street address, or a phone number, **When** the review runs, **Then** those details are removed or generalized from the returned text.
4. **Given** a recording, **When** the review runs, **Then** the returned text contains no advice, facts, recommendations, or judgments that were not in the recording, and does not alter the substance of what was said.
5. **Given** an answer submission, **When** the review runs, **Then** four independent parallel calls are made on the original recording — content processing, relevance to the question, crisis signalling, and illegal-or-dangerous.
6. **Given** a question submission, **When** the review runs, **Then** three independent parallel calls are made — content processing, crisis signalling, and illegal-or-dangerous — and relevance is not evaluated.
7. **Given** any check, **When** it runs, **Then** it receives the original recording directly and does not consume another check's transcript or output.
8. **Given** all applicable checks return validated permission to publish, **When** the decision resolves, **Then** it permits publication.
8a. **Given** any check rejects, **When** its validated result arrives, **Then** Withheld renders immediately, other work is cancelled where possible, and later results cannot publish anything.
9. **Given** a recording where a broad emotional direction is reliably detectable, **When** the review runs, **Then** that direction is recorded alongside the text.

---

### User Story 2 - A contribution that cannot be shared (Priority: P2)

Someone records something the review will not publish. It might not answer the question at all.
It might describe something illegal. They see one page, with text that matches what actually
happened, and they can try that same question again or go find a different one. Nothing is
published. Nothing is held against them.

**Why this priority**: Publishing an unpublishable contribution is the failure that ends the
product. Handling the rejection gracelessly is the failure that loses the participant.

**Independent Test**: Submit prepared irrelevant and illegal recordings and confirm each renders
the shared result page with its own text, publishes nothing, and returns the participant to the
flow with no penalty.

**Acceptance Scenarios**:

1. **Given** an answer that does not address its question, **When** the review completes, **Then** the outcome is Withheld with reason relevance, nothing is published, and the result page reads `That response doesn't appear to answer this question. Try another.`
2. **Given** a recording describing illegal or dangerous activity, **When** the review completes, **Then** the outcome is Withheld with reason illegal/dangerous, nothing is published, and the result page reads `That response can't be shared here. Try another.`
3. **Given** a recording that is silent, unintelligible, spam, deliberate nonsense, or harassing, **When** the review completes, **Then** the contribution is withheld and nothing is published.
4. **Given** a recording whose identifying details cannot be safely removed, **When** the review completes, **Then** the contribution is withheld rather than published in partially redacted form.
5. **Given** any rejected contribution, **When** the result page renders, **Then** it is one shared Withheld page for all rejection reasons, with reason-specific text and contribution-specific actions, and its text is short and non-argumentative.
6. **Given** a withheld contribution, **When** the participant returns to the flow, **Then** they may record again immediately with no penalty, cooldown, or strike recorded against them.
6a. **Given** an answer Withheld for relevance or illegal/dangerous content, **When** the result page renders, **Then** it offers both a retry of the same question and a way to find a different one, and retry does not require finding the question again in the pool.
6b. **Given** a crisis Withheld result, **When** it renders, **Then** fixed resources and a fresh-recording action are both available because the classification can be wrong.
6c. **Given** a withheld question, **When** the participant retries, **Then** `/ask` starts a fresh question recording with the earned ask intact, never an answer recorder.
7. **Given** crisis and illegal-or-dangerous reasons, **When** they are evaluated, **Then** their reasons remain distinct within the single Withheld outcome so the correct text is selected.

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

1. **Given** a recording signalling a personal crisis, **When** the review completes, **Then** the outcome is Withheld with reason crisis and the recording is withheld from the public pool entirely.
2. **Given** a crisis outcome, **When** the result page renders, **Then** it shows fixed, human-authored routing text including both US and international resources.
3. **Given** a crisis outcome, **When** the page renders, **Then** no counseling text is generated and no claim of emergency intervention is made.
4. **Given** a participant who has never contributed anything, **When** they need crisis resources, **Then** those resources are reachable without earning an ask.
5. **Given** a crisis recording submitted as a question, **When** the review completes, **Then** crisis detection applies exactly as it does to an answer and the question is not published.
6. **Given** a contribution Withheld for crisis, **When** any other participant views any part of the product, **Then** its content appears nowhere.

---

### User Story 4 - Retry only what broke (Priority: P4)

One check fails while the others pass. The passing results stay valid for this submission;
only the failed check retries. No attempt is saved for later.

**Why this priority**: A provider fault must not become a participant rejection or duplicate
all the work that already succeeded.

**Independent Test**: Force one check to fail once, then succeed, and verify that only it runs
again; separately exhaust retries and confirm fresh recording is offered without stored state.

**Acceptance Scenarios**:

1. **Given** three passing checks and one provider failure, **When** retry runs, **Then** only the failed check runs again using the same original audio.
2. **Given** a schema-invalid result, **When** it is handled, **Then** that check retries independently and no unvalidated output reaches storage or the interface.
3. **Given** an in-flight retry and a definitive rejection from another check, **When** rejection arrives, **Then** Withheld appears immediately and further retries and late results are ignored.
4. **Given** exhausted retries or the submission deadline, **When** processing ends, **Then** the participant sees a processing failure with a fresh-recording action, not Withheld.
5. **Given** a processing failure or abandoned page, **When** the participant returns later, **Then** no attempt, recording, or retry entry is restored.
6. **Given** a failed question submission, **When** processing ends, **Then** the earned ask remains unspent.

---

### User Story 5 - The recording disappears (Priority: P5)

The moment a decision is final — published or withheld or failed for good — the original
recording is deleted. It was never reachable by anyone else while it existed. Nothing in the
product ever plays it back.

**Why this priority**: People speak honestly only when the raw recording cannot resurface. Every
other privacy control in this product is decoration if the audio persists.

**Independent Test**: Submit contributions reaching each terminal outcome, then attempt direct
retrieval of the original recording from outside the system and confirm all attempts fail and
no stored copy remains.

**Acceptance Scenarios**:

1. **Given** an original recording at any point in its life, **When** retrieval is attempted from outside the system, **Then** it is not reachable at any address.
2. **Given** a contribution reaching a published outcome, **When** the outcome is recorded, **Then** the original recording is deleted immediately.
3. **Given** a contribution reaching a Withheld or processing-failure outcome, **When** the outcome is recorded, **Then** the original recording is deleted immediately.
4. **Given** an independent check retry, **When** the active submission finishes, expires, or is abandoned, **Then** the original recording and temporary check state are deleted rather than retained for later recovery.
5. **Given** any part of the product, **When** a participant looks for their own original recording, **Then** no review or playback of it is offered anywhere.
6. **Given** the storage holding original recordings, **When** it is inspected, **Then** a lifecycle deletion rule exists as a backstop and no recording predates it.

---

### Edge Cases

- **Partial check failure**: keep passing results and retry only failed checks while no definitive rejection exists.
- **Rejection plus failure**: Withheld wins immediately; cancel outstanding work where possible and never offer processing retry for that recording.
- **Multiple known rejections**: crisis, illegal/dangerous, relevance, then content determines the copy; do not wait for unfinished checks to discover another reason.
- **Late completion after rejection or expiry**: ignore it; it cannot publish or change the resolved page.
- **Repeated fresh recordings**: allowed for every reason, including crisis, subject to the submission rate limit.
- **Empty, silent, or corrupt audio**: show Withheld with a content reason before spending avoidable provider calls.
- **Deletion fails**: retry deletion immediately for up to 60 seconds; the storage lifecycle remains an orphan-cleanup backstop.
- **Browser closes or disconnects**: cancel on a detected disconnect and delete source audio; the 90-second server deadline also bounds requests whose disconnect is not detected.
- **Response lost after publication**: the committed contribution remains visible in Yours; do not restore an attempt or roll back an earned/spent ask.
- **No reliable emotion**: record no emotional direction.
- **Rate limit**: refuse before review and state when a new recording may be submitted.

## Requirements *(mandatory)*

### Functional Requirements

#### Review structure

- **FR-001**: The system MUST review every submitted recording before publishing it.
- **FR-002**: An answer review MUST perform four parallel calls on the original recording, one per signal: content processing, crisis, illegal-or-dangerous, and relevance.
- **FR-003**: A question review MUST perform three parallel calls. Relevance MUST NOT be evaluated for a question, and the system MUST NOT make the call at all.
- **FR-004**: Each check MUST receive the original recording independently.
- **FR-005**: A check MUST NOT consume another check's transcript, text, or output.
- **FR-006**: The relevance check MUST additionally receive the text of the question being answered.
- **FR-007**: Publication MUST wait for every applicable check to pass; a definitive rejection MUST resolve immediately to Withheld without waiting for the other checks.
- **FR-008**: The system MUST NOT substitute relevance alone, or any single check alone, for the full set.
- **FR-008a**: Signals MAY share a call. Measured on two independent unseen sets, three runs each, a merged judgment call and dedicated calls are indistinguishable at the content tier — 10 of 10 with zero false positives either way — once both carry the same crisis instruction. The earlier requirement that every signal take its own call was measuring the weighing clause in FR-008a3, which the dedicated prompt had and the merged one did not. **002 nonetheless ships four calls**: it is built, it is measured, and it degrades better if the tier is ever forced down. That is an implementation choice, not a requirement.
- **FR-008a3**: The crisis instruction MUST carry an explicit weighing clause — answer yes when the signal is present even when unsure, because an unnecessary offer of help costs someone a moment and a missed one costs more than this system can repair. Isolated, that paragraph is the difference between 9 of 10 and 10 of 10 on unseen recordings, and it is the effect that two prior amendments mistook for the call split.
- **FR-008a2**: Content processing MUST stay separate for a second, independent reason: it reproduces the recording as text and was measured returning an empty candidate on recordings the other calls handled cleanly. Keeping it apart leaves a usable verdict when the transcript is lost — merged, one block would destroy every judgment and an unlawful recording would render as a processing failure instead of Withheld.
- **FR-008a1**: The crisis call MUST run on the content-processing tier rather than the cheap one. **This is the load-bearing rule.** Every configuration reaching 10 of 10 is on the content tier; every configuration on the cheap tier misses between two and ten depending on the set and the shape, and on the third set a merged cheap-tier call caught none of ten and produced a false positive. Crisis is the only signal whose failure causes harm outside the software.
- **FR-008b**: Every call MUST set every adjustable safety category to a threshold that never blocks, and MUST set it **explicitly** rather than relying on the provider's default. The provider documents these filters as off by default, so explicit configuration changes nothing today and protects the gate from moving if that default changes. A block destroys a contribution while returning no reason and no ratings, and retry cannot recover it.
- **FR-008b1**: A response with no candidate MUST be treated as a provider fault and retried independently under FR-038, never read as a verdict and never resolved from the other call's result. This is permanent, not configurable: the provider's non-adjustable protections against core harms stay active at every setting this system can send, and empty candidates were observed at a never-block threshold. The absence of a candidate carries no reason, so reading a decision from it manufactures a verdict from silence. A call that never returns therefore cannot permit publication — FR-019 still requires every applicable signal to pass.
- **FR-008c**: The illegal-or-dangerous decision MUST be produced by its own call, never read from provider metadata. The spike settled this twice over: the provider returns **no safety ratings at all** on this path, at every configuration tested; and its adjustable filters are off by default, so nothing screens a recording for legality unless this product does it. Evidence: [spike-002-guardrails](../../docs/spike-002-guardrails.md).
- **FR-008d**: A crisis judgment MUST exist as its own call with its own instructions. No provider category covers self-harm or crisis — not among the adjustable filters, which are off by default in any case, and not among the non-adjustable core-harm protections. Content moderation also answers a different question — *is this content harmful to distribute* — than crisis, which asks *is this person in trouble*. Every crisis recording in the test set, including one naming a method and a written letter, was transcribed and returned clean.
- **FR-008e**: The withheld reason MUST be the signal whose own call refused. With one signal per call there is nothing to infer — the refusing call *is* the reason, and no model-reported reason field is needed or permitted. The transcript of a withheld contribution is never published, so the refusing call is the only thing that selects the reason text.
- **FR-008h**: Content processing MUST state a reason whenever it refuses, and a refusal carrying no reason MUST be treated as a validation fault under FR-037 and retried, never rendered as a Withheld with a guessed message. No other call reports audio quality: the earlier cross-call fallback existed only because a merged judgment call happened to be listening, and validation already made it unreachable. A lost content result is a processing failure under FR-040, not a Withheld — the system does not know whether the recording was publishable and the participant did nothing wrong.
- **FR-008f**: The crisis check MUST name the signals it is looking for rather than instructing the model that understated phrasing counts. Named categories plus FR-008a3's weighing clause are what the 10 of 10 was measured on; neither alone reaches it. The signals are putting affairs in order, a foreshortened future, burden framed as logic or arithmetic, withdrawal from the people who matter, means or escape held in reserve, and exhaustion at continuing itself as distinct from exhaustion at a situation. It MUST NOT require an explicit method, plan, or the word *suicide*, and MUST NOT reject grief, burnout, money worry, figures of speech such as *that job was killing me*, or giving up on a project, a job or a friendship.
- **FR-008g**: The relevance check MUST judge only whether the answer addresses the question, and MUST NOT reject an answer for being unlawful, dangerous, or offensive. In the spike, relevance rejected on-topic answers purely because their content was unsafe, which destroys the system's ability to tell an off-topic contribution from an unsafe one and so selects the wrong Withheld reason under FR-008e.

#### Content processing

- **FR-009**: Content processing MUST transcribe the recording.
- **FR-010**: Content processing MUST detect the source language.
- **FR-011**: Content processing MUST translate the content to the display language when it is not already in it.
- **FR-012**: Content processing MUST remove or generalize identifying information, including names, addresses, employers, and contact details.
- **FR-013**: Content processing MUST produce readable display text.
- **FR-014**: Content processing MUST NOT add advice, facts, recommendations, or moral judgment absent from the recording.
- **FR-015**: Content processing MUST NOT alter the participant's substantive advice.
- **FR-016**: Content processing MUST identify recordings that are silent, unintelligible, spam, deliberate nonsense, harassing, or unsafe to publish for privacy reasons, and MUST withhold them.
- **FR-017**: Content processing MUST return a broad emotional direction when reliably detectable and none otherwise.
- **FR-018**: Translation MUST be invisible to the participant. The system MUST NOT present a translation review or approval screen at any point.

#### Decision

- **FR-019**: A contribution MUST publish only when every applicable check explicitly permits publication; successful checks MUST NOT be rerun inside that active submission.
- **FR-020**: Review MUST resolve to publishable, Withheld, or processing failure; abandonment publishes nothing. Withheld MUST carry a reason rather than create separate irrelevant/crisis/illegal outcomes.
- **FR-021**: The Withheld reason MUST distinguish crisis, illegal/dangerous, relevance, and content reasons such as silence, unintelligible audio, spam, harassment, or privacy.
- **FR-022**: Any definitive rejection MUST stop other work and retries where possible. Among rejections already known at resolution, presentation precedence MUST be crisis, illegal/dangerous, relevance, then content; late results MUST NOT change the outcome.
- **FR-023**: Check results, retry counts, and errors MUST exist only for the active submission; no unpublished contribution rows or attempt history may be persisted.

#### Result presentation

- **FR-024**: Every rejection MUST render the shared Withheld page with reason-specific text and contribution-specific actions; it is not an answer page.
- **FR-025**: The relevance failure text MUST be `That response doesn't appear to answer this question. Try another.`
- **FR-026**: The illegal or dangerous text MUST be `That response can't be shared here. Try another.`
- **FR-027**: Result page text MUST be short and non-argumentative, and MUST NOT explain, justify, or debate the decision.
- **FR-027a**: Every Withheld result, including crisis, MUST offer a fresh recording and a way back; no withheld recording may be reprocessed.
- **FR-027b**: Answer retry MUST return to `/answer/record?questionId=<same>`; question retry MUST return to question recording at `/ask` with the earned ask intact.
- **FR-027c**: The crisis variant MUST retain fixed resources alongside a fresh-recording action because crisis classification can be wrong.
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
- **FR-038**: A failed, timed-out, structurally invalid, or unparseable check MUST retry independently without rerunning checks that passed; it MUST NOT be relabeled as participant rejection.
- **FR-039**: Each check MUST have at most three invocations per active submission, including the initial call, with a 20-second timeout per invocation and waits of 1 then 2 seconds before retries; the complete server submission MUST stop at 90 seconds from receipt.
- **FR-040**: Exhausted retries or deadline expiry MUST show processing failure and offer a fresh recording, never blame the participant or promise recovery of the previous audio.
- **FR-041**: Original audio and successful check results MAY exist only during the active submission; retries MUST stop on rejection, abandonment, or deadline expiry.
- **FR-042**: Processing failure MUST publish nothing and MUST NOT grant or consume an ask.

#### Audio lifecycle

- **FR-043**: An original recording MUST NOT be reachable from outside the system at any address, at any time.
- **FR-044**: Every application-held original recording MUST be deleted immediately on publication, Withheld, processing failure, or abandonment.
- **FR-045**: An original recording or unpublished attempt MUST NOT be retained for a later submission; browser memory MUST be released when the submission ends or the page is left.
- **FR-046**: Transient storage MUST carry a lifecycle backstop, and normal cleanup MUST explicitly delete objects on every exit; failed deletion MUST be retried for up to 60 seconds without reopening review.
- **FR-047**: The system MUST NOT offer review or playback of a participant's own original recording anywhere.

#### Abuse and cost protection

- **FR-048**: The submission path MUST enforce a server-side rate limit whose numeric values are configurable without a code change.
- **FR-049**: A rate-limited response MUST state when the participant may try again.
- **FR-050**: The system MUST reject silent, empty, or invalid audio before spending avoidable review work.
- **FR-051**: Rate limit values MUST be validated against a complete answer-then-ask cycle before launch rather than copied from another product.
- **FR-052**: A rate-limited submission MUST NOT leave a contribution in an unresolvable state.

### Key Entities

- **Active Submission**: The current request's original audio, applicable check results, and bounded retry state; discarded at completion, failure, or abandonment.
- **Review Outcome**: Permission to publish, Withheld with its reason, or processing failure; consumed by 003 or 004 without creating attempt history.
- **Crisis Routing Content**: Fixed, human-authored text and US/international resources available alongside fresh-recording actions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From the moment a recording is submitted, a decision is returned within fifteen seconds in the median case and thirty seconds at the ninety-fifth percentile.
- **SC-002**: Zero original recordings are retrievable from outside the system at any point in their life, verified by direct retrieval attempts against every terminal outcome.
- **SC-003**: Original recordings are deleted on every submission exit; deletion-failure tests recover within the 60-second cleanup retry window, and lifecycle cleanup is verified for simulated process termination.
- **SC-004**: Every crisis rejection in the prepared test set renders fixed resources and a fresh-recording action, with no publication.
- **SC-005**: Zero published texts contain names, street addresses, employers, phone numbers, or comparable identifying details present in the source recording, across the privacy test set.
- **SC-006**: Zero published texts contain advice, facts, recommendations, or judgments absent from the source recording, across the fidelity test set.
- **SC-007**: Non-English recordings produce readable display text in the display language in at least ninety percent of the multilingual test set.
- **SC-008**: Prepared rejection recordings render Withheld with the correct reason-specific text, including silence, privacy, relevance, crisis, and illegal/dangerous cases.
- **SC-008a**: All Withheld variants offer a fresh recording in the correct contribution flow, including crisis and rejected questions.
- **SC-009**: Induced transient failures retry only failed checks; exhaustion produces processing failure, deletes the recording, and leaves no unpublished contribution or recovery entry.
- **SC-010**: Every schema-invalid result follows independent bounded retry unless another check has already rejected the submission.
- **SC-011**: The complete answer-then-ask cycle at normal participant pace never triggers the rate limit.
- **SC-012**: Measured cost per contribution, including the maximum independent retries, is recorded before interface work depends on it.

## Spike questions — answered 2026-09-05

Run against 16 prepared recordings covering the compositional illegal pair, crisis with and
without moderation-flagged content, relevance, and benign controls. Full method and results:
[spike-002-guardrails](../../docs/spike-002-guardrails.md).

1. **Are the provider's dangerous-content ratings sufficient for illegal-or-dangerous?**
   **No — the ratings do not exist.** `safetyRatings` is absent from the response at a
   never-block threshold and with no safety configuration at all — which, since the adjustable
   filters are off by default, are the same request.
   FR-008c's exception applies and the dedicated call is built.
2. **What does a never-block threshold actually return?** A candidate carrying only content,
   finish reason, and index. No ratings, no prompt feedback. It still returns an empty
   candidate on some illegal recordings, and it did so inconsistently for the same audio
   across runs — the absence of a candidate is not a usable signal.
3. **Does the crisis check catch what moderation misses?** **Yes, and moderation misses nearly
   all of it.** At the provider's default guardrails, 7 of 8 must-not-publish recordings came
   back with clean transcribed text, including every crisis case. The dedicated check caught
   them. It needed FR-008f's named signal categories, a call of its own, and the content tier:
   measured on twenty unseen recordings, the same wording caught 2–3 of 10 merged on the cheap
   tier, 9 of 10 merged on `gemini-3.8-flash`, and 10 of 10 dedicated on `gemini-3.8-flash`,
   with zero false positives on ten near-miss controls throughout.
4. **Latency of the real fan-out.** Median 2.4s, p90 3.6s, measured on 12–16 second clips of a
   two-call fan-out. Comfortably inside SC-001, but **not yet proven at the 60-second ceiling**,
   which carries roughly four times the audio, nor re-measured since the split to four parallel
   calls. Parallel calls should not add latency beyond the slowest, which is now crisis on the
   content tier rather than a judgment on the cheap one.

---

## Assumptions

- **Display language**: English is the display and translation target for the MVP. Contributions in other languages are translated into English. Policy beyond the weekend is unsettled.
- **Emotional direction**: best effort and broad only. The product does not claim to preserve the original delivery. If the technical spike shows this is unreliable, it is dropped rather than shipped as a guess.
- **Boolean meaning**: each check returns `canPublish`; true is YES and false is NO, including the crisis and illegal checks. A negative permission result is definitive; a provider fault is not a negative permission result.
- **Crisis content authorship**: routing text and resource links are written and verified by a person before launch, and are static.
- **Rate limit values**: specific numbers come from testing a complete cycle, not from another product. They are configurable without a code change.
- **Checks stay separate**: an implementation choice, not a measured requirement. Controlled for
  prompt content, merged and dedicated shapes tie at 10 of 10 on the content tier across two
  unseen sets. Merging is only costly on the cheap tier, which crisis may not use anyway. The
  four-call shape ships because it is built and degrades better under a forced downgrade.
- **Illegal-or-dangerous is a build item**: settled by the spike. The provider returns no
  dangerous-content rating to read, and its default guardrails passed 7 of 8 must-not-publish
  recordings, so the dedicated call is the only screening that exists. This reverses the earlier
  assumption that the rating came free with the content call.
- **Latency budget**: the spike measured a 2.4s median and 3.6s p90 fan-out on 12–16 second clips, well inside SC-001. This is not yet proof at the 60-second ceiling; the figure MUST be re-measured on full-length recordings before the checking-state experience is treated as settled.
- **Lifetime**: only the active submission owns temporary audio and check results. A fresh recording is a new submission; it does not recover an earlier attempt.

## Out of Scope

- Any recording interface, timer, or microphone handling.
- Question selection, skipping, or the pool.
- Granting or consuming an ask. This spec returns a decision; the flows act on it.
- The `Yours` history area.
- Generated playback of processed text.
- Publishing, reviewing, or playing back original participant recordings.
- A pre-publication review or approval screen for the participant.
- Human moderation, appeals, durable attempt history, and recovery of unpublished contributions.
- CAPTCHA, IP blocking, and account suspension.
- Conversational prompts, follow-up questions, or generated advice of any kind.

## Dependencies

- [001-participant-and-pool](../001-participant-and-pool/spec.md) for participant identity.
- A speech-processing capability that accepts recorded audio and returns validated structured results for transcription, translation, privacy redaction, relevance, crisis signalling, and illegal-or-dangerous content.
- Storage for transient original recordings with no external access path and a lifecycle deletion backstop.
- Durable storage for published contributions only; temporary review state is request-scoped.
- Human-authored crisis routing content covering US and international resources.
