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
pnpm install                # @google/genai is already a dependency
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
| `merged-judgment-call.json` | A merged judgment call: three verdicts, `primaryReason`, `audioQuality`. Retired — see below |

### The twenty unseen recordings

`crisis-generalization.ts` is a separate set from `cases.ts`: 10 understated-crisis recordings
and 10 near-miss controls, none of which appeared in any prompt. It exists because the sixteen
fixtures above could not test the crisis prompt — its crisis cases were the ones the prompt had
been tuned on.

| Result file | Shape | Model | Crisis prompt | Caught |
| - | - | - | - | - |
| `crisis-merged-gemini-3.5-flash-lite-canPublish.json` | merged | Flash-Lite | may-publish | 2/10 |
| `crisis-merged-gemini-3.5-flash-lite-detected.json` | merged | Flash-Lite | is-crisis | 3/10 |
| `crisis-merged-gemini-3.5-flash-lite-canPublish-HIGH.json` | merged | Flash-Lite, HIGH thinking | may-publish | 3/10 |
| `crisis-merged-gemini-3.5-flash-lite-canPublish-weigh.json` | merged | Flash-Lite | **+ how_to_weigh** | 2/10 |
| `crisis-merged-gemini-3.8-flash-canPublish.json` | merged | **Flash** | may-publish | 9/10 |
| `crisis-merged-gemini-3.8-flash-canPublish-weigh.json` | merged | **Flash** | **+ how_to_weigh** | **10/10** |
| `crisis-dedicated-gemini-3.5-flash-lite.json` | **dedicated** | Flash-Lite | is-crisis + how_to_weigh | 8/10 |
| `crisis-dedicated-gemini-3.8-flash.json` | **dedicated** | **Flash** | is-crisis + how_to_weigh | **10/10** |
| `crisis-dedicated-gemini-3.8-flash-Enceladus.json` | **dedicated** | **Flash** | same, **second voice** | **10/10** |

Zero false positives on the ten controls in every configuration. Every Flash row was run three
times with an identical result.

**Delivery does not move the result.** Every recording except the last row is Gemini TTS in
`Kore`, a firm delivery. `VOICE=Enceladus` regenerates all twenty in a breathy, quiet one —
about as unlike Kore as the prebuilt set gets, and closer to how someone understating a crisis
actually sounds. Same 10/10, same zero false positives, same cases. The check reads content, not
delivery, which is what the shape of these prompts predicts.

`VOICE` is an environment variable on both scripts. `Kore` keeps the bare filenames so the
baseline is never clobbered; any other voice suffixes both the recordings and the result file.

**The comparison was confounded until the last row existed.** The dedicated prompt carried a
`<how_to_weigh>` clause — *say yes when the signal is there, even if you are unsure* — that the
merged prompt had no equivalent of. Codex caught it on #23. With that clause added to the merged
prompt and nothing else changed, the two shapes are indistinguishable at the shipped tier.

| Lever | At Flash-Lite | At Flash |
| - | - | - |
| Move to the larger model | — | merged+weigh 2 → 10 |
| Give crisis its own call | 2 → 8 | **10 → 10, no effect** |
| Add `how_to_weigh` to a merged call | 3 → 2, no effect | 9 → 10 |
| Raise thinking to HIGH | 2 → 3, no effect | not run |
| Flip the question's polarity | 2 → 3, no effect | not run |

So: **the model tier is the whole story at Flash, and the call split is worth nothing there.**
The split is worth six detections on Flash-Lite, where the weighing clause does nothing — a
smaller model apparently cannot act on the instruction *and* carry three other judgments.

⚠️ **This is the evidence constitution 4.0.0 cited for "signals MUST NOT share a call", and at
the shipped tier it no longer supports that rule.** Left for a decision rather than acted on
here.

### ⚠️ Three of these files used to carry labels for runs that never happened

`crisis-generalization.js` passed its model and thinking arguments to the **output filename
only**, while hard-coding Flash-Lite with no thinking config. Three files therefore claimed
configurations that were never executed, and the merged-on-Flash number in every downstream
document was Flash-Lite's.

Both bots caught it on #23. The script now sends every argument to the request, the mislabeled
files are deleted rather than relabelled, and the rows above were re-measured. The conclusion
that survived is that the model tier matters *more* than the call split, which is the opposite
of what the mislabeled table implied.

## Regenerating

Scripts are in [`scripts/spike/`](../../scripts/spike). They need `@google/genai`, a production
dependency since T001, and `GEMINI_API_KEY`.

```bash
pnpm install                      # @google/genai is already a dependency
node scripts/spike/tts.js         # regenerates the 16 cases.ts recordings only
node scripts/spike/lite3.js       # the retired merged judgment call against all 16
# The twenty gen-* recordings are synthesized by crisis-generalization.js, not by tts.js,
# which only iterates cases.ts. Run it once before crisis-dedicated.js on a clean checkout.
# merged shape: [model] [polarity: detected|canPublish] [thinkingLevel] [weigh]
node scripts/spike/crisis-generalization.js gemini-3.8-flash canPublish
node scripts/spike/crisis-generalization.js gemini-3.8-flash canPublish weigh
node scripts/spike/crisis-dedicated.js gemini-3.8-flash    # the shipped crisis call
```

Every argument reaches the request, so a filename always describes the run that produced it.

Regeneration produces **different bytes**, so token counts and latency will shift. Verdicts should
not. If they do, that is a finding, not noise.

## Format caveat for the 60-second work

These are WAV because that is what the TTS model returns. Production sends neither: mobile Safari
records `audio/mp4` (AAC) and Chrome records `audio/webm` (Opus) — both verified accepted.

The 60-second fixtures that T080 needs should be recorded in those container formats, so the
latency and cost figures come from the path production actually takes.
