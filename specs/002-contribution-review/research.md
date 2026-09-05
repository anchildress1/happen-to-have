# Phase 0 Research: Contribution Review

**Feature**: 002-contribution-review · **Date**: 2026-09-05

Decisions are numbered `D1`–`D15` and referenced from [plan.md](plan.md) and
[contracts/review.md](contracts/review.md). 001's research keeps its own `D` numbering; the two
are not continuous.

Four of these were settled by measurement rather than reasoning. Those cite
[spike-002-guardrails](../../docs/spike-002-guardrails.md) and are not re-argued here.

---

## D1 — Original audio never touches object storage

**Decision**: the recording exists only as bytes in the active request. The browser posts it to a
route handler, which holds it in memory, sends it inline to each check, and drops it when the
request ends. No bucket, no signed URL, no object key.

**Rationale**: FR-043 requires that the recording not be reachable from outside the system *at any
address*. The cheapest way to guarantee an address does not leak is to never mint one. Every
deletion requirement in the spec — FR-044 on four terminal outcomes, FR-045 on abandonment,
FR-046's 60-second retry — exists to close a window that object storage opens. Removing the
storage removes the window and most of the code that guards it.

Sizes make this comfortable: a 60-second `audio/webm;codecs=opus` recording is well under 1 MB,
and the spike's 12–16 second WAVs ran inline at 0.7–1.5 MB each against a documented ~20 MB
request ceiling. Four parallel calls each carry their own copy of the same buffer, which is
memory, not transfer, and bounded by the 90-second deadline in FR-039.

**Alternatives considered**:

- *GCS with a lifecycle rule* — what FR-046 anticipates. Buys nothing here: the audio is needed
  for one request by one process. It costs a bucket, IAM, upload and delete round-trips inside the
  latency budget, and a permanent orphan-cleanup obligation. Principle VI rejects capability held
  for a need that has not arrived.
- *Gemini Files API* — upload once, reference from both calls. Saves resending ~1 MB once, and
  adds a remote object with a lifetime this system does not control, which is the exact thing
  FR-043 forbids. Less attractive now that the fan-out is two calls rather than four. Reconsider only if the 60-second measurement in D15 shows inline resend
  dominating latency.

**Consequence**: FR-046's lifecycle backstop has nothing to back up. Recorded as a deviation in
plan.md Complexity Tracking rather than silently skipped.

---

## D2 — Two calls, split on the provider's fault line

**Decision**: content processing on `gemini-3.8-flash`; one judgment call on
`gemini-3.5-flash-lite` carrying crisis, illegal-or-dangerous, relevance (answers only), an
audio-quality report, and the name of the failing signal. Two calls for an answer, two for a
question.

**Rationale**: measured, and it overturned the shape this plan started with.

A **single fully merged call** was tested first, since it sends the audio once and is the obvious
cost win. It scored 14/16 and actually *fixed* two defects the four separate prompts had — it
caught the understated-crisis case the separate crisis prompt missed, and showed no relevance
bleed. Classification was not the problem.

It failed on something else. The two recordings the provider blocks — `firearm-no-permit` and
`drug-synthesis` — returned zero candidates, and merged that destroys **every** judgment, not
just the transcript. Those recordings would render a processing failure inviting the participant
to re-record, instead of `That response can't be shared here`.

Under separate calls the same two recordings resolve correctly: content processing comes back
empty, the illegal judgment returns a clean refusal, and fail-fast renders Withheld. So the split
earns its keep — but only between **content processing and everything else**, because content
processing is the call that reproduces the recording as text and therefore the one the filter
trips.

A **merged judgment call** was then tested on Flash-Lite: 15/16 on the judgments, **16/16 on
naming the failing signal**, **zero blocks** including on those two recordings, 1148 ms median.

| Shape | Cost @60s | Latency | Survives a content block |
| - | - | - | - |
| Four separate calls | $0.00424 | 2398 ms | yes |
| One fully merged call | $0.00242 | 2646 ms | **no — loses every judgment** |
| **Content + judgment** | **$0.00328** | **~2400 ms** | **yes** |

Two calls costs 23% less than four with no latency change, because the fan-out is gated by
content processing either way — the judgment call finishes in half its time.

**What this replaces**: FR-008a previously required every check to take its own call, on the
grounds that "a prompt judging one thing classifies more reliably than a prompt judging two."
That was inherited from the handoff, never measured, and the measurement does not support it. The
real reason to split is fault isolation, which is a different claim with different boundaries —
it justifies exactly one split, not four calls.

**Alternatives considered**:

- *Four separate calls* — the shape this plan opened with. 23% more expensive for accuracy that
  measured no better, and one of its four prompts had a crisis miss the merged version did not.
- *One fully merged call* — cheapest and fastest to write, and it loses the verdict on precisely
  the recordings where the verdict matters most.
- *Merging content processing into the judgment call while keeping relevance separate* — splits
  on a taxonomy rather than the fault line, and puts the transcript in the call that must survive
  a block.

**Cost**: this removed a NON-NEGOTIABLE prohibition from Principle III and took the constitution
to 3.0.0. That is a real price, paid to replace an asserted rule with a measured one.

**Not measured**: the audio-quality report returned `clear` on all 16 fixtures, because all 16
are clear recordings. Its `silent` and `unintelligible` values are unexercised, and they are
exactly the fallback FR-008h leans on. Two junk fixtures are required before that path is
trusted — tracked in [quickstart.md](quickstart.md).

---

## D3 — `BLOCK_NONE` explicitly on both calls, and an empty candidate is always a fault

**Decision**: both calls set all four adjustable harm categories to `BLOCK_NONE`, explicitly. Any
response with no candidate is a fault and retries under D6 — never a verdict.

**Rationale**: this decision was rewritten after review caught that its premise was wrong.

Google documents the four adjustable filters as **off by default** for Gemini 2.5 and 3
(<https://ai.google.dev/gemini-api/docs/safety-settings>). Earlier drafts of this document argued
a split configuration — `BLOCK_NONE` on content processing, "provider defaults" on the judgment
call — and cited measurements showing no difference between them. Of course there was none:
**they are the same configuration.** Passing no `safetySettings` does not select a lenient filter;
it selects no filter. The comparison measured nothing.

With that understood the design simplifies. There is one sensible setting, it is the same on both
calls, and it is written **explicitly** rather than relied on as a default: a default that is
documented today can change, and this product's gate should not move when it does.

**The blocking that remains is not ours to configure.** `firearm-no-permit` and `drug-synthesis`
returned empty candidates *at* `BLOCK_NONE`. That cannot be an adjustable filter, because those
were off. Google documents non-adjustable protections against core harms as permanently active
regardless of settings. So an empty candidate is a permanent possibility that no configuration
removes, which is exactly why FR-008b1 handles it as a fault rather than trying to tune it away —
and why D2 splits content processing from the judgment call in the first place.

**Alternatives considered**:

- *A split configuration* — what this decision previously said. Rejected: the two halves of the
  split were identical, so it was complexity describing a distinction that does not exist.
- *Omitting `safetySettings` entirely* — identical behaviour today, and silently different if
  Google changes the default. Explicit costs one constant.
- *Enabling the adjustable filters* (`BLOCK_MEDIUM_AND_ABOVE` or similar) — **never tested**. It
  would make the judgment call block on exactly the recordings it is meant to judge, converting a
  clean refusal into an empty candidate that exhausts into processing failure. Actively harmful
  for this design, so it was not pursued.
- *Treat an empty candidate as illegal* — attractive, and wrong. It carries no reason, and a
  non-adjustable protection firing is not a verdict this system made.

**Corrections recorded**: two earlier claims in this decision were wrong and are retracted rather
than quietly edited. The first said provider defaults gave "a free backstop against our own false
negative" — they gave nothing, because nothing was on. The second presented defaults and
`BLOCK_NONE` as a measured trade-off — they are the same setting.

---

## D4 — Crisis wording is the lever, not model tier

**Decision**: keep crisis on `gemini-3.5-flash-lite`. Carry FR-008f's constraints in the system
instruction: indirect and understated phrasing counts, and no explicit method, plan, or the word
*suicide* is required.

**Rationale**: measured. The first crisis prompt passed *"I don't think I want to keep doing
this"* as safe. Escalating the same prompt to `gemini-3.8-flash` **still missed it**; rewriting
the prompt on Flash-Lite caught it while grief, burnout and metaphor controls stayed clean. The
defect was in what the prompt asked for, and a larger model optimizes harder for the wrong
question just as well.

**Alternatives considered**:

- *Raise the tier* — tested, did not work, costs latency and money on the critical path.
- *Two crisis calls and take the union* — doubles cost to paper over a prompt that has since been
  fixed, and gives two chances to false-positive on grief.

⚠️ **Open risk**: the corrected prompt carries its own previously-failing case as a few-shot
example, so it is fitted to that case and no longer tested by it. Fresh understated-crisis
recordings are required before launch. Tracked in quickstart.md, not resolved here.

---

## D5 — Each check is told what it is *not* judging

**Decision**: every check's system instruction names the judgments belonging to other checks and
forbids them explicitly.

**Rationale**: the spike's relevance check rejected on-topic answers purely because their content
was unlawful. Nothing in the aggregate decision changes when this happens — both reject — but
FR-008e selects the Withheld reason from *which* signal fired, so a bleeding relevance check
routes an illegal recording to `That response doesn't appear to answer this question`. The
participant gets the wrong reason and the system loses the ability to tell off-topic from unsafe.
Adding the negative constraint fixed 3 of 4 bleeding cases. FR-008g now requires it.

**Alternatives considered**:

- *Fix it in precedence ordering instead* — FR-022 already puts illegal above relevance, so the
  copy would come out right by accident. It leaves the check itself lying about what it measured,
  which breaks the moment precedence changes or a case rejects on relevance alone.

---

## D6 — Independent bounded retry, fail-fast on rejection

**Decision**: per check, at most 3 invocations including the first, 20-second timeout each, waits
of 1 s then 2 s. The whole submission stops at 90 s from receipt. A validated `canPublish: false`
from any check aborts the others immediately through a shared `AbortController`. Successful
results are kept for the active submission and never rerun.

**Rationale**: FR-039 fixes the numbers; this decision is about what retries and what cancels.
Retrying a check that already passed spends money to re-ask a settled question, and re-asking a
non-deterministic model invites a different answer — so successes are frozen (FR-019). Faults,
timeouts and schema-invalid results retry alone (FR-038). A definitive rejection ends the
submission, because nothing the other checks return can overturn it (FR-022).

`AbortController` is the cancellation mechanism because the same signal covers the participant
disconnecting: `request.signal` is chained into it, so a closed tab drops the in-flight calls and
releases the audio (FR-045, edge case *Browser closes or disconnects*).

**Alternatives considered**:

- *Retry the whole fan-out* — quadruples cost for one flaky call and reruns checks FR-019 forbids
  rerunning.
- *Let late results land* — FR-022 forbids it. Ignoring them is not enough on its own; without
  abort the calls still bill.

---

## D7 — Rate limiting needs a row, and it is not attempt history

**Decision**: one `submission_rate_limits` table keyed by participant, holding a window start and
a count. Limits come from environment variables with defaults, so FR-048's "configurable without
a code change" is satisfied without a deploy.

**Rationale**: this is the one place 002 must write to the database, and it deserves scrutiny
because Principle V says only published questions and answers enter it.

A rate limit cannot be derived from published rows. Its entire job is to bound *submissions*,
including the withheld and failed ones that leave no row — a limiter that counts only successes
does not limit the abuse it exists for. In-memory counters do not survive Cloud Run scaling
sideways, and a limit that resets per instance is decoration.

The row is a counter, not a contribution: no audio, no transcript, no verdict, no retry state,
nothing recoverable and nothing that reconstructs an attempt. It is abuse infrastructure of the
same kind as the session cookie.

**Alternatives considered**:

- *In-memory per instance* — free, and wrong on more than one instance.
- *Redis / Memorystore* — correct and disproportionate. A managed cache for one counter on a
  weekend build fails Principle VI.
- *Count published rows* — cheapest, and does not limit the case that costs money: repeated
  submissions that are all withheld.

⚠️ Recorded in plan.md Complexity Tracking as a Principle V tension, resolved in favour of the
limiter. Sweeping stale windows joins the existing `db-sweep` job rather than adding a second one.

---

## D8 — One blocking POST, not submit-then-poll

**Decision**: the contribution is posted to a route handler that holds the request open until the
decision resolves or the 90-second deadline expires, then returns the outcome. The Checking state
is the client rendering while that request is in flight.

**Rationale**: the spike measured a 2.4 s median and 3.6 s p90 fan-out. Polling infrastructure —
a job id, a status endpoint, client backoff, server state keyed by that id — exists to survive
waits far longer than this, and every piece of it is state FR-023 forbids keeping. Cloud Run's
default request timeout is 300 s, comfortably past the 90 s deadline this feature sets itself.

Holding the request also gives disconnect detection for free (D6): the participant closing the
tab aborts the handler, which is precisely the signal FR-045 needs.

**Alternatives considered**:

- *Submit, return an id, poll* — requires exactly the durable processing state Principle V
  inverted away from. Revisit only if the 60-second measurement in D15 pushes p90 past what a
  held connection should carry.
- *Streaming progress* — the design gives Checking a single indeterminate state with no per-check
  progress, so there is nothing to stream.

---

## D9 — Validate every model result before it is used

**Decision**: a Zod schema per check parses each response. A parse failure is a fault that retries
under D6; it is never rendered, stored, or treated as a rejection.

**Rationale**: FR-036 and FR-037, and Principle V's name. `responseSchema` constrains generation
but does not make the parsed object trustworthy — schema-valid and semantically wrong is
reachable, and a model response is untrusted input. This mirrors the row-parsing boundary 001
already established in `src/schema/rows.ts`, so the codebase has one rule for external data
rather than two.

**Alternatives considered**:

- *Trust `responseSchema`* — leaves `JSON.parse` output flowing into the interface unchecked, and
  the spike hit two responses whose text was `undefined` outright.

---

## D10 — 002 ships a module and four components, not routes

**Decision**: 002 delivers `src/review/` and the shared UI states. It owns no route of its own.
003 and 004 own the submission endpoints and call `reviewContribution()`.

**Rationale**: the spec is explicit that this feature "has no flow of its own — it owns a decision,
two screens, and an audio lifecycle", and design.md confirms Checking, Withheld, failure and rate
limit are "states rendered within the flow that produced them, not separate routes". Giving 002 a
route would create a second place submissions enter the system, and the contribution-specific
retry destinations in FR-027b belong to the flows.

US1's independent test — feed prepared recordings to the review with no interface — is satisfied
by the module being directly callable, which is also what makes it testable.

---

## D11 — Fixtures are the spike's own recordings

**Decision**: the 16 spike recordings and their adjudicated labels become the committed test set
for the guardrail suite.

**Rationale**: they already encode the cases that matter — the compositional illegal pair, crisis
with and without moderation-flagged content, the crisis near-misses, relevance bleed. Rebuilding
an equivalent set by hand is work already done, and re-deriving it would lose the two cases that
found real defects.

**Alternatives considered**:

- *Text fixtures* — cheaper and tests a path production does not take. Every check receives audio
  (FR-004), and the empty-candidate behaviour in D3 appeared only on audio.

⚠️ The crisis set must be *extended*, not merely committed, per D4's open risk. Committed fixtures
prove no regression; they cannot prove the tuned prompt generalizes.

---

## D12 — Mock at the SDK boundary

**Decision**: unit and integration tests inject a fake `@google/genai` client through the same
interface-injection pattern `src/db/client.ts` uses for `SqlClient`. Live-provider runs are a
separate opt-in script, not part of `make ai-checks`.

**Rationale**: 001 already established this shape and the tests already inject PGlite the same
way. Keeping `ai-checks` free of network calls keeps it deterministic and free; a suite that bills
per run and fails on someone else's rate limit stops being run.

**Alternatives considered**:

- *Always call the real provider* — non-deterministic, costs money per commit, and the spike hit
  429s repeatedly on the free tier.
- *Record/replay HTTP* — a third mechanism for a codebase that has one.

---

## D13 — The fan-out stays parallel, and D3 made that mandatory

**Decision**: all applicable checks are dispatched simultaneously. No staging, no ordering.

**Rationale**: the tempting alternative is to run the cheap Flash-Lite judgment call first and
only pay for the expensive Flash content call if it permits, so rejections skip it. Three reasons
it loses:

- It taxes the common path to optimise the rare one. Most contributions publish, so staging adds
  roughly a second to every successful submission to save money on the minority that do not.
- Cost protection already belongs to the rate limiter (FR-048). Using check ordering as a second
  cost control duplicates it worse.
- Fail-fast already recovers most of the saving: the judgment call returns at ~1.1 s, less than
  half the content call's median, so a refusal aborts content processing mid-generation anyway.
  Staging would buy the difference between an aborted call and no call at all.

**The deadline makes it a requirement, not a preference.** A call that faults retries up to
3 x 20 s. With two calls dispatched together the worst case stays near 60 s inside the 90 s budget
(FR-039); run in sequence, two exhausting calls exceed it and the whole submission renders as
processing failure even though one of them may have returned a usable verdict.

**Note on FR-008a**: it no longer requires a call per judgment — D2 replaced that with a single
split between content processing and the judgment call, and FR-008a1 repudiates the
classification-reliability rationale outright. What survives is FR-005: no call consumes another's
output. Staging would not have violated that either. It fails on latency and the deadline.

**Revisit if**: T081's cost measurement shows the content call dominating spend badly enough to
justify trading a second of latency for it.

---

## D14 — Runtime and failure constraints

**Decision**: the constraints below bound this module at runtime. Each names what it does when
the bound is hit, because a limit without a behaviour is a comment.

### Memory

Both calls carry their own inline copy of the recording. Measured worst case is a 530 KB
60-second AAC file, so one submission holds roughly **1.1 MB of audio across the fan-out**, plus
base64 expansion of about a third on each copy — call it **1.5 MB per in-flight submission**.

The 5 MB input bound in [contracts/review.md](contracts/review.md) puts the absolute worst case
near 14 MB per submission. Cloud Run's smallest instance is 512 MB, so concurrency is what
matters: **per-instance concurrency MUST be set such that `concurrency x 14 MB` stays inside the
instance memory limit with headroom.** At the default 512 MB that is a concurrency well under 20.

**Alternatives considered**: streaming the audio to each call rather than buffering. The SDK takes
inline bytes, so this would mean the Files API — rejected in D1 for creating a remote object with
a lifetime this system does not control.

### Provider quota and rate limits

A `429` from the provider is a **fault**, not a rejection, and retries under D6 like any other
fault. It is distinct from this system's own rate limit (D7): one is the provider refusing us,
the other is us refusing a participant. They MUST NOT share a code path or a message — telling a
participant they have submitted too much when the provider is throttling us is a lie.

The spike hit provider 429s repeatedly on the free tier, so this is a real path, not a
hypothetical. Exhausting retries against a 429 produces processing failure, which is honest:
something on our side did not finish.

### Missing or invalid credentials

`src/review/client.ts` throws on a missing `GEMINI_API_KEY` at first use, naming the variable —
matching `src/db/client.ts`'s treatment of `DATABASE_URL`. It does **not** fall back, and it does
**not** degrade to publishing unreviewed.

An invalid key surfaces as a provider fault and exhausts into processing failure. That is the
correct outcome: nothing publishes. Deployment catches this, not the review path.

### Request timeout

The 90-second submission deadline (FR-039) is meaningless if the platform kills the request
first. **Cloud Run's configured request timeout for this service MUST exceed 90 seconds**, and
that value MUST be asserted in `deploy.sh` rather than assumed from a platform default that can
change.

If the platform terminates the request, the participant sees a browser-level failure rather than
the authored processing-failure page — a worse outcome than any this feature designs for.

### Abandonment

A disconnect fires `request.signal`, which aborts the fan-out and releases the audio (D6). Cloud
Run does not guarantee the signal fires on every disconnect, which is exactly why the 90-second
deadline exists as the backstop: worst case, the work stops on its own.

---

## D15 — What remains unmeasured

Carried forward deliberately, not resolved by this document:

| Open | Why it matters | Where it lands |
| - | - | - |
| Fan-out latency at the 60-second ceiling | SC-001's budget; four times the spike's audio | quickstart.md |
| Cost per contribution including max retries | SC-012, unmeasured | quickstart.md |
| Crisis prompt against untuned recordings | D4's fitting risk | quickstart.md |
| `TODO(TTS_VOICE_ID)` | Playback is 005; the review does not need it | 005 |

Nothing above blocks writing the review. All four block calling it proven.
