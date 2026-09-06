# Spike scripts

The measurement scripts behind [docs/spike-002-guardrails.md](../../docs/spike-002-guardrails.md).
Kept as evidence of method — a result is not reproducible without the code that produced it, and
two of the spike's findings are prompt properties rather than model properties.

**These are not tests.** They call the live provider, cost money, and are excluded from
`make ai-checks` by design. The suites that gate the build mock at the SDK boundary
(research D12).

They need `@google/genai`, a production dependency since T001, and `GEMINI_API_KEY`. `pnpm install` is enough; do not `pnpm add` it again.

| Script | What it measured |
| - | - |
| `tts.js` | Generates the fixture recordings. Skips any that already exist |
| `spike2.js` | The original four separate calls across all 16 fixtures |
| `defaults.js` | Content processing with no `safetySettings` — the no-filter baseline |
| `constraints.js` | Whether Safari's `audio/mp4` and Chrome's `audio/webm` are accepted |
| `isolate.js` | Thresholds isolated from prompt, using the real illegal prompt |
| `probe.js` | The crisis prompt rewrite, and the relevance bleed |
| `merged.js` | One call returning everything |
| `lite3.js` | The shipped judgment call: three verdicts plus reason and audio quality |

Prompts here are the ones that were run. Where they differ from
[contracts/review.md](../../specs/002-contribution-review/contracts/review.md), the contract is
authoritative and the difference is a bug in one of them.
