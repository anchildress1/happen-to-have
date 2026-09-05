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
make test              # unit — schemas, gate precedence, retry bounds, rate-limit window
make test-integration  # fan-out with a faked provider; abort and release behaviour
make e2e               # the four screens, their copy and their actions
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
| Empty candidate is a fault | faked provider returns no candidate | retries, then `failed` — never `withheld` |

The `tax-evasion` row is the one people get wrong. Both outcomes withhold, so the test must
assert the **reason**, not just the rejection — otherwise FR-008g's bleed passes silently and the
participant reads the wrong sentence.

---

## ⚠️ Not proven — required before launch

Three measurements and one risk. None of them blocks writing the code; all of them block calling
it done.

### 1. Latency at the 60-second ceiling

The spike measured **2.4 s median, 3.6 s p90** — on **12–16 second** clips. A real submission
carries roughly four times the audio through four parallel calls.

SC-001's budget is 15 s median. Current evidence supports comfort, not compliance.

**Do**: record 60-second fixtures, run `--timing`, and if p95 approaches 30 s, revisit the
blocking-request decision ([research D8](research.md)) before building the flows on it.

### 2. Cost per contribution (SC-012)

Never measured. Four audio calls per answer, up to three invocations each under retry — the
worst case is 12 calls carrying a minute of audio.

**Do**: run `--cost` across the fixture set and record the figure. SC-012 requires it *before
interface work depends on it*, which means before 003 ships.

### 3. The crisis prompt is fitted to its own failing case

The `<examples>` block in [contracts/review.md](contracts/review.md) contains the exact recording
that defeated the previous wording. It now passes — but a prompt cannot be tested by an example
it was given.

The three near-miss controls (grief, metaphor, burnout) staying clean **is** real signal. The
understated-crisis catch is not.

**Do**: author fresh understated-crisis recordings that appear nowhere in the prompt, and require
them to pass. This is the one item on this page where being wrong causes harm outside the
software.

### 4. Rate limit values (FR-051)

`HTH_RATE_LIMIT_MAX=20` per hour is a starting guess, not a measurement, and FR-051 explicitly
forbids copying values from another product.

**Do**: walk a complete answer-then-ask cycle at participant pace once 003 and 004 exist, and set
the values from what that costs. Needs no code change — both are environment variables
([data-model.md](data-model.md)).
