# Phase 0 Research: Contribution Review

**Feature**: 002-contribution-review · **Date**: 2026-09-05

Decisions are numbered `D1`–`D13` and referenced from [plan.md](plan.md) and
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
- *Gemini Files API* — upload once, reference from four calls. Saves resending ~1 MB three times
  and adds a remote object with a lifetime this system does not control, which is the exact thing
  FR-043 forbids. Reconsider only if the 60-second measurement in D13 shows inline resend
  dominating latency.

**Consequence**: FR-046's lifecycle backstop has nothing to back up. Recorded as a deviation in
plan.md Complexity Tracking rather than silently skipped.

---

## D2 — Four checks for an answer, three for a question

**Decision**: content processing on `gemini-3.8-flash`; crisis, illegal-or-dangerous, and
relevance each on `gemini-3.5-flash-lite`. Relevance is answer-only.

**Rationale**: settled by the spike. The provider returns no safety ratings on this path, so
illegal-or-dangerous has no free signal to read and becomes a dedicated call (FR-008c). Questions
take the illegal check too — without it they would have no illegal screening at all once the
ratings premise collapsed.

Tier split follows the job. Content processing transcribes, translates, redacts and preserves
substance over a minute of audio; the other three return one boolean each, which is what
Flash-Lite is for. The spike measured 2.4 s median for the Flash call against ~1.1 s for each
Flash-Lite call, so the fan-out costs what the content call costs.

**Alternatives considered**:

- *One call returning several verdicts* — forbidden by FR-008a and Principle III. A prompt judging
  one thing classifies more reliably than a prompt judging two, and the spike's relevance bleed
  (D5) is what that failure looks like even across separate calls.
- *Escalating crisis to `gemini-3.8-flash`* — measured and rejected in D4.

---

## D3 — `BLOCK_NONE` on content only; defaults kept on the three checks

**Decision**: content processing sets all four harm categories to `BLOCK_NONE`. Crisis,
illegal-or-dangerous and relevance keep the provider's default thresholds. Any response with no
candidate is a fault and retries under D6 — never a verdict.

**Rationale**: the two calls fail in opposite directions, so configuring them the same way is
wrong whichever value you pick.

*Content processing* is the call that actually trips the filter, because its output reproduces
the recording as text. The spike saw it return an empty candidate on two illegal fixtures **even
at `BLOCK_NONE`**. A block here returns no reason and no ratings, and retry cannot recover it —
so if the filter false-positives on a legitimate recording, that contribution is unpublishable
forever. Never-block is the only setting that keeps a lawful recording reachable by this system's
own judgment.

*The three boolean checks* emit one bit. On the same two fixtures where content processing came
back empty, all three returned clean verdicts. A block there can only ever remove a permit, never
grant one — publication requires unanimous permits (FR-019), so a blocked check cannot publish
anything. That makes the provider's filter a free conservative backstop against **this system's
own check false-negativing**, which is the failure that ends the product.

Safety beats copy. The cost of keeping defaults on the checks is a degraded message — a blocked
illegal check exhausts its retries and renders `We couldn't check your answer` instead of
`That response can't be shared here`. Annoying, and strictly better than a false negative.

**Alternatives considered**:

- *`BLOCK_NONE` everywhere* (this plan's first draft) — uniform and simple, and gives up the
  backstop on the three calls where the backstop is nearly free. It was also unmeasured on those
  calls, so simplicity was buying nothing that had been verified.
- *Defaults everywhere* — costs the content call its transcript on recordings this system is
  required to judge, with no reason returned and no retry path.
- *Treat an empty candidate as illegal* — attractive, and wrong. The same audio produced a
  candidate on one run and not on another.

**Not measured**: default thresholds were tested on the content call only, where they passed 7 of
8 must-not-publish recordings. That the three checks rarely trip the filter is inferred from their
behaviour at `BLOCK_NONE` on the two fixtures where content processing blocked — one observation,
not an experiment. Flagged because this feature already cost one constitution amendment for a
claim read from documentation rather than called.

**Consequence**: a blocked check burns up to 3 x 20 s of the 90 s deadline. This is why the
fan-out must stay parallel — see D14.

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
  inverted away from. Revisit only if the 60-second measurement in D13 pushes p90 past what a
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

## D14 — The fan-out stays parallel, and D3 made that mandatory

**Decision**: all applicable checks are dispatched simultaneously. No staging, no ordering.

**Rationale**: the tempting alternative is to run the three cheap Flash-Lite checks first and only
pay for the expensive Flash content call if they all permit, so rejections skip it. Three reasons
it loses:

- It taxes the common path to optimise the rare one. Most contributions publish, so staging adds
  roughly a second to every successful submission to save money on the minority that do not.
- Cost protection already belongs to the rate limiter (FR-048). Using check ordering as a second
  cost control duplicates it worse.
- Fail-fast already recovers part of the saving: a refusal at ~1.1 s aborts content processing
  mid-generation.

**D3 turned this from a preference into a requirement.** With default thresholds on the three
checks, a blocked check faults and retries — up to 3 x 20 s for one check. Run sequentially or in
stages, two such checks exceed the 90-second deadline (FR-039) and the whole submission renders as
processing failure. Dispatched together, the worst case stays near 60 s inside a 90 s budget
instead of stacking.

**Note on FR-008a**: its requirement is *isolation* — each check its own call, consuming no other
check's output (FR-005) — and its stated rationale is classification reliability, not timing.
Staging would not have violated that rationale. It fails on latency and the deadline instead.

**Revisit if**: T081's cost measurement shows the content call dominating spend badly enough to
justify trading a second of latency for it.

---

## D13 — What remains unmeasured

Carried forward deliberately, not resolved by this document:

| Open | Why it matters | Where it lands |
| - | - | - |
| Fan-out latency at the 60-second ceiling | SC-001's budget; four times the spike's audio | quickstart.md |
| Cost per contribution including max retries | SC-012, unmeasured | quickstart.md |
| Crisis prompt against untuned recordings | D4's fitting risk | quickstart.md |
| `TODO(TTS_VOICE_ID)` | Playback is 005; the review does not need it | 005 |

Nothing above blocks writing the review. All four block calling it proven.
