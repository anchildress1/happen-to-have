# Contract: The Review Module

**Feature**: 002-contribution-review · **Date**: 2026-09-05

The surface 003 and 004 consume, the two calls behind it, and the gate that combines them.
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
`{ status: 'failed', cause: 'exhausted' }`; it does not reject the promise. It throws only for
programmer error, which means exactly one case: `kind: 'answer'` with a null `questionText`.

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

**Allowlist**: `audio/mp4`, `audio/webm`, `audio/m4a`, `audio/aac`, `audio/ogg`, `audio/wav`.
Anything else is rejected before any call.

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

So a 60-second answer costs roughly **2,070 input tokens per call, ~8,300 across the four-call
fan-out**, before retries. Compression choices do not change the bill; duration does. This is the
basis for the cost budget in [quickstart.md](../quickstart.md).

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
3. **Fan out** two calls in parallel on the original audio — content processing and the judgment
   call — for answers and questions alike (FR-002, FR-003). Every submitted recording reaches
   this point or an earlier terminal state; none is published unreviewed (FR-001).
4. **Aggregate** as each result lands, aborting early on the first refusal.
5. **Release** the audio buffer on every exit path.

Steps 1 and 2 exist to make abuse and accidents cheap. Everything that reaches step 3 costs money.

---

## The two calls

Both receive the **original audio** and nothing derived from the other (FR-004, FR-005). Both are
dispatched simultaneously ([research D13](../research.md)). Safety thresholds differ by call —
see below.

The split is on the provider's fault line, not a taxonomy: content processing reproduces the
recording as text and is the call the filter trips; the judgment call emits booleans and has
never been observed blocking. Merging them means one block destroys every verdict
([research D2](../research.md)).

### Safety configuration — identical on both calls

```ts
safetySettings: [
  HARM_CATEGORY_HARASSMENT,
  HARM_CATEGORY_HATE_SPEECH,
  HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HARM_CATEGORY_DANGEROUS_CONTENT,
].map(category => ({ category, threshold: HarmBlockThreshold.BLOCK_NONE }))
```

Set **explicitly on both calls**, not omitted. The provider documents these four adjustable
filters as off by default for the models in use, so this changes nothing today — it stops the
gate moving if that default ever changes ([research D3](../research.md)).

**This does not stop every block.** The provider's non-adjustable protections against core harms
stay active at every setting this system can send, and empty candidates were observed on two
fixtures *at* `BLOCK_NONE`. That is not something to configure away; it is handled as a fault
(FR-008b1) and is the reason the two calls are split at all ([research D2](../research.md)).

**No safety ratings are produced at any configuration.** No code may read
`candidate.safetyRatings`; the field does not exist on this path.

Both calls set `temperature: 0` and a `responseSchema`.

### 1. Content processing — `gemini-3.8-flash`

Carries FR-009 through FR-013 in one call: transcribe (FR-009), detect the source language
(FR-010), translate to the display language (FR-011), remove identifying details (FR-012), and
return readable display text (FR-013).

Response schema:
`{ canPublish: boolean, displayText: string, sourceLanguage: string, emotion: string | null, contentReason: 'silence' | 'unintelligible' | 'unpublishable' | null }`

`contentReason` is returned whenever `canPublish` is false, and is what selects among the three
content headings in [copy.md](copy.md). No other check can supply it.

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

### 2. Judgment — `gemini-3.5-flash-lite`

One call, three verdicts, plus the failing signal and an audio-quality report. Receives the
question text alongside the audio for an answer (FR-006); for a question, relevance is returned
as `null` rather than the system making another call (FR-003). Same safety configuration as
content processing — see above.

Response schema:

```ts
{
  crisisCanPublish: boolean,
  illegalCanPublish: boolean,
  relevanceCanPublish: boolean | null,
  audioQuality: 'clear' | 'unintelligible' | 'silent',
  primaryReason: 'none' | 'crisis' | 'illegal' | 'relevance',
  reasonDetail: string,
}
```

System instruction — every negative constraint from the previously separate prompts is retained,
because each one is load-bearing and was measured that way:

```text
<role>You judge one spoken recording on three independent questions, and report the audio
quality. You never transcribe it and never repeat its content.</role>

<crisis>
- crisisCanPublish is false when the speaker signals they may harm themselves, want to stop
  living, are giving up on living, or are in immediate personal danger.
- Indirect and understated phrasing counts. People in crisis rarely say it plainly.
- Do NOT require an explicit method, plan, or the word suicide.
- Do NOT return false for grief, burnout, or figures of speech such as "that job was killing me".
Examples: "I lost my mother and can't get out from under it" -> true.
"Everyone would have an easier time if I wasn't around anymore" -> false.
"How do you know when it's time to stop trying? I don't think I want to keep doing this." -> false.
</crisis>

<illegal>
- illegalCanPublish is false when the speaker instructs someone how to commit a crime, evade law
  enforcement, obtain a weapon unlawfully, manufacture drugs or weapons, or injure a person, or
  when the recording attacks or degrades a person or group.
- Judge the instruction actually given, not the topic it sits near.
- Do NOT return false for lawful activity involving weapons, alcohol, money, or risk.
Examples: "Take a hunter safety course and get your license" -> true.
"Buy from a private seller where no background check is required" -> false.
</illegal>

<relevance>
- Only for an answer; return null for a question.
- relevanceCanPublish is true when the answer engages the question, even briefly or badly.
- Do NOT return false because the advice is dangerous, illegal, or offensive. That is the
  illegal judgment's job, and confusing the two makes off-topic indistinguishable from unsafe.
Example: Q "How do I start deer hunting?" A "Buy a gun illegally." -> true. On topic, unlawful.
</relevance>

<audio_quality>
- "clear" when speech is audible and intelligible.
- "unintelligible" when there is sound but the words cannot be made out.
- "silent" when there is no discernible speech at all.
</audio_quality>

<reason>
- primaryReason names the single most serious failing judgment, in the order crisis, illegal,
  relevance; "none" when all pass.
- reasonDetail is one short clause for operators, never shown to anyone. Do NOT quote the
  recording and do NOT include identifying details.
</reason>

<output>JSON matching the schema.</output>
```

The `<never>` lines are not decoration. The crisis block's fourth example is the case that
defeated an earlier wording and that a higher model tier did **not** fix
([research D4](../research.md)). The relevance block's third example is FR-008g: without it,
relevance rejected on-topic answers for being unlawful, which selects the wrong Withheld copy.

**Measured**: 15/16 on the three verdicts, **16/16 on `primaryReason`**, zero blocked responses,
1148 ms median — including on the two recordings that block content processing every time. The one miss was a relevance false-negative on a recording the illegal judgment
already refused, so the outcome and the copy were both still correct.

⚠️ `audioQuality` returned `clear` on all 16 fixtures because all 16 are clear recordings. Its
`silent` and `unintelligible` values are **unexercised** and must not be trusted until junk
fixtures exist — see [quickstart.md](../quickstart.md).

**`reasonDetail` MUST NOT be rendered.** FR-027 fixes every participant-facing string. It is a log
field.

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
                    ┌──────────────────┐   ┌────────────────────────────────┐
  original audio ──►│ content          │   │ judgment                       │
                    │ Flash            │   │ Flash-Lite                     │
                    │ BLOCK_NONE       │   │ defaults                       │
                    │ text + publishable│  │ crisis · illegal · relevance   │
                    └────────┬─────────┘   │ + primaryReason + audioQuality │
                             │             └───────────────┬────────────────┘
                             └──────────┬──────────────────┘
                                        ▼
                       any validated canPublish=false
                          ──► abort the other, Withheld (reason = primaryReason)
                       both permit, all applicable verdicts true
                          ──► publish
                       faults exhausted / 90s
                          ──► processing failure
```

Rules, in force order:

1. **Fail fast.** The first validated `refuse` resolves Withheld immediately, aborts the shared
   `AbortController`, and stops further retries. Later results cannot publish anything and cannot
   change the resolved outcome (FR-007, FR-022).
2. **Unanimity to publish.** Content processing must permit, and every applicable verdict in the
   judgment call must be true. A missing result is not a permit (FR-019) — a lost transcript can
   never publish, whatever the judgment call returned.
2a. **The reason comes from the judge.** When the judgment call refuses, `withheld.reason` is its
   `primaryReason` field, not a value reconstructed from which boolean flipped (FR-008e).
2b. **A lost transcript may still pick copy.** If content processing exhausts on empty candidates
   while the judgment call returned, its `audioQuality` selects among the content Withheld
   variants (FR-008h). This changes the message, never the decision.
3. **Precedence is for copy only.** Among refusals *already known* at resolution, order is
   **crisis → illegal → relevance → content**. The gate never waits for an unfinished check to
   discover a better reason (FR-022, edge case *Multiple known rejections*).
4. **Abort is best-effort.** Cancellation reduces cost; it is not required for correctness. A
   late result that arrives anyway is ignored.
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
| Merge content processing into the judgment call | FR-008a, Principle III — it is the call the provider blocks |
| Render `reasonDetail`, or any model-generated text, to a participant | FR-027, Principle VII |
