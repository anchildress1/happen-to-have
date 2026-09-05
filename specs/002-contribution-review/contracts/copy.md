# Contract: Fixed Copy for 002

**Feature**: 002-contribution-review · **Date**: 2026-09-05

Every participant-facing string this feature renders. Taken verbatim from
[001's design.md](../../001-participant-and-pool/contracts/design.md); this file is the
implementation's source, design.md remains the design's.

Strings live in `src/copy.ts` beside 001's, so Principle VII is auditable in one place and no
string is authored at a call site.

**Nothing here is generated.** FR-032 and FR-034 require the crisis text be human-authored and
fixed, and the whole file follows that rule for consistency.

---

## Checking (FR-029)

Rendered while `reviewContribution()` is in flight. No header, no actions — deliberately
blocking. Watermark drops to `.05`.

| Element | String |
| - | - |
| Heading (answer) | `Checking your answer…` |
| Heading (question) | `Checking your question…` |
| Helper | `This usually takes a few seconds. Keep this page open.` |

Must announce via `aria-live` (design.md accessibility, and its 002 test obligation).

---

## Withheld — the five content variants (FR-024, FR-025, FR-026)

One shared page for every rejection reason (FR-024). The sub-line is identical across all five;
only the heading changes.

| Reason | Heading | Sub |
| - | - | - |
| `relevance` | `That response doesn't appear to answer this question. Try another.` | `It wasn't shared. Nothing else changes.` |
| `illegal` | `That response can't be shared here. Try another.` | `It wasn't shared. Nothing else changes.` |
| `content` — silence / empty | `We couldn't hear anything. Try recording again.` | `It wasn't shared. Nothing else changes.` |
| `content` — unintelligible / corrupt | `We couldn't make out the recording. Try recording again.` | `It wasn't shared. Nothing else changes.` |
| `content` — privacy / spam / harassment / other | `That recording can't be shared here. Try recording again.` | `It wasn't shared. Nothing else changes.` |

The relevance and illegal strings are fixed verbatim by FR-025 and FR-026 and must not be
reworded.

**Three `content` variants, selected by `contentReason`.** The content check returns
`'silence' | 'unintelligible' | 'unpublishable'` alongside its refusal
([data-model.md](../data-model.md)); those map to the three rows in order. Only the content check
can distinguish them, which is why the field exists rather than being inferred at render time.

| `contentReason` | Heading |
| - | - |
| `silence` | `We couldn't hear anything. Try recording again.` |
| `unintelligible` | `We couldn't make out the recording. Try recording again.` |
| `unpublishable` | `That recording can't be shared here. Try recording again.` |

A rejection that arrives without a `contentReason` — a schema-valid model response that omitted it
— falls back to `unpublishable`, which is true of all three.

**When content processing was lost to a provider block**, there is no `contentReason` at all. The
judgment call's `audioQuality` selects instead (FR-008h): `silent` → the first row,
`unintelligible` → the second, `clear` → the third. This changes the message only; a lost
transcript never publishes.

⚠️ That mapping is unexercised — every fixture is a clear recording, so `silent` and
`unintelligible` have never been produced. Until they are, prefer the third row
([quickstart.md](../quickstart.md)).

FR-027 governs tone: short, non-argumentative, and never explaining, justifying, or debating the
decision. None of these strings tells the participant what they did.

### Actions (FR-027a, FR-027b)

| Contribution | Primary | Destination | Ghost | Destination |
| - | - | - | - | - |
| Answer | `Record another answer` | `/answer/record?questionId=<same>` | `Try another question` | `/answer` |
| Question | `Record another question` | `/ask` | `Back` | `/ask` unlocked state |

Retry always records anew — no withheld recording is reprocessed (FR-027a). The question retry
keeps the earned ask intact (FR-027b) and must start a question recorder, never an answer one
(US2 scenario 6c).

---

## Withheld — crisis (FR-032, FR-033, FR-034)

Same page, `30px` heading, resources added. The fresh-recording action stays, because the
classification can be wrong (FR-027c).

| Element | String |
| - | - |
| Heading | `It sounds like you might be going through something serious right now.` |
| Body | `This isn't the right place for that, but these people are, any hour.` |
| Primary | `Record another answer` / `Record another question`, per the originating flow |
| Ghost | `Back to questions` for answers; `Back` for questions |

Resources — static, human-authored, all four rows always rendered:

| Name | Qualifier | Value |
| - | - | - |
| `988 Suicide & Crisis Lifeline` | `United States · call or text` | `988` |
| `Crisis Text Line` | `United States · text` | `HOME to 741741` |
| `Find a Helpline` | `International directory` | `findahelpline.com` |
| `Emergency` | `If someone is in immediate danger` | `Local number` |

US **and** international satisfies FR-033. Nothing is generated and nothing claims intervention,
satisfying FR-034.

**Reachable without earning an ask** (FR-035). The resources are a component, not a route behind
the reciprocity gate.

Resources and retry are visible together — the participant does not dismiss one to reach the
other.

---

## Processing failed (FR-040)

Appears only after retry exhaustion or deadline expiry — never for a Withheld outcome.

| Element | String |
| - | - |
| Heading (answer) | `We couldn't check your answer.` |
| Heading (question) | `We couldn't check your question.` |
| Helper | `Something on our side didn't finish. Your recording was discarded. You can record again.` |
| Lost response | `We couldn't confirm what happened. Check Yours before recording again.` |
| Primary (answer) | `Record another answer` → `/answer/record?questionId=<same>` |
| Primary (question) | `Record another question` → `/ask` |
| Ghost (answer) | `Try another question` → `/answer` |
| Ghost (question) | `Back` → `/ask` unlocked state |

`Something on our side didn't finish` puts the fault where it belongs. FR-040 forbids blaming the
participant or promising recovery of the previous audio, and the helper does neither — it states
plainly that the recording is gone.

---

## Rate limited (FR-049)

| Element | String |
| - | - |
| Heading | `You've sent a lot today. You can record again at <time>.` |
| Helper | `Everything you've already sent is still being checked or is published. Listening is always open.` |
| Muted | `Go to Yours` |

`<time>` is interpolated from `ReviewOutcome.retryAt`, which is why that field exists — FR-049
requires the response state *when* the participant may try again, not merely that they cannot.

`Listening is always open` confirms the limit covers submission only, never playback.

---

## Forbidden vocabulary

Principle VII, checked against every string above:

| Never | Why |
| - | - |
| "who answers" framing | marketplace / expert-network positioning |
| "let me ask someone else" | delegation is out of scope |
| "safe" as positioning | safety is expected infrastructure, not a feature |
| Appalachian dialect or region words | origin story only; never generated or marketed |
| "Busy Bees" | origin-story context, never product name |
| Generated counseling or reassurance in the crisis variant | FR-034 |

None of the strings above contains any of them. The `content` variants say `can't be shared here`
rather than anything implying a safety product, and the crisis body routes outward instead of
counseling.
