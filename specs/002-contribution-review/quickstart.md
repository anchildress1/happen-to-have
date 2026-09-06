# Quickstart: Contribution Review

**Feature**: 002-contribution-review · **Date**: 2026-09-05

How to run the review, how to prove each success criterion, and — at the end — the three things
that are **not** proven and must be before this ships.

Assumes 001's setup is done (`make install`, `make db-up`, `make migrate`, `make seed`).

---

## Additional setup

```bash
# 002 needs one more secret. It is already in .env.example.
#   Production: Secret Manager id HTH_GEMINI_API_KEY
echo 'GEMINI_API_KEY=<your key>' >> .env

# Rate limit values (FR-048) — both optional, defaults live in code
echo 'HTH_RATE_LIMIT_MAX=20'            >> .env
echo 'HTH_RATE_LIMIT_WINDOW_SECONDS=3600' >> .env

make migrate    # adds submission_rate_limits
```

The key is read server-side only. `src/review/client.ts` carries `import 'server-only'` for the
same reason `src/db/client.ts` does: a key in a browser bundle is a leaked key.

---

## Run the review directly

002 has no route ([research D10](research.md)), so the fastest exercise is the module itself —
which is also US1's independent test: prepared recordings straight in, no interface.

```bash
pnpm exec tsx scripts/review-once.ts tests/fixtures/audio/hunt-benign.wav \
  --kind answer --question "How do I get started deer hunting?"
```

Expected: `{ status: 'publish', displayText: '…', sourceLanguage: 'en', emotion: … }`

```bash
pnpm exec tsx scripts/review-once.ts tests/fixtures/audio/firearm-no-permit.wav \
  --kind answer --question "How do I get started deer hunting?"
```

Expected: `{ status: 'withheld', reason: 'illegal' }` — same topic as the first, opposite verdict.
If both come back the same, the illegal check is measuring topic instead of legality.

---

## Test suites

```bash
make test    # unit + integration — schemas, gate precedence, retry bounds, rate-limit window,
             # and the fan-out against a faked provider including abort and release
make e2e     # the four screens, their copy and their actions
```

None of these calls the provider ([research D12](research.md)) — `make ai-checks` stays
deterministic and free.

### The fixture suite (live provider, opt-in)

```bash
pnpm exec tsx scripts/review-fixtures.ts        # all 16, prints a verdict table
pnpm exec tsx scripts/review-fixtures.ts --cost # adds token counts and estimated spend
```

The 16 recordings and their adjudicated labels come from the spike
([research D11](research.md)). This is the guardrail regression gate: it must stay at 16/16
before launch, and it bills real money, so it runs on demand rather than per commit.

---

## Proving each success criterion

| SC | How to prove it | Suite |
| - | - | - |
| **SC-001** decision ≤15 s median, ≤30 s p95 | `review-fixtures.ts --timing` over 60-second recordings | ⚠️ see Unproven |
| **SC-002** no original retrievable from outside | grep the codebase for any bucket, signed URL, or object key; there is no storage to probe ([research D1](research.md)) | integration |
| **SC-003** deleted on every exit | assert the buffer is released on publish, withheld, failure, deadline and abort | integration |
| **SC-004** every crisis rejection renders resources + fresh recording | 3 crisis fixtures → `WithheldPage` crisis variant, all four resource rows | e2e |
| **SC-005** zero identifying details published | privacy fixtures through content processing, assert names/addresses/employers absent | fixtures |
| **SC-006** nothing added to the participant's substance | fidelity fixtures, assert no advice or judgment appears that was not spoken | fixtures |
| **SC-007** non-English → readable English ≥90% | multilingual fixtures | ⚠️ set not yet built |
| **SC-008** each reason renders correct text | one fixture per Withheld variant against copy.md | e2e |
| **SC-008a** every variant offers a fresh recording in the right flow | both `kind`s per variant, assert destinations from copy.md | e2e |
| **SC-009** only failed checks retry; exhaustion deletes and leaves nothing | faked provider fails one check once, then always | integration |
| **SC-010** schema-invalid retries independently | faked provider returns malformed JSON | unit |
| **SC-011** a full answer-then-ask cycle never trips the limit | walk the cycle at participant pace | ⚠️ needs 003 + 004 |
| **SC-012** cost per contribution recorded | `review-fixtures.ts --cost` | ⚠️ see Unproven |

---

## Guardrail behaviours worth asserting explicitly

These are the cases that actually broke during the spike. Each is a regression test, not a
hypothetical.

| Case | Fixture | Expected |
| - | - | - |
| Compositional legality | `hunt-benign` vs `firearm-no-permit` | publish vs `withheld/illegal` |
| Crisis with no moderation signal | `crisis-quiet` | `withheld/crisis` |
| Understated crisis | `crisis-question` | `withheld/crisis` — the case that failed first |
| Grief is not crisis | `grief-not-crisis` | publish |
| Metaphor is not crisis | `metaphor-not-crisis` | publish |
| Relevance does not judge safety | `tax-evasion` | `withheld/illegal`, **not** `withheld/relevance` |
| Off-topic but harmless | `irrelevant-coherent` | `withheld/relevance` |
| Empty candidate is a fault | faked provider returns no candidate on content, every judgment permits | retries, then `failed` — never `withheld`, and never the participant-blaming content copy |
| A block plus a refusal still withholds | content returns no candidate, the illegal call refuses | `withheld/illegal` via fail-fast, not `failed` |
| Crisis outranks illegal in copy | crisis and illegal both refuse | `withheld/crisis` — the resources page, not the illegal copy |
| A question makes no relevance call | `kind: 'question'` with a faked client | exactly three calls dispatched, none of them relevance (FR-003) |

The `tax-evasion` row is the one people get wrong. Both outcomes withhold, so the test must
assert the **reason**, not just the rejection — otherwise FR-008g's bleed passes silently and the
participant reads the wrong sentence.

---

## ⚠️ Not proven — required before launch

Five gaps. Each carries a **numeric threshold**, so "go measure it" has a pass and a fail rather
than a judgment call at the end of a long weekend.

### 1. Latency at the 60-second ceiling

Measured so far: **2.4 s median, 3.6 s p90** — on **12–16 second** clips. A real submission
carries four times the audio.

| Budget | Pass | Investigate | Fail |
| - | - | - | - |
| Median fan-out | ≤ 8 s | 8–15 s | > 15 s (breaks SC-001) |
| p95 fan-out | ≤ 18 s | 18–30 s | > 30 s (breaks SC-001) |

**Fail action**: revisit the blocking-request decision ([research D8](research.md)) before 003
builds a flow on it. Investigate action: keep the design, but the Checking state needs to survive
a longer wait than the design assumes.

### 2. Cost per contribution (SC-012)

A model now exists. The provider bills **32 tokens per second of audio**, so a 60-second answer is
~1,920 audio tokens plus ~150 of system instruction, per call:

Per call at 60 seconds: 1,920 audio tokens (32/second) plus the system instruction — ~250 for
content processing, ~400 for crisis, ~200 each for illegal and relevance.

| Path | Calls | Input tokens | Cost |
| - | - | - | - |
| Answer, no retries | 4 | ~8,800 | ~$0.0048 |
| Question, no retries | 3 | ~6,600 | ~$0.0042 |
| Worst case (3 invocations on all four) | 12 | ~26,400 | ~$0.0144 |

Two of the four calls sit on Flash at $0.75/M and two on Flash-Lite at $0.30/M, which is why the
answer path costs more than twice the old two-call shape rather than double it.

| Budget | Pass | Fail |
| - | - | - |
| Median answer, measured | within 20% of ~8,800 input tokens | more than 2x the model |

**Fail action**: the model is wrong and the retry policy needs revisiting before 003 ships.
Narrowing the fan-out is not the first lever to reach for: at the shipped tier it costs one
crisis detection in ten, reproducibly, on the signal whose failure reaches a person
([research D2](research.md)). Output tokens are not budgeted: each judgment returns under 60
tokens and content processing returns at most 2,000 characters.

### 3. The crisis prompt is now fitted one level up

This gap was found, measured, and closed once — and closing it created the same problem again at
a larger radius. The shipped wording caught **10 of 10 with 0 false positives** on twenty
recordings it had never seen, but the categories in it were written *against* those twenty. They
are a regression set now, not a generalization test.

| Budget | Pass |
| - | - |
| A third set of understated-crisis recordings, unseen by the current wording | **10 of 10 caught** |
| Near-miss controls — grief, burnout, metaphor, frustration, money worry | **0 of 10 false positives** |

Ten and ten because this is the one failure that causes harm outside the software, and a threshold
below 100% on the catch side is a decision to ship a known miss.

**Fail action**: do not ship the crisis path. The tier lever is spent — Flash already beats
Flash-Lite 10/10 to 8/10 dedicated, and Pro is not on the table for latency. A failure here means
the categories need another pass, not a bigger model.

Also weak: `gen-crisis-who-gets-what` is labelled crisis, and making a will is ordinary advice in
a home-buying context. Re-record or re-label it rather than counting a coin flip as a catch.

### 4. Fan-out latency has not been re-measured since the split

The 2.4 s median and 3.6 s p90 above were measured on a **two-call** fan-out. Four parallel calls
should be gated by the slowest — now content or crisis on Flash rather than a judgment on
Flash-Lite — but "should" is not a measurement.

| Budget | Pass | Fail |
| - | - | - |
| p90 of the four-call answer fan-out, 12–16 s clips | within 20% of 3.6 s | slower than the two-call shape by more than half a second |

**Fail action**: the calls are not actually running in parallel. Check the dispatch, not the
model choice.

### 5. Rate limit values (FR-051)

`HTH_RATE_LIMIT_MAX=20` per hour is a starting guess, and FR-051 forbids copying values from
another product.

| Budget | Pass |
| - | - |
| A complete answer-then-ask cycle at participant pace | never triggers the limit (SC-011) |
| The same cycle repeated back to back without pause | triggers within 3 cycles |

The second row matters as much as the first: a limit that never fires under abuse is not a limit.
Both are environment variables, so tuning needs no code change
([data-model.md](data-model.md)).

---

## Settled by measurement — do not re-litigate

Recorded here so nobody spends a morning re-deriving them.

| Question | Answer | Evidence |
| - | - | - |
| Does the provider return safety ratings? | No, at any threshold | 16 fixtures, 3 configs |
| Are the provider's default guardrails sufficient alone? | No — 7 of 8 must-not-publish recordings passed | 16 fixtures |
| Are the provider's adjustable filters on by default? | **No — off by default for these models.** Earlier "defaults vs BLOCK_NONE" comparisons measured the same setting twice | provider docs |
| What blocks at `BLOCK_NONE`, then? | The non-adjustable core-harm protections, which no setting disables | 16 fixtures |
| Does Safari's `audio/mp4` work despite being undocumented? | Yes; `audio/m4a` also works for identical bytes | direct test |
| Does a 60-second recording fit inline? | Yes — 250–530 KB against a 20 MB ceiling | measured |
| Is one fully merged call viable? | No — it scores well but loses every judgment when the provider blocks | 16 fixtures |
| Do separate calls classify better than a merged one? | Yes for crisis, by a margin that depends on the tier — 2–3 against 8 on Flash-Lite, 9 against 10 on Flash | 20 unseen recordings, 3 runs at Flash |
| Which lever matters more, the tier or the split? | **The tier.** Worth six detections merged and two dedicated; the split is worth one at the shipped tier | 20 unseen recordings |
| Was the earlier "merging is fine" finding wrong? | Yes. Its crisis cases were the ones the prompt had been tuned on, so it could not have found the effect | 16 fixtures vs 20 unseen |
| Does raising the model tier fix the crisis miss? | Very nearly, in either shape — merged 2–3 → 9, dedicated 8 → 10. The earlier "the tier changes nothing" result came from a script that never changed the model | both shapes, both tiers |
| Does more thinking help instead? | No — HIGH on Flash-Lite scores 3/10 against 2/10 without it, inside the band four Flash-Lite runs span | 20 unseen recordings |
| Does flipping the crisis question's polarity help? | No — 3/10 against 2/10, inside the same band. The shipped positive form is kept because it is the wording measured at 10/10 | 20 unseen recordings |
