---
document_type: ai_handoff
product: "Happen to Have?"
status: planning
build_window: two days
audience: implementation_ai
revision: 5
---

# Mission

Build a responsive web app for the DEV Weekend Challenge: Generosity Edition.

The product is a human advice exchange governed by one rule:

> Answer one. Ask one.

A participant must submit a qualifying answer to another person's question before submitting one question of their own.

# Product truth

- Humans provide every question and every answer.
- Gemini processes human contributions; it does not invent advice.
- The app is an asynchronous recording workflow, not a conversation.
- Do not describe Gemini, a recorder, or the processing pipeline as an agent.
- Do not use ElevenAgents or any ElevenLabs product in the MVP.
- Use Gemini directly so it receives the original audio and owns the processing path end to end.
- Use one selected Gemini TTS voice for published playback; exact voice is still open.
- Do not transform contributions into an Appalachian dialect.
- Appalachia belongs in the origin story and product values only.

# Name and framing

- Product name: **Happen to Have?**
- Preserve the question mark.
- Tagline: **Answer one. Ask one.**
- Do not use “who answers” framing.
- Do not use “let me ask someone else” framing.
- Do not frame the product as a marketplace, expert network, therapy service, or social feed.

## Origin story

- The founder is Appalachian.
- “Happen to have” is an Appalachian phrase and the source of the name.
- The founder's childhood church group was called Busy Bees.
- Busy Bees helped neighbors and cooked for people who needed it.
- The story supplies the value system: bring what you have, receive what you need, and do not permanently divide people into helpers and helped.
- Busy Bees is not the product name or visual theme.
- Do not imitate, generate, or market an Appalachian dialect.

# Core interaction contract

## Qualifying answer

An answer qualifies when all of the following are true:

```text
duration_seconds <= 60
every applicable check completed with validated canPublish == true
```

There is no minimum duration. Gemini guardrails determine whether the contribution qualifies; elapsed time does not substitute for substance.

“Useful” means the answer passed the aggregate automated guardrail gate. Relevance is an additional qualification signal inside that gate, not a replacement for the gate itself.

“Useful” does not mean:

- The asker accepted it.
- The asker agreed with it.
- It received a vote or rating.
- It was selected as a best answer.
- Another participant reviewed it.

Do not expose “safe” as product positioning or routine participant-facing copy. Safety is expected infrastructure.

## Reciprocity

- One qualifying answer unlocks one question.
- Asking consumes that unlock.
- Do not allow participants to bank multiple asks in the MVP.
- Do not unlock asking when recording ends.
- Unlock only after Gemini processing completes and the answer passes the gate.
- The participant therefore waits on the Checking state.
- Failed checks retry independently during the active submission; exhausted retries produce Processing Failed and offer a fresh recording, never a participant rejection.
- Skipping only changes the presented question. It never affects ask eligibility and never starts a recording.

## Guardrail outcomes

- Crisis resources must remain reachable without earning an ask.
- Use one static result page for every non-passing outcome.
- Withheld is one outcome with reason-specific text for relevance, crisis, illegal/dangerous, silence, unintelligible audio, privacy, spam, harassment, or other content.
- Include US and international resources plus a fresh-recording action in the crisis variant; Gemini can be wrong.
- Apply crisis detection to both questions and answers.
- Crisis content is withheld from the public response pool.
- Show fixed, human-authored crisis routing.
- Do not generate counseling or claim emergency intervention.
- A withheld crisis submission does not unlock asking because it did not pass the contribution gate.
- Illegal or dangerous content is withheld and receives its own text on the same result page.
- An irrelevant answer is withheld and receives its own text on the same result page.

# Participant workflow

## 1. Arrival

Show:

```text
Happen to Have?
Answer one. Ask one.
```

Primary action: `Find me a question`

Preferred weekend identity model:

- Anonymous browser/session identity.
- No public profile.
- No public username.
- No follower graph.
- No expertise credentials.

Account requirements are not fully settled. Do not add signup unless durable cross-device access becomes a requirement.

Accepted weekend limitation:

- Session-only identity makes the reciprocity gate soft.
- Clearing cookies or opening a private window resets participant state.
- Document the limitation; do not spend the build window solving it.

## 2. Question selection

- Select an open question from the seeded/live pool.
- Strictly order each eligible pass by published-response count, creation time, and id ascending.
- Do not select the participant's own question.
- Do not select a question the participant already answered.
- Let the participant skip by advancing a tab-local pointer through that ordered list; never move entries or store skip exclusions.
- Refresh and wrap at the end; if another question exists avoid an immediate repeat, otherwise keep the sole question visible with an explanation.
- Skipping does not create a penalty or start recording.
- Ashley will author the seed pool before launch. TODO(SEED_CONTENT): content and recording provenance TBD; do not generate substitutes.

Actions:

- `I can answer this`
- `Try another question`

## 3. Record an answer

- Display the question as text.
- Optionally play the question using the selected Gemini TTS voice.
- Start the answer timer when participant recording starts.
- Automatically stop at 60 seconds.
- Show elapsed time and the remaining limit.
- Do not introduce conversational prompts or follow-up questions.

## 4. Process the answer

Show: `Checking your answer…`

Upload the original audio to the server and process it directly with Gemini.

Do not unlock asking while processing is incomplete.

### Pass

- Persist the processed text.
- Delete the original audio immediately after a terminal processing result.
- Mark the answer Published.
- Grant one ask.
- Show: `Your answer counts. Ask one.`

### Guardrail failure

- Do not publish the answer.
- Do not grant an ask.
- Return the participant to the answer flow.
- Render the shared result page with short, non-argumentative text for the specific outcome.
- Relevance text: `That response doesn't appear to answer this question. Try another.`
- Crisis text: use fixed crisis-routing language and resources with a fresh-recording action.
- Illegal or dangerous text: `That response can't be shared here. Try another.`

### Provider or network failure

- Keep successful check results only during the active submission; retry only failed checks.
- Allow at most three invocations per check, a 20-second timeout each, waits of 1 then 2 seconds,
  and a 90-second submission deadline from server receipt.
- A definitive rejection stops all remaining work/retries where possible and shows Withheld.
- On exhausted retries, expiry, or abandonment, delete the original audio and temporary state.
- Offer a fresh recording in the originating flow; no stored attempt or later recovery exists.

## 5. Record a question

- Allow one question after the qualifying answer.
- Use voice input.
- Maximum length: 60 seconds.
- No minimum duration is currently required.
- Do not answer the question during submission.
- Do not ask follow-up questions in the MVP.
- Process the question through the same translation, privacy, and guardrail pipeline.
- Publish it only after processing passes.
- Consume the participant's ask only when the question is successfully created.
- Return the participant to Needs Answer state.

## 6. Receive responses

- A question may receive multiple answers.
- Display responses as a flat list.
- Do not add nested replies.
- Do not rank responses.
- Do not select a best answer.
- Do not add votes, likes, reactions, comments, or ratings.
- Keep unanswered questions open indefinitely.
- Close a question for further routing after three qualifying, published answers from three different participants.
- Closed questions and their existing answers remain visible to the asker.

## 7. Personal history

Provide one `Yours` area with two sections.

### Your Answers

Show:

- Original question.
- Published label.
- Published processed text.
- Published entries only; no pending, withheld, failed, or abandoned attempts are stored or shown.

Do not build playback for the participant's original recording.

### Your Questions

Show:

- Processed question text.
- Number of responses.
- Each response as text.
- A Listen action for each response.

# Abuse and cost protection

- The public submission endpoint spends money on every Gemini request.
- Apply a configurable server-side submission rate limit.
- Do not copy another product's numeric limit without testing this product's complete Answer then Ask cycle.
- Rate-limit responses must state when the participant can try again.
- Silence and invalid-audio rejection should happen before avoidable downstream work.
- CAPTCHA, IP blocking, and account suspension are outside the weekend MVP.

# Gemini processing contract

Review calls use structured output and application validation. TTS does not request structured
output; validate the returned audio type and nonempty payload before caching or serving.

Run content processing and the three narrow checks independently on original audio, in parallel.
Questions omit relevance. All checks return `canPublish`: true is YES, false is NO.

- Keep each validated YES during the active submission.
- A definitive NO immediately resolves Withheld and cancels other work where possible.
- Retry only failed, timed-out, or schema-invalid checks within the active submission's bounds.
- Ignore late results after rejection, deadline, or abandonment.
- Publish only after every applicable check says YES.
- Among rejections already known at resolution, display crisis before illegal/dangerous, relevance,
  then content; do not wait for unfinished calls.

```text
guardrail_decision == pass
  when every applicable check.canPublish == true
```

## Content-processing call

Recommended internal answer result:

```json
{
  "sourceLanguage": "string",
  "sourceTranscript": "string",
  "displayText": "string",
  "isIntelligible": true,
  "canPublish": true,
  "guardrailReason": "none | silence | nonsense | pii | harassment | other",
  "emotion": "neutral | warm | amused | concerned | frustrated | sad | urgent",
  "redactionsApplied": ["string"]
}
```

Processing responsibilities:

- Transcribe the original audio.
- Detect the source language.
- Translate to the MVP display language when necessary.
- Remove or generalize identifying information.
- Detect silence, unintelligible audio, spam, deliberate nonsense, harassment, and privacy failures.
- Produce clear display text without changing the participant's substantive advice.
- Record broad emotional direction when reliably detectable.
- Never add new advice, facts, recommendations, or moral judgment.

## Parallel guardrail calls

### Relevance

Input:

- Original audio.
- The question being answered.

Output:

```json
{ "canPublish": true }
```

Relevance is necessarily model-judged. It supplements the aggregate gate; it does not replace the content, crisis, or illegal-content decisions.

### Crisis

Input: original audio.

Output:

```json
{ "canPublish": true }
```

### Illegal or dangerous content

Input: original audio.

Output:

```json
{ "canPublish": true }
```

For both crisis and illegal/dangerous checks, `canPublish: false` means the check detected a
reason to withhold. Track which check rejected only in active state to select the Withheld text.

Translation behavior:

- Translation is invisible infrastructure.
- There is no translation review screen.
- Do not require a participant to approve text they may not understand.
- The MVP display language is not fully settled; English is the current working assumption.

Emotion behavior:

- Emotion preservation is best effort.
- Do not claim exact preservation of the original performance.
- Use only broad delivery direction with the selected output voice.
- Validate this behavior during the initial technical spike.

# Audio output

- Use Gemini for transcription, processing, and generated playback. Do not add ElevenLabs.
- Pick one Gemini TTS voice and use it consistently.
- Exact voice is unresolved.
- Generate playback from processed text, not the original recording.
- Generate audio lazily on the first Listen request.
- Cache generated playback.
- Do not block publication on audio generation.
- Do not retain or expose original participant audio after processing.
- Delete original audio immediately on publication, Withheld, processing failure, or abandonment.
- Audio may exist only inside the bounded active submission; do not retain it for another attempt.
- Browser memory is released when the submission ends or the page is left; server cleanup retries
  deletion for up to 60 seconds, with storage lifecycle cleanup only as a process-failure backstop.

# State models

## Participant state

```text
NEEDS_ANSWER
  -> RECORDING_ANSWER
  -> CHECKING_ANSWER
  -> ASK_UNLOCKED
  -> RECORDING_QUESTION
  -> CHECKING_QUESTION
  -> NEEDS_ANSWER
```

Failure paths:

```text
CHECKING_ANSWER
  -> ANSWER_RETRY_REQUIRED
  -> NEEDS_ANSWER

CHECKING_QUESTION
  -> QUESTION_RETRY_REQUIRED
  -> ASK_UNLOCKED
```

## Active submission state

```text
RECEIVED -> PROCESSING
PROCESSING -> PUBLISHABLE | WITHHELD(reason) | PROCESSING_FAILED | ABANDONED
```

Failed checks retry independently inside PROCESSING; definitive rejection ends the submission.
Only PUBLISHABLE may create a durable contribution row atomically with the ask grant or spend.
All other state is discarded, and a fresh recording starts a new submission.

# Minimum data model

Keep only published questions and answers, with generated-audio cache metadata on those rows.
Do not create unpublished contribution rows, attempt history, recovery jobs, or source-audio
columns. Submission ids on published rows provide idempotency after lost responses.

## participants

- `id`
- `can_ask`
- `created_at`

## questions

- `id`
- `participant_id`
- `display_text`
- `source_language`
- `status` (`open` or `closed`, routing only)
- `duration_seconds`
- `submission_id`
- `generated_audio_storage_key`
- `audio_voice_id`
- `created_at`

## answers

- `id`
- `question_id`
- `participant_id`
- `duration_seconds`
- `display_text`
- `source_language`
- `emotion`
- `submission_id`
- `generated_audio_storage_key`
- `audio_voice_id`
- `created_at`

# MVP boundaries

Include:

- Responsive web app.
- Microphone recording and upload.
- Pre-populated question pool.
- Question selection and skipping.
- Sixty-second answer ceiling with no minimum duration.
- Blocking Checking state.
- Gemini structured content processing plus relevance, crisis, and illegal-content guardrails running in parallel.
- One-answer-for-one-question eligibility.
- Voice question submission.
- Multiple flat responses.
- Yours area.
- Lazy generated playback.
- Fixed crisis routing.
- Configurable basic rate limiting.
- Loading, empty, failure, and retry states.

Exclude:

- ElevenAgents and all other ElevenLabs products.
- Conversational agents.
- Native Android or iOS apps.
- Real-money transfers or wallets.
- Appalachian dialect generation.
- Original-audio publishing.
- Original-audio review or playback.
- A pre-publication review screen.
- Expert matching.
- Public profiles.
- Followers.
- Direct messages.
- Comments or reply trees.
- Votes, ratings, accepted answers, and leaderboards.
- Social or recommendation feed.
- “Ask someone else” delegation.

# Two-day execution order

## Initial kill spike

Prove before building the full UI:

1. Record short and 60-second answers in mobile Safari and Android Chrome.
2. Upload original audio to Gemini.
3. Receive schema-valid structured output from the content call and all three parallel guardrails.
4. Test Appalachian speech recognition without dialect transformation.
5. Test translation.
6. Test privacy redaction.
7. Test aggregate pass, relevance failure, crisis, and illegal/dangerous outcomes.
8. Test broad emotion detection.
9. Generate playback using one candidate voice.
10. Measure end-of-recording to aggregate gate-decision latency and the cost of four audio calls.

Kill or simplify any feature that does not work reliably during this spike.

## Day 1

- Build responsive shell and anonymous participant identity.
- Seed the question pool.
- Build question selection and skip flow.
- Build answer recording and timer.
- Build the Gemini content-processing endpoint and three parallel guardrail calls.
- Build guardrail-gated unlock state.
- Build question recording and creation.
- Persist only published questions and answers; keep check/retry state in the active request.

## Day 2

- Build multiple-response display.
- Build Yours area.
- Build lazy playback and caching.
- Add crisis routing.
- Add rate limiting.
- Add retry and provider-failure behavior.
- Validate accessibility and mobile microphone permissions.
- Deploy.
- Run the complete demo flow on iPhone and Android.
- Record the demo and write the challenge submission.

# Required validation cases

- Recording stops automatically at 60 seconds.
- A short answer can qualify when every guardrail passes.
- An irrelevant answer does not unlock asking.
- Silence does not unlock asking.
- Unintelligible recording does not unlock asking.
- Guardrail failure does not unlock asking.
- Passing answer unlocks exactly one question.
- A second question cannot be submitted without another qualifying answer.
- Transient failures retry only the failed checks; exhaustion discards the attempt and offers a fresh recording.
- Definitive rejection cancels further retries and cannot be overridden by a late result.
- Closing or refreshing a failed submission does not create history or a recovery path.
- Non-English speech produces valid display text.
- Identifying information is removed from public text.
- Crisis content is Withheld with fixed resources and a fresh-recording action.
- Illegal or dangerous content is withheld with distinct text on the shared result page.
- Participant cannot answer their own question.
- Participant does not receive the same question twice after answering it.
- Multiple answers appear without ranking.
- Unanswered questions remain open.
- A question closes for routing after three qualifying answers from three distinct participants.
- Original audio is not publicly reachable.
- Generated playback does not block text publication.
- Skipping a question never grants or advances toward an ask.
- Rate limiting covers a complete Answer then Ask cycle without blocking normal use.

# Open decisions

- Ashley-authored seed content and recording provenance (TBD).
- Exact Gemini TTS voice.
- MVP display and translation language policy.
- Whether accounts are required after the weekend prototype.
- Final visual theme beyond the name and origin story.

# Rejected directions

- Real-money “pay it forward” round-up and wallet system.
- Geographic restriction to Appalachia.
- Generated Appalachian dialect.
- Busy Bees as the product theme.
- Two ElevenLabs agents for asking and answering.
- ElevenLabs in any form, including as a middleman for Gemini or a playback provider.
- Pretending a single-turn recorder is an agent.
- Immediate Ask unlock before contribution validation.
- Letting the asker decide whether an answer counted.
- A minimum-duration floor on answers.
- Replacing the aggregate guardrail gate with relevance alone.

# Do not reinterpret

- The participant must wait for validation before asking.
- “Useful” is the system gate result, not recipient approval.
- Safety is required internally but omitted from routine product marketing.
- Multiple responses are required.
- No review screen is required.
- The participant must be able to see their processed answers and received responses.
- Appalachia is the source story, not a user restriction or generated performance.
- Answers have a 60-second ceiling and no minimum duration.
- A qualifying answer must pass the aggregate content, relevance, crisis, and illegal-content guardrails.
- Unanswered questions never expire; three qualifying answers from distinct participants close further routing.
- Guardrail failures use one result page with outcome-specific text, not separate pages.
