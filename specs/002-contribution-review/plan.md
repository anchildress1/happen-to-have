# Implementation Plan: Contribution Review

**Branch**: `002-plan` | **Date**: 2026-09-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-contribution-review/spec.md`

## Summary

Build the engine both contribution flows run on: one review that turns a spoken recording into
publishable text and a single verdict, and the screens that show the result when the verdict is
no.

This feature has no route and no flow. It exposes `reviewContribution()` — audio in, decision out
— plus the four shared states (Checking, Withheld, processing failure, rate limited) that 003 and
004 render. It ends at the decision. Granting an ask is 003; consuming one is 004.

The technical approach: **one `@google/genai` call per signal**, dispatched in parallel on the
original audio — content processing, crisis, illegal-or-dangerous, and relevance for an answer —
each validated with Zod before use, aggregated by a gate that publishes only on unanimous
permission and resolves to Withheld the instant any of them refuses. The audio never leaves the request — no
bucket, no object key, no address to leak ([research D1](research.md)).

**The spike rewrote this plan before it was written.** The provider returns no safety ratings at
any threshold, and at its default guardrails it passed 7 of 8 recordings that must never publish
— including every crisis case. Illegal-or-dangerous is therefore a dedicated call rather than a
free rating, and the provider's own filter is barred from counting as a check at all. Evidence:
[spike-002-guardrails](../../docs/spike-002-guardrails.md).

**One signal per call, because merging was measured and it cost lives-worth of signal.** On
twenty understated-crisis recordings the prompt had never seen, the same model with the same
wording caught 3 of 10 when crisis shared a call with two other judgments and 10 of 10 when it
had a call of its own on the content tier — zero false positives throughout. A call holding
several jobs stops doing the subtle one. Full measurement in [research D2](research.md).

Content processing stays separate for a second, independent reason: it reproduces the recording
as text and is the call the provider's filter trips — measured returning an empty candidate on two
fixtures even at `BLOCK_NONE`. The judgment calls emit booleans and have never been observed
blocking. Merged, a single block would destroy every verdict and an unlawful recording would
render as a processing failure.

That measurement took the constitution to **4.0.0**, removing the merge permission 3.0.0 had
granted. 3.0.0's evidence could not have found the effect: its crisis cases were the ones the
crisis prompt had been tuned on.

Two decisions deserve early scrutiny. Rate limiting writes the only row this feature persists,
which sits against Principle V ([research D7](research.md), justified in Complexity Tracking).
And the crisis wording is now fitted to the twenty recordings that validated it, so they are a
regression set rather than a generalization test.

## Technical Context

**Language/Version**: TypeScript 7.0.2 on Node.js 24 LTS, ESM only. Imports in `src/` and `app/`
carry no file extension, matching 001.

**Primary Dependencies**: adds `@google/genai` 2.21.0 to the 001 stack (Next.js 16.3.4,
React 19.2.8, `@neondatabase/serverless` 1.1.0, `iron-session` 9.0.1, Zod 4.5.4). Server-side
only — an API key in a browser bundle is a leaked key.

**Models** (pinned per job, verified 2026-09-05 and exercised by the spike):

| Call | Model | Safety | Returns |
| - | - | - | - |
| Content processing | `gemini-3.8-flash` | `BLOCK_NONE`, explicit | text, language, emotion, publishable, contentReason |
| Crisis | `gemini-3.8-flash` | `BLOCK_NONE`, explicit | inTrouble, signal |
| Illegal or dangerous | `gemini-3.5-flash-lite` | `BLOCK_NONE`, explicit | canPublish, detail |
| Relevance (answers only) | `gemini-3.5-flash-lite` | `BLOCK_NONE`, explicit | canPublish, detail |

Measured 2026-09-05: content ~2.4 s median, a Flash-Lite judgment ~1.15 s median. The fan-out is
gated by the slowest call, which is now content or crisis on Flash, so widening from two calls to
four costs about $0.0015 per 60-second contribution and no measurable latency
([research D2](research.md)).

**Storage**: no new storage for audio ([research D1](research.md)). One new Postgres table for
rate-limit counters ([research D7](research.md)). Neon, schema owned by committed migrations.

**Testing**: Vitest 5.0.0 with the provider faked at the SDK boundary
([research D12](research.md)); Playwright 1.62.1 for the four screens. A separate opt-in script
runs the committed audio fixtures against the live provider.

**Target Platform**: unchanged from 001 — responsive web on Cloud Run `us-east1`.

**Project Type**: web application, single Next.js project. 002 adds a library module and shared
components; it adds no route.

**Performance Goals**: SC-001 — decision within 15 s median, 30 s p95. Measured 2.4 s median and
3.6 s p90 on 12–16 second clips, which is headroom, not proof at 60 s
([research D15](research.md)).

**Constraints**: at most 3 invocations per check, 20 s timeout each, waits of 1 s then 2 s,
90 s total from server receipt (FR-039). Original audio exists only inside the active request.
No unpublished contribution row, attempt history, or retry state is persisted (FR-023). Copy is
fixed by [contracts/copy.md](contracts/copy.md); layout by
[001's design.md](../001-participant-and-pool/contracts/design.md).

**Audio input** (measured 2026-09-05, full contract in [contracts/review.md](contracts/review.md)):
accepts `audio/mp4`, `audio/webm`, `audio/m4a`, `audio/aac`, `audio/ogg`, `audio/wav` — Safari
records MP4/AAC and Chrome records WebM/Opus, and `audio/mp4` was verified as accepted despite
being absent from the provider's published list. Rejects below 1 KB or above 5 MB; a 60-second
recording measures 250–530 KB against a 20 MB inline ceiling.

**Runtime** ([research D14](research.md)): ~1.5 MB of audio in flight per submission across the
two copies, so Cloud Run per-instance concurrency must be bounded against instance memory. The
service's request timeout must exceed the 90 s deadline and is asserted in `deploy.sh`, not
assumed. A provider `429` is a fault that retries — never this system's own rate limit, and never
that message.

**Scale/Scope**: weekend challenge scale. One module, four screens, one table, two provider
calls per contribution.

## Constitution Check

Checked against constitution **v3.0.0** — all three amendments this feature's measurements caused. Re-checked
after Phase 1 design; result unchanged.

| Principle | Applies here? | Status | Evidence |
| - | - | - | - |
| I. Human Contribution Is The Product | Yes | **PASS** | FR-014/FR-015 forbid the review adding advice or altering substance; content processing transcribes and redacts only. No generated advice anywhere (spec Out of Scope). |
| II. Server-Authoritative Reciprocity | Partially | **PASS** | 002 returns a decision and never grants or consumes an ask. FR-042 keeps a failed question's ask unspent. Granting is 003, consumption is 004. |
| III. Aggregate Guardrail Gate | Yes | **PASS** | Two parallel calls, split on the provider's fault line ([research D2](research.md)). Uniform `canPublish`; either refusing resolves Withheld and aborts the other ([research D6](research.md)). Provider's own filter explicitly not counted as a signal. |
| IV. Original Audio Is Transient | Yes | **PASS** | Audio never reaches storage ([research D1](research.md)), bounded by the 90 s deadline, released on abort. FR-047 keeps playback of an original off every surface. |
| V. Structured Output Or Failure | Yes | **PASS with one tension** | Every result Zod-parsed before use ([research D9](research.md)); invalid output retries and never renders. Check results and retry counts live only in the request. **The rate-limit counter is the exception** — see Complexity Tracking. |
| VI. Scope Discipline | Yes | **PASS** | No object storage, no job queue, no polling infrastructure, no cache service, no human moderation or appeals. Each rejection recorded in research alternatives. |
| VII. Voice And Provenance | Yes | **PASS** | All participant-facing strings fixed in [contracts/copy.md](contracts/copy.md), taken verbatim from design.md. Crisis routing is human-authored and static; FR-034 forbids generated counseling. No "safe" positioning. |

### Feature-specific gates

| Gate | Status | Note |
| - | - | - |
| Every signal has its own call | **PASS** | FR-008a — merged scored 3/10 on unseen crisis cases, dedicated 10/10 ([research D2](research.md)). |
| Crisis runs on the content tier | **PASS** | FR-008a1 — 8/10 on Flash-Lite, 10/10 on Flash, same prompt. |
| The withheld reason is the call that refused | **PASS** | FR-008e — one signal per call leaves nothing to reconstruct. |
| Illegal-or-dangerous is judged, never read from provider metadata | **PASS** | FR-008c as amended; the free-ratings premise was falsified. |
| Crisis judgment exists regardless of moderation | **PASS** | FR-008d — no provider category covers self-harm, adjustable or otherwise, and every crisis fixture transcribed clean. |
| Crisis catches understated phrasing | **PASS** | FR-008f carried into the system instruction ([research D4](research.md)). ⚠️ prompt is fitted to its own failing case — see Complexity Tracking. |
| Relevance does not judge safety | **PASS** | FR-008g, [research D5](research.md). |
| Empty candidate treated as fault, not verdict | **PASS** | FR-008b1, [research D3](research.md). |
| Adjustable filters set explicitly, not assumed | **PASS** | FR-008b — the provider documents them as off by default, so the setting is written rather than inherited ([research D3](research.md)). |
| Non-adjustable blocks handled as faults, not verdicts | **PASS** | FR-008b1 — they survive every configurable setting and carry no reason. |
| Fan-out dispatched in parallel | **PASS** | [research D13](research.md) — sequential, two exhausting calls would exceed the 90 s deadline. |
| Gemini via official SDK, server-side only | **PASS** | `server-only` import, matching `src/db/client.ts`. |
| No Live API model | **PASS** | Both pinned models are `generateContent`-callable and GA. |
| Secrets from Secret Manager / gitignored `.env` | **PASS** | `HTH_GEMINI_API_KEY`; `GEMINI_API_KEY` already in `.env.example`. |

**Result: gates pass; five measurements outstanding.** These are planning checks. Latency at
60 s, cost per contribution, and the crisis prompt against untuned recordings are unproven and
tracked in [quickstart.md](quickstart.md).

## Project Structure

### Documentation (this feature)

```text
specs/002-contribution-review/
├── plan.md              # This file
├── research.md          # Phase 0 — 15 decisions, the load-bearing ones measured
├── data-model.md        # Phase 1 — in-request shapes, and the one persisted table
├── quickstart.md        # Phase 1 — run it, and what is still unproven
├── contracts/
│   ├── review.md        # Module contract, per-check prompts and schemas, the gate
│   └── copy.md          # Every fixed string for the four states
├── checklists/
│   └── requirements.md  # Spec review, updated with spike results
└── tasks.md             # Phase 2 — created by /speckit-tasks, NOT here
```

### Source code (repository root)

Only what 002 adds. Everything else is 001's and unchanged.

```text
.
├── src/
│   ├── review/
│   │   ├── index.ts              # reviewContribution() — the only export 003/004 use
│   │   ├── client.ts             # @google/genai client, server-only, injectable for tests
│   │   ├── gate.ts               # aggregate decision, precedence, fail-fast abort
│   │   ├── retry.ts              # per-check bounded retry, timeouts, deadline
│   │   ├── schemas.ts            # Zod parser per check result
│   │   ├── prompts/
│   │   │   ├── content.ts        # transcribe, translate, redact, emotion — BLOCK_NONE
│   │   │   ├── crisis.ts         # is this person in trouble — Flash, its own call
│   │   │   ├── illegal.ts        # unlawful or dangerous to publish — Flash-Lite
│   │   │   └── relevance.ts      # does the answer engage the question — Flash-Lite
│   │   └── rateLimit.ts          # window check, env-configured values
│   ├── db/queries/
│   │   └── rateLimits.ts         # the one table 002 writes
│   ├── schema/rows.ts            # + rate-limit row parser
│   ├── copy.ts                   # + the four states' strings
│   └── ui/
│       ├── CheckingState.tsx     # blocking, aria-live, watermark .05
│       ├── WithheldPage.tsx      # one page, all reasons, contribution-specific actions
│       ├── CrisisResources.tsx   # four static rows, human-authored
│       ├── ProcessingFailed.tsx  # exhaustion and deadline only
│       └── RateLimited.tsx       # names the retry time
├── migrations/
│   └── *_rate-limits.sql         # one table; no contribution columns
└── tests/
    ├── unit/                     # schemas, gate precedence, retry bounds, rate-limit window
    ├── integration/              # fan-out with a faked provider; abort and deletion behaviour
    ├── e2e/                      # the four screens, their copy and actions
    └── fixtures/audio/           # the 16 spike recordings + labels (research D11)
```

**Structure Decision**: `src/review/` is a library module, not a route
([research D10](research.md)). 003 and 004 own the endpoints that call it, because the retry
destinations in FR-027b are contribution-specific and belong to the flows. This also makes US1's
independent test — prepared recordings straight into the review, no interface — the natural way
to test it rather than a special affordance.

## Phase 1 outputs

| Artifact | Contents |
| - | - |
| [data-model.md](data-model.md) | The in-request shapes that are deliberately not tables, the one table that is, and every FR that forbids a column |
| [contracts/review.md](contracts/review.md) | `reviewContribution()` signature, the audio input contract, both calls with their system instructions and response schemas, the gate's precedence and abort rules |
| [contracts/copy.md](contracts/copy.md) | Every fixed string for Checking, Withheld's five variants, crisis, failure and rate limit |
| [quickstart.md](quickstart.md) | How to run the review, the fixture suite, the live-provider script, and the three measurements still outstanding |

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| - | - | - |
| The rate-limit counter is a persisted row, and Principle V says only published questions and answers enter the database | A limiter must count submissions that leave no row — the withheld and failed ones are exactly the abuse that costs money. In-memory counters reset per Cloud Run instance, so the limit stops existing the moment traffic justifies it. FR-048 and FR-051 both assume a real limit. | Counting published rows misses every withheld submission, which is the attack. Memorystore is a managed cache for one integer on a weekend build. The row holds a participant id, a window start and a count — no audio, transcript, verdict or retry state, and nothing that reconstructs an attempt. It is abuse infrastructure of the same kind as the session cookie, not contribution history. |
| FR-046 requires a storage lifecycle backstop; this plan has no storage to back up | [research D1](research.md) keeps the audio inside the request, which satisfies FR-043's "not reachable at any address" by never creating an address. The requirement was written expecting a bucket. | Adding GCS solely to satisfy the wording would create the leak window the requirement exists to close, plus IAM, upload/delete round-trips inside the latency budget, and a permanent orphan-cleanup obligation. Principle VI rejects capability held for a need that has not arrived. |
| The crisis prompt carries its own previously-failing case as a few-shot example | It is the fix. The spike's original wording passed *"I don't think I want to keep doing this"* as safe, and escalating the model tier did not help ([research D4](research.md)). | Removing the example restores the miss. Keeping it means the prompt is fitted to that case and no longer tested by it, so fresh understated-crisis recordings are required before launch — tracked in quickstart.md, and the honest reason this gate is marked PASS with a warning rather than proven. |

### Spec wording — worth a look

FR-046 says *"Transient storage MUST carry a lifecycle backstop, and normal cleanup MUST
explicitly delete objects on every exit"*. With [research D1](research.md) there is no transient
storage and no object to delete: the buffer is released when the request ends.

The requirement's intent — no original recording survives its submission — is met more strongly
than the wording asks. Its literal wording is not met, because it presumes a bucket.

Not amended here. Rewording a normative requirement is a spec change, not a planning one, and
this feature has already consumed one constitution amendment this week. Flagged so the gap is
visible rather than quietly reinterpreted.

### Deviation notes

**002 adds no columns to `questions` or `answers`.** The review returns text and a verdict; 003
and 004 persist what publishes. The display-text and language columns those flows need belong to
their migrations, not this one — same rule 001 set when it declined to create the handoff's full
schema up front.

**`answers` still has no text column.** That is correct at this point in the build and not an
oversight: nothing publishes until 003.
