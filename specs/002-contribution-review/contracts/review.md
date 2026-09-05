# Contract: The Review Module

**Feature**: 002-contribution-review · **Date**: 2026-09-05

The surface 003 and 004 consume, the four checks behind it, and the gate that combines them.
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
programmer error — `kind: 'answer'` with a null `questionText`, or empty audio that
should have been rejected by FR-050 before this call.

**It does not publish, grant, or consume anything.** It returns a decision. 003 and 004 act on it.

---

## Order of operations

1. **Rate limit** (FR-048). Checked first, before any provider call — a limited submission must
   cost nothing. Returns `rate_limited` with `retryAt` and stops. Because it returns before any
   check starts, nothing is left in flight and no contribution can be stranded (FR-052).
2. **Cheap audio validation** (FR-050). Empty or implausibly short buffers resolve to
   `withheld / content` without spending a call.
3. **Fan out** the applicable checks in parallel on the original audio — four for an answer
   (FR-002), three for a question (FR-003). Every submitted recording reaches this point or an
   earlier terminal state; none is published unreviewed (FR-001).
4. **Aggregate** as each result lands, aborting early on the first refusal.
5. **Release** the audio buffer on every exit path.

Steps 1 and 2 exist to make abuse and accidents cheap. Everything that reaches step 3 costs money.

---

## The four checks

Every check receives the **original audio** and nothing derived from another check (FR-004,
FR-005). Every one runs as its own call (FR-008a), dispatched simultaneously
([research D14](../research.md)). Safety thresholds differ by call — see below.

`canPublish` is uniform: `true` is YES, `false` is NO, for every check including crisis and
illegal (Principle III).

### Safety configuration — not uniform across calls

The two kinds of call fail in opposite directions, so they are configured differently
([research D3](../research.md)).

**Content processing — never block:**

```ts
safetySettings: [
  HARM_CATEGORY_HARASSMENT,
  HARM_CATEGORY_HATE_SPEECH,
  HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HARM_CATEGORY_DANGEROUS_CONTENT,
].map(category => ({ category, threshold: HarmBlockThreshold.BLOCK_NONE }))
```

Its output reproduces the recording as text, so it is the call the filter actually trips — the
spike saw it return an empty candidate on two fixtures even at `BLOCK_NONE`. A block returns no
reason and no ratings, and retry cannot recover it, so a false positive would make a lawful
recording permanently unpublishable.

**Crisis, illegal-or-dangerous, relevance — pass no `safetySettings` at all.** The provider's
defaults stay in force. Each emits one bit, and a block can only ever remove a permit, never grant
one — publication needs unanimous permits (FR-019). The filter is therefore a free conservative
backstop against this system's own check false-negativing (FR-008b).

**Neither configuration produces safety ratings.** No code may read `candidate.safetyRatings`; the
field does not exist on this path at any threshold ([research D3](../research.md)).

All four calls set `temperature: 0` and a `responseSchema`.

### 1. Content processing — `gemini-3.8-flash`

Carries FR-009 through FR-013 in one call: transcribe (FR-009), detect the source language
(FR-010), translate to the display language (FR-011), remove identifying details (FR-012), and
return readable display text (FR-013).

Response schema: `{ canPublish: boolean, displayText: string, sourceLanguage: string, emotion: string | null }`

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
that can be published without exposing someone's identity — never relevance or legality.</output>
```

`canPublish: false` here means silent, unintelligible, spam, nonsense, harassing, or
un-redactable (FR-016, US2 scenario 4). It does **not** mean off-topic or unlawful.

**Redaction is the only failure in this product that cannot be retried** — a missed name is
published. This is why the call stays on Flash and not Flash-Lite, and why any downgrade needs
evidence rather than a latency argument (constitution, Application Stack).

### 2. Crisis — `gemini-3.5-flash-lite`

Runs for answers **and** questions (FR-030). A crisis contribution publishes nowhere and appears
in no other participant's view (FR-031) — which follows from nothing being persisted at all.

Response schema: `{ canPublish: boolean }`. `false` means crisis detected.

```text
<role>You decide one thing about a spoken recording: is this person in trouble right now?</role>

<how_you_work>
- Return canPublish false when the speaker signals they may harm themselves, want to stop
  living, are giving up on living, or are in immediate personal danger.
- Indirect and understated phrasing counts. People in crisis rarely say it plainly.
- Weigh the speaker's own present state, in their own words, about themselves.
</how_you_work>

<never>
- Do NOT require an explicit statement of method, plan, or the word suicide. Waiting for those
  misses the people this check exists for.
- Do NOT return false for grief, sadness, burnout, or frustration about an external situation.
- Do NOT return false for figures of speech such as "that job was killing me".
- Do NOT judge whether the content is offensive, illegal, or off-topic. That is another call's job.
</never>

<examples>
- "I lost my mother and some weeks I can't get out from under it" -> true. Grief, not crisis.
- "That job was killing me so I quit" -> true. Figure of speech.
- "Everyone would have an easier time if I wasn't around anymore" -> false. Crisis.
- "How do you know when it's time to stop trying? I don't think I want to keep doing this."
  -> false. Giving up on continuing; understated crisis.
</examples>

<output>JSON: canPublish true when NOT in crisis, false when in crisis.</output>
```

The `<never>` block is FR-008f and is load-bearing: without it this exact prompt passed the
fourth example as safe, and raising the model tier did not fix it
([research D4](../research.md)).

⚠️ The fourth example is the case that failed. The prompt is fitted to it and no longer tested by
it — see [quickstart.md](../quickstart.md).

### 3. Illegal or dangerous — `gemini-3.5-flash-lite`

Response schema: `{ canPublish: boolean }`. `false` means unsafe or unlawful to publish.

This call exists because the spike proved there is no rating to read and that the provider's own
default guardrails passed 7 of 8 must-not-publish recordings (FR-008c).

```text
<role>You decide one thing about a spoken recording: would publishing this to strangers be
unsafe or unlawful?</role>

<how_you_work>
- Return canPublish false when the speaker instructs someone how to commit a crime, evade law
  enforcement, obtain a weapon unlawfully, manufacture drugs or weapons, or injure a person, or
  when the recording attacks or degrades a person or group.
- Judge the instruction actually given, not the topic it sits near.
</how_you_work>

<never>
- Do NOT return false for a lawful activity merely because it involves weapons, alcohol, money,
  or risk. Hunting, target shooting, home repair, and lawful firearm ownership are not offenses.
- Do NOT return false for describing a crime that was survived, witnessed, or regretted rather
  than recommended.
- Do NOT judge relevance or the speaker's own wellbeing. Those are other calls' jobs.
</never>

<examples>
- "Take a hunter safety course and get your license before the season" -> true. Lawful.
- "Buy from a private seller in a state with no background check so no permit is recorded"
  -> false. Instructs unlawful acquisition.
</examples>

<output>JSON: canPublish true when safe and lawful to publish, false when not.</output>
```

The two examples are the compositional pair the spec names. Same topic, opposite verdicts — a
check that cannot separate them is not measuring legality.

### 4. Relevance — `gemini-3.5-flash-lite`, answers only

Response schema: `{ canPublish: boolean }`. Receives the question text alongside the audio
(FR-006). Not run for questions (FR-003).

```text
<role>You decide one thing: does this spoken answer respond to the question it was given?</role>

<how_you_work>
- Return canPublish true when the answer engages the question, even briefly, partially, or badly.
- A short answer can be a good answer. Length is not relevance.
- An answer can be relevant and still be terrible advice. You are not judging quality.
</how_you_work>

<never>
- Do NOT return false because the advice is wrong, dangerous, illegal, offensive, or upsetting.
  Another call rejects those. If you also reject them, the system loses the ability to tell an
  off-topic answer from an unsafe one.
- Do NOT return false because the answer is brief or informal.
</never>

<examples>
- Q "How do I keep sourdough starter alive?" A "Feed it, same time every day." -> true.
- Q "How do I keep sourdough starter alive?" A "Here is how to change your oil." -> false.
- Q "How do I get started deer hunting?" A "Buy a gun illegally so nothing is recorded."
  -> true. On topic, and unlawful. Relevance is still true; the other call rejects it.
</examples>

<output>JSON: canPublish true when relevant, false when not.</output>
```

The third example is FR-008g. Without it, relevance rejected on-topic answers for being unlawful,
which selects the wrong Withheld copy ([research D5](../research.md)).

---

## Faults, retries, and the deadline

Per check: **at most 3 invocations** including the first, **20-second timeout** each, waits of
**1 s then 2 s**. The whole submission stops at **90 s** from receipt (FR-039).

A `fault` is any of:

| Condition | Why it is a fault, not a refusal |
| - | - |
| Network error or non-2xx | provider outage is not a participant rejection (FR-038) |
| Timeout at 20 s | same |
| Response with **no candidate** | measured as inconsistent for identical audio; a gate that flips on provider weather is not a gate ([research D3](../research.md)) |
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
                    ┌─────────────────────────────┐
  original audio ──►│ content   crisis   illegal   │  (+ relevance for answers)
                    └──────────────┬──────────────┘
                                   ▼
                      any validated canPublish=false
                         ──► abort the rest, Withheld
                      all applicable permit
                         ──► publish
                      faults exhausted / 90s
                         ──► processing failure
```

Rules, in force order:

1. **Fail fast.** The first validated `refuse` resolves Withheld immediately, aborts the shared
   `AbortController`, and stops further retries. Later results cannot publish anything and cannot
   change the resolved outcome (FR-007, FR-022).
2. **Unanimity to publish.** Every *applicable* check must return `permit`. Three for a question,
   four for an answer. A missing result is not a permit (FR-019).
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
| Merge two checks into one call | FR-008a, Principle III |
