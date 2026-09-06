# Contract: The Review Module

**Feature**: 002-contribution-review · **Date**: 2026-09-05

The surface 003 and 004 consume, the four calls behind it, and the gate that combines them.
Shapes are defined in [data-model.md](../data-model.md); this document defines behaviour.

---

## Public surface

`src/review/index.ts` exports exactly one function. Everything else in `src/review/` is internal.

```ts
export async function reviewContribution(
  input: ReviewInput,
  deps?: ReviewDeps,
): Promise<ReviewOutcome>;

export interface ReviewInput {
  kind: 'answer' | 'question';
  audio: Uint8Array;
  mimeType: string;
  /** The question being answered. Required when kind is 'answer', null otherwise (FR-006). */
  questionText: string | null;
  participantId: string;
  /** The caller's request signal. Aborting it cancels every in-flight check (FR-045). */
  signal: AbortSignal;
}

/** Injection seam for tests — research D12. Production callers pass nothing. */
export interface ReviewDeps {
  genai?: GenAiClient;
  rateLimit?: RateLimitClient;
  now?: () => number;
}
```

`reviewContribution` **never throws for a review outcome**. A provider outage returns
`{ status: 'failed', cause: 'exhausted' }`; it does not reject the promise.

It rejects in exactly two cases, and neither is a review outcome:

| Rejection | When |
| - | - |
| `TypeError` | programmer error — `kind: 'answer'` with a null `questionText` |
| `DOMException` named `AbortError` | the caller's `signal` fired (FR-045) |

**Abandonment is a rejection, not a variant of `ReviewOutcome`.** The signal fires because the
participant's request is gone, so there is nobody left to render a decision for; a
`{ status: 'abandoned' }` variant would oblige every caller to handle a case in which no response
can be written. Rejecting with `AbortError` is the platform's own convention for this, so a
caller that already awaits inside a request handler needs no special path — but the audio is
still released before the rejection propagates, and no row is written.

**Invalid audio is not a programmer error.** Empty, undersized, oversized, and wrong-type
recordings are participant-facing outcomes and resolve `withheld / content` inside this function
(FR-050), per the audio input contract below. Throwing for them would bypass the Withheld page the
participant is owed.

**It does not publish, grant, or consume anything.** It returns a decision. 003 and 004 act on it.

---

## Audio input contract

FR-050 requires rejecting invalid audio before spending provider work. This is what *valid*
means. All figures measured 2026-09-05 unless marked.

### Accepted formats

The browser chooses the container, and the two target browsers choose differently:

| Browser | `MediaRecorder` default | Send as |
| - | - | - |
| Mobile Safari (≤18.3) | MP4 / AAC — WebM is unavailable | `audio/mp4` |
| Mobile Safari (18.4+) | still MP4 / AAC by default | `audio/mp4` |
| Android Chrome, desktop Chrome/Firefox | WebM / Opus | `audio/webm` |

**Allowlist**, matched against the **base type only**: `audio/mp4`, `audio/webm`, `audio/m4a`,
`audio/aac`, `audio/ogg`, `audio/wav`. Anything else is rejected before any call.

Base type means everything before the first `;`, lowercased and trimmed. `MediaRecorder` reports
the type it was constructed with, and a client that picks its format with
`isTypeSupported('audio/webm;codecs=opus')` — which is the documented way to pick one — then
reports exactly that string. An exact-match allowlist would reject those recordings before any
provider call and render *We couldn't make out the recording* for audio nothing had listened to.
The original value is forwarded to the provider unchanged; only the comparison is normalized.

`audio/mp4` is **not** in the provider's published supported-formats list, which names `m4a` and
`aac` but not `mp4`. It was tested directly and accepted, so no container remapping is needed —
the recorder's own mime type is forwarded verbatim. Retest if Safari output ever starts failing;
`audio/m4a` was also verified as a working fallback for the identical bytes.

The client MUST pick its format with `MediaRecorder.isTypeSupported()` rather than assuming, and
send the type it actually recorded. 003 owns the recorder; this contract owns what the server
accepts.

### Size and duration

| Bound | Value | Source |
| - | - | - |
| Inline request ceiling | 20 MB | provider documentation |
| Measured 60 s recording | 250–530 KB | Opus 32 kbps to AAC 64 kbps, measured |
| **Reject above** | **5 MB** | ~10x the worst measured case; anything larger is not a 60-second voice recording |
| **Reject below** | **1 KB** | smaller than any container's own headers, so it cannot contain speech |
| Duration ceiling | 60 s, enforced by 003's recorder | FR-039 |

The server MUST NOT trust a client-declared duration. It bounds by **bytes**, which it can
verify, and leaves the 60-second ceiling to the recorder that produced the file. A recording that
slips slightly past 60 s is not a failure worth a rejection; one that arrives at 4 MB is.

The 5 MB bound sits far below the 20 MB inline ceiling on purpose: it is an abuse and accident
bound, not a provider limit.

### Token cost, which is what size actually buys

The provider bills **32 tokens per second of audio**, independent of encoding — a 60-second
recording is ~1,920 audio tokens regardless of whether it arrives as 250 KB of Opus or 530 KB of
AAC. Measured: a 15-second clip produced 457 prompt tokens including the system instruction.

So a 60-second contribution costs roughly **2,100–2,300 input tokens per call, ~8,800 across the
four-call fan-out** for an answer and ~6,600 for a question, before retries. Compression choices
do not change the bill; duration does. Two of those calls sit on the content tier, which is where
most of the cost lands. This is the basis for the cost budget in
[quickstart.md](../quickstart.md).

### What rejection looks like

An oversized, undersized, or wrong-type submission resolves `withheld / content` and renders the
`We couldn't hear anything` or `We couldn't make out the recording` variant. It never reaches a
provider call, and it never renders processing failure — the participant's recording really was
unusable, which is a content outcome, not an outage.

---

## Order of operations

1. **Rate limit** (FR-048). Checked first, before any provider call — a limited submission must
   cost nothing. Returns `rate_limited` with `retryAt` and stops. Because it returns before any
   check starts, nothing is left in flight and no contribution can be stranded (FR-052).
2. **Cheap audio validation** (FR-050). Empty or implausibly short buffers resolve to
   `withheld / content` without spending a call.
3. **Fan out** one call per signal in parallel on the original audio — content processing,
   crisis, illegal-or-dangerous, and, for an answer only, relevance (FR-002, FR-003). Four calls
   for an answer, three for a question. Every submitted recording reaches this point or an
   earlier terminal state; none is published unreviewed (FR-001).
4. **Aggregate** as each result lands, aborting early on the first refusal.
5. **Release** the audio buffer on every exit path.

Steps 1 and 2 exist to make abuse and accidents cheap. Everything that reaches step 3 costs money.

---

## The four calls

| Call | Model | Answers | Runs for |
| - | - | - | - |
| Content processing | `gemini-3.8-flash` | transcribe, translate, redact | both kinds |
| Crisis | `gemini-3.8-flash` | is this person in trouble right now | both kinds |
| Illegal or dangerous | `gemini-3.5-flash-lite` | is this unlawful or dangerous to publish | both kinds |
| Relevance | `gemini-3.5-flash-lite` | does this answer engage the question | answers only |

Each receives the **original audio** and nothing derived from any other (FR-004, FR-005). All are
dispatched simultaneously ([research D13](../research.md)).

**One signal per call is measured, not stylistic.** On twenty understated-crisis recordings the
prompt had never seen, the same model with the same wording caught 3 of 10 sharing a call and
10 of 10 alone on the content tier ([research D2](../research.md)). A call holding several jobs
stops doing the subtle one.

Content processing is separated for a second, independent reason: it reproduces the recording as
text and is the call the provider's filter trips, while the judgment calls emit booleans and have
never been observed blocking. Merged, one block would destroy every verdict.

### Safety configuration — identical on every call

```ts
safetySettings: [
  HARM_CATEGORY_HARASSMENT,
  HARM_CATEGORY_HATE_SPEECH,
  HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HARM_CATEGORY_DANGEROUS_CONTENT,
].map(category => ({ category, threshold: HarmBlockThreshold.BLOCK_NONE }))
```

Set **explicitly on every call**, not omitted. The provider documents these four adjustable
filters as off by default for the models in use, so this changes nothing today — it stops the
gate moving if that default ever changes ([research D3](../research.md)).

**This does not stop every block.** The provider's non-adjustable protections against core harms
stay active at every setting this system can send, and empty candidates were observed on two
fixtures *at* `BLOCK_NONE`. That is not something to configure away; it is handled as a fault
(FR-008b1) and is why content processing is separated from the judgments at all
([research D2](../research.md)).

**No safety ratings are produced at any configuration.** No code may read
`candidate.safetyRatings`; the field does not exist on this path.

Every call sets `temperature: 0` and a `responseSchema`.

### 1. Content processing — `gemini-3.8-flash`

Carries FR-009 through FR-013 in one call: transcribe (FR-009), detect the source language
(FR-010), translate to the display language (FR-011), remove identifying details (FR-012), and
return readable display text (FR-013).

Response schema:
`{ canPublish: boolean, displayText: string, sourceLanguage: string, emotion: string | null, contentReason: 'silence' | 'unintelligible' | 'unpublishable' | null }`

`contentReason` is returned whenever `canPublish` is false, and is what selects among the three
content headings in [copy.md](copy.md). No other call can supply it, and none tries: a refusal
that arrives without one fails validation and is retried as a fault (FR-008h). There is no
cross-call audio-quality fallback — the earlier one existed only because a merged judgment call
happened to be listening, and schema validation made it unreachable in any case.

System instruction, in the structure Flash prefers — role, work, negatives, output:

```text
<role>You process a spoken contribution into publishable text. You transcribe, translate,
and redact. You do not advise.</role>

<how_you_work>
- Transcribe exactly what was said.
- Translate into English if it was spoken in another language.
- Remove or generalize names, employers, street addresses, phone numbers, and other
  identifying details.
- Record the source language, and a broad emotional direction only when one is reliably
  detectable.
</how_you_work>

<never>
- Do NOT add advice, facts, recommendations, or moral judgment that were not in the recording.
- Do NOT alter the substance of what the speaker said.
- Do NOT refuse and do NOT return an empty transcript. Transcribing is not endorsing; another
  call decides whether this may be published.
- Do NOT invent an emotional direction. Return null when none is reliable.
</never>

<output>JSON matching the schema. canPublish reports only whether this was intelligible speech
that can be published without exposing someone's identity — never relevance or legality.
When canPublish is false, set contentReason: "silence" for no discernible speech,
"unintelligible" for speech that could not be made out, "unpublishable" for spam, nonsense,
harassment, or identifying detail that could not be removed. Otherwise set it to null.</output>
```

`canPublish: false` here means silent, unintelligible, spam, nonsense, harassing, or
un-redactable (FR-016, US2 scenario 4). It does **not** mean off-topic or unlawful.

**Redaction is the only failure in this product that cannot be retried** — a missed name is
published. This is why the call stays on Flash and not Flash-Lite, and why any downgrade needs
evidence rather than a latency argument (constitution, Application Stack).

### 2. Crisis — `gemini-3.8-flash`

One question, no other job in the call: **is this person in trouble right now.** It never
transcribes and never repeats the recording's content. It runs for answers and questions alike.

Response schema — stated in positive polarity, because that is the wording that was measured:

```ts
{ inTrouble: boolean, signal: string }
```

The gate consumes `crisisCanPublish = !inTrouble`. The inversion lives in code, not in the
prompt: flipping the question's polarity in the prompt was tested and scored slightly worse
([research D4](../research.md)).

System instruction — verbatim, as measured at 10/10 with zero false positives:

```text
<role>You listen to one recording and answer a single question: is this person in
trouble right now? Nothing else about the recording concerns you.</role>

<what_counts>
Almost nobody in crisis says so plainly. Judge the signal, not the vocabulary. Answer yes when
the recording carries any of these, however calm, practical or reasonable it sounds:
- PUTTING AFFAIRS IN ORDER: giving belongings away, deciding who gets what, arranging for
  someone else to take a pet or a responsibility.
- A FORESHORTENED FUTURE: plans, purchases or worries that stop at a near horizon, or a problem
  dismissed because it will not be theirs for much longer.
- BURDEN: their absence described as easier or better for the people around them, including
  when framed as logic, arithmetic or plain fact.
- WITHDRAWAL: losing the reason to answer or reach the people who matter to them.
- MEANS OR ESCAPE HELD IN RESERVE: comfort or relief in knowing there is a way out available.
- EXHAUSTION AT CONTINUING ITSELF, as distinct from exhaustion at a job, a workload or a
  situation.
A flat, matter-of-fact delivery is common in crisis. It is not evidence against it.
</what_counts>

<what_does_not_count>
- Grief, burnout, frustration, money worry, or exhaustion at a situation.
- Figures of speech such as "that job was killing me".
- Giving up on a project, a job, a friendship or a habit. Ending a thing is not ending oneself.
</what_does_not_count>

<how_to_weigh>
You are not diagnosing and you are not deciding what happens next. A person reads the outcome
either way. Say yes when the signal is there, even if you are unsure; an unnecessary offer of
help costs someone a moment, and a missed one costs more than this system can repair.
</how_to_weigh>

<output>JSON: inTrouble true when this person may be in trouble, false when not. signal names
which of the categories above applied, or "none".</output>
```

**Every clause here is load-bearing and each earned its place against a measured miss.** The
named categories replaced an abstract instruction that understated phrasing counts, which scored
2 of 10. `<what_does_not_count>` is what holds false positives at zero across ten near-miss
controls — grief, burnout, a layoff, money worry, abandoning a novel, ending a friendship.
`<how_to_weigh>` sets the asymmetry deliberately: this check is allowed to be wrong in one
direction ([research D4](../research.md)).

**Measured**: 10/10 crisis, 0/10 false positives, on twenty recordings the prompt had never seen.
On `gemini-3.5-flash-lite` the identical prompt scores 8/10, which is why FR-008a1 pins the tier.

`signal` is a log field. It MUST NOT be rendered (FR-027).

⚠️ The wording was developed against those twenty recordings, so they are now a regression set
rather than a generalization test. A third unseen set is the honest pre-launch check.

### 3. Illegal or dangerous — `gemini-3.5-flash-lite`

One question. Runs for answers and questions alike. Never transcribes.

Response schema:

```ts
{ canPublish: boolean, detail: string }
```

```text
<role>You judge one spoken recording on a single question: may it be published, or is it
unlawful or dangerous? You never transcribe it and never repeat its content.</role>

<what_counts>
- canPublish is false when the speaker instructs someone how to commit a crime, evade law
  enforcement, obtain a weapon unlawfully, manufacture drugs or weapons, or injure a person, or
  when the recording attacks or degrades a person or group.
- Judge the instruction actually given, not the topic it sits near.
</what_counts>

<never>
- Do NOT return false for lawful activity involving weapons, alcohol, money, or risk.
- Do NOT return false because the recording is off-topic, sad, or badly argued. Those are other
  calls' questions.
</never>

<examples>
- "Take a hunter safety course and get your license" -> true.
- "Buy from a private seller where no background check is required" -> false.
</examples>

<output>JSON matching the schema. detail is one short clause for operators, never shown to
anyone. Do NOT quote the recording and do NOT include identifying details.</output>
```

The compositional case is the one that matters: each sentence lawful, the sequence not. Judging
the instruction rather than the topic is what catches it.

**Measured**: 6/6 on the illegal fixtures, zero blocked responses, in both the merged and
dedicated shapes. Unlike crisis, no degradation was observed from merging — the split here
follows FR-008a's rule rather than its own evidence.

### 4. Relevance — `gemini-3.5-flash-lite`, answers only

Receives the question text alongside the audio (FR-006). **Not dispatched at all for a
question** (FR-003) — there is no `null` verdict to return, because there is no call.

Response schema:

```ts
{ canPublish: boolean, detail: string }
```

```text
<role>You judge one spoken answer on a single question: does it engage the question it was
given? You never transcribe it and never repeat its content.</role>

<what_counts>
- canPublish is true when the answer engages the question, even briefly, badly, or wrongly.
- canPublish is false only when the answer is about something else.
</what_counts>

<never>
- Do NOT return false because the advice is dangerous, illegal, or offensive. Another call
  decides that, and confusing the two makes off-topic indistinguishable from unsafe.
</never>

<examples>
- Q "How do I start deer hunting?" A "Buy a gun illegally." -> true. On topic, unlawful.
</examples>

<output>JSON matching the schema. detail is one short clause for operators, never shown to
anyone. Do NOT quote the recording and do NOT include identifying details.</output>
```

That `<never>` clause is FR-008g. Without it, relevance rejected on-topic answers for being
unlawful, which selects the wrong Withheld copy — the participant is told they were off-topic
when they were not.

**`detail` MUST NOT be rendered**, on either judgment call. FR-027 fixes every participant-facing
string. It is a log field.

## Faults, retries, and the deadline

Per check: **at most 3 invocations** including the first, **20-second timeout** each, waits of
**1 s then 2 s**. The whole submission stops at **90 s** from receipt (FR-039).

A `fault` is any of:

| Condition | Why it is a fault, not a refusal |
| - | - |
| Network error or non-2xx | provider outage is not a participant rejection (FR-038) |
| Timeout at 20 s | same |
| Response with **no candidate** | the provider's non-adjustable core-harm protections stay active at every configurable setting, so this is permanent rather than tunable. It carries no reason, so reading a verdict from it manufactures one from silence ([research D3](../research.md)) |
| `response.text` undefined | observed twice in the spike |
| JSON parse failure | FR-036 |
| Zod validation failure | FR-037 — unvalidated output reaches neither storage nor interface |

Faults retry that check alone. **Checks that already returned `permit` are frozen** and never
rerun inside the active submission (FR-019) — rerunning spends money to re-ask a settled question
of a non-deterministic model.

Exhaustion or deadline expiry produces `{ status: 'failed' }`, never `withheld`. The participant
did nothing wrong and the copy must not imply otherwise (FR-040).

---

## The gate

```text
                    ┌────────────────────────┐
  original audio ──►│ content · Flash        │  text · canPublish · contentReason
                    ├────────────────────────┤
                ──► │ crisis · Flash         │  inTrouble · signal
                    ├────────────────────────┤
                ──► │ illegal · Flash-Lite   │  canPublish · detail
                    ├────────────────────────┤
                ──► │ relevance · Flash-Lite │  canPublish · detail   (answers only)
                    └───────────┬────────────┘
                                ▼
                   any validated refusal
                      ──► abort the rest, Withheld (reason = the refusing call)
                   every dispatched call permits
                      ──► publish
                   faults exhausted / 90s
                      ──► processing failure
```

Rules, in force order:

1. **Fail fast.** The first validated `refuse` resolves Withheld immediately, aborts the shared
   `AbortController`, and stops further retries. Later results cannot publish anything and cannot
   change the resolved outcome (FR-007, FR-022).
2. **Unanimity to publish.** Every dispatched call must permit. A missing result is not a permit
   (FR-019) — a lost transcript can never publish, whatever the judgments returned. Relevance is
   not dispatched for a question, so there is nothing to wait for and nothing to default.
2a. **The reason is the call that refused.** With one signal per call, `withheld.reason` is
   identified by which call returned a refusal — no field to read, nothing to reconstruct
   (FR-008e).
2b. **A lost transcript is a failure, not a Withheld.** If content processing exhausts while every
   judgment permitted, the outcome is `failed` (FR-040) — nothing refused, and the system does not
   know whether the recording was publishable. If a judgment *refused*, fail-fast already resolved
   Withheld on that refusal and content processing is irrelevant.
2c. **A content refusal without a `contentReason` is a fault, not a Withheld.** Validation rejects
   it and the call is retried under FR-037. No other call is consulted to fill the gap
   (FR-008h) — guessing the message from another call's opinion of the audio is how a participant
   gets told the wrong thing about their own recording.
3. **Precedence is for copy only.** Among refusals *already known* at resolution, order is
   **crisis → illegal → relevance → content**, computed by the gate from which calls refused. It
   never waits for an unfinished check to discover a better reason (FR-022, edge case *Multiple
   known rejections*).
4. **Abort bounds latency, not cost.** The SDK's `abortSignal` is client-side only — it stops
   this system waiting, it does not stop the provider working, and usage is billed either way.
   Cancellation is therefore not a cost control and not required for correctness. A late result
   that arrives anyway is ignored.
5. **Release the audio** on every exit — publish, withheld, failure, rate limit, abort.

### Why precedence is presentation-only

All four refusals produce the same decision: nothing publishes. Precedence picks which sentence
the participant reads. Treating it as decision logic would imply a crisis refusal is *more*
rejecting than a content refusal, which is not a distinction the gate makes — and would invite
waiting for a higher-precedence reason before rendering, which FR-022 forbids in as many words.

---

## What this module must never do

| Prohibition | Source |
| - | - |
| Write an unpublished contribution, attempt, or retry row | FR-023, Principle V |
| Persist or expose the original recording at any address | FR-043, Principle IV |
| Offer review or playback of an original recording | FR-047 |
| Present a translation for participant approval | FR-018 |
| Generate counseling text or claim intervention | FR-034, Principle VII |
| Grant or consume an ask | FR-042 — 003 grants, 004 consumes |
| Record a penalty, strike, or cooldown against a participant | FR-028 |
| Read `candidate.safetyRatings` | [research D3](../research.md) — the field does not exist |
| Put two signals in one call | FR-008a, Principle III — measured at 3/10 versus 10/10 on crisis |
| Run the crisis call on the cheap tier | FR-008a1 — 8/10 versus 10/10 |
| Render `signal`, `detail`, or any model-generated text, to a participant | FR-027, Principle VII |
