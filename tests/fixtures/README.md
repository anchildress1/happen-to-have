# Guardrail fixtures

The 16 recordings and adjudicated labels behind every measured claim in
[docs/spike-002-guardrails.md](../../docs/spike-002-guardrails.md) and
[specs/002-contribution-review/research.md](../../specs/002-contribution-review/research.md).

Committed because a number in a document is not evidence unless the input that produced it still
exists. The source text and labels are here; the audio regenerates from them.

## Contents

| Path | What | Committed |
| - | - | - |
| `cases.ts` | Each fixture's id, kind, question, source text, and adjudicated verdict | yes |
| `results/*.json` | Raw provider responses from each experiment, with token counts and latency | yes |
| `audio/*.wav` | 16 recordings, 12–16 s, 24 kHz 16-bit mono | **no — generated locally** |

**The audio is not in the repository.** `.gitignore` blocks `*.wav` under a deliberate rule —
*"original recordings must never be committed"* — which enforces Principle IV. These fixtures are
synthetic rather than participant audio, so they are not what that rule aims at, but the guard is
worth more than the convenience of shipping 8 MB of binaries.

The text in `cases.ts` **is** the fixture. The audio is derived from it, so run `tts.js` once
after cloning:

```bash
pnpm add @google/genai      # T001
node scripts/spike/tts.js   # writes any missing recording; existing files are skipped
```

**The recordings are synthetic.** Every one was generated with `gemini-3.1-flash-tts-preview`
(voice `Kore`) from text written for the test set. No participant audio exists in this repository
and none ever should — original recordings are transient by constitutional rule (Principle IV).

Several fixtures describe illegal acts or personal crisis. That is the point: they are the inputs
the guardrails must reject, and a test set of benign recordings proves nothing.

## The labels are ground truth, not model output

`expect` in `cases.ts` is human-adjudicated. **Changing a label to make a test pass inverts what
this file is for.** If a check disagrees with a label, either the check is wrong or the label was
wrong — decide which, and record why.

## The cases that earned their place

| Fixture | Why it exists |
| - | - |
| `hunt-benign` / `firearm-no-permit` | Compositional pair. Same topic, opposite verdicts. A check that cannot separate them measures topic, not legality |
| `crisis-question` | Understated crisis. Defeated the first crisis prompt, and a higher model tier did not fix it |
| `grief-not-crisis`, `metaphor-not-crisis` | Near-misses that must NOT trip. Grief and "that job was killing me" |
| `tax-evasion`, `violence-instruction` | Passed the provider's own filtering entirely |
| `irrelevant-adjacent` | Off-topic but warm and on-theme — the relevance case that is easy to get wrong |

## Results

| File | Experiment |
| - | - |
| `baseline-four-call.json` | The original four separate calls, per-check verdicts and latency |
| `default-thresholds.json` | Content processing with no `safetySettings`. Since the adjustable filters ship off by default, this is the no-filter baseline |
| `merged-single-call.json` | One call returning everything. Scored well and lost every judgment on the two recordings the provider blocks |
| `merged-judgment-call.json` | The shipped shape's judgment call: three verdicts, `primaryReason`, `audioQuality` |

## Regenerating

Scripts are in [`scripts/spike/`](../../scripts/spike). They need `@google/genai` — **not yet a
dependency** (task T001) — and `GEMINI_API_KEY`.

```bash
pnpm add @google/genai            # T001
node scripts/spike/tts.js         # regenerate any missing recording; existing files are skipped
node scripts/spike/lite3.js       # the shipped judgment call against all 16
```

Regeneration produces **different bytes**, so token counts and latency will shift. Verdicts should
not. If they do, that is a finding, not noise.

## Format caveat for the 60-second work

These are WAV because that is what the TTS model returns. Production sends neither: mobile Safari
records `audio/mp4` (AAC) and Chrome records `audio/webm` (Opus) — both verified accepted.

The 60-second fixtures that T080 needs should be recorded in those container formats, so the
latency and cost figures come from the path production actually takes.
