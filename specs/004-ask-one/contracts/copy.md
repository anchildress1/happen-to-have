# Contract: Copy — Ask One

**Feature**: 004-ask-one · **Date**: 2026-09-06

Every participant-facing string this feature adds. 002 owns checking, Withheld, crisis,
processing failure and the rate limit; 003 owns recording. Those are consumed and are not
repeated here — but their **question variants** are used for the first time, and this contract
says which.

---

## Already in `src/copy.ts`, unused until now

002 wrote the copy object for two flows and only one was built. These keys exist, are swept by
`tests/unit/copy.test.ts`, and have never rendered:

| Key | String |
| - | - |
| `review.checking.headingQuestion` | `Checking your question…` |
| `review.withheld.actionQuestion` | `Record another question` |
| `review.withheld.ghostQuestion` | `Back` |
| `review.crisis.ghostQuestion` | `Back` |
| `review.failed.headingQuestion` | `We couldn't check your question.` |

**Do not author replacements for these.** They are the contract, and the outcome view is
parameterized by kind precisely so both flows read the same object
([research D5](../research.md)).

---

## Ask unlocked (FR-004a)

The screen 003's `Ask your question` button leads to. Fixed by the design contract, which
carries it under a `003 —` heading that its own route map contradicts; the route map is
correct.

| Element | String |
| - | - |
| Heading | `Your answer counts.` / `Ask one.` — line break on mobile, one line on desktop |
| Helper | `Your answer is published. You have one question to ask, whenever you're ready.` |
| Primary | `Ask a question` |
| Ghost | `Not now — it'll keep` → `/answer` |

**`Not now — it'll keep` is Principle II in the participant's language**, and its destination is
what makes it true: the ask is held, not spent, until a question is created. The ghost must
lead somewhere that does not consume it.

---

## Recording a question (FR-005 – FR-008a)

| Element | String |
| - | - |
| Heading | `What do you happen to need?` |
| Helper | `Say it plainly, the way you'd ask a neighbor. Up to 60 seconds. People will answer in their own voices.` |
| Timer | `<elapsed>s of 60s` — `copy.review.recording.timer(elapsed, limit)`, shared with 003 |
| Reached the ceiling | `That's the minute. Share it, or record again.` — shared with 003 |
| Footnote | `Your ask is used only once the question is published.` |
| Submit | **new** — `Share this question` |

**Only the submit label is new.** Start, Stop, `Record again`, the timer, the ceiling line and
all three microphone-failure states are 003's and are reused verbatim through `useRecorder`.
A question-specific `Start recording` would be two strings for one control.

**The footnote is the participant-facing form of FR-016.** It is the reassurance that makes
recording feel safe to abandon, and it is true: nothing is consumed until the insert.

---

## Published (FR-015a) — **new, and the design does not cover it**

The design contract carries `/ask` unlocked, `/ask` recording, Withheld, crisis, processing
failure and the rate limit. It has **no published-question state at all**. This is authored
here rather than imported, and it is the only screen in the feature with no visual reference.

| Element | String |
| - | - |
| Heading | `Your question is out there.` |
| Helper | `That's your ask spent. Answer another question to earn the next one.` |
| Primary | `Find me a question` → `/answer` |
| Ghost | `Yours` → `/yours` |

**The heading states what happened, not how it felt.** `Shared. Thank you.` is the substitution
003 caught itself making — friendlier, and silent about the rule the screen exists to close.

**The helper names the spend before it names the next step.** A participant who does not learn
the ask is gone here learns it at `/ask` two minutes later, from a redirect with no explanation.

**The primary action returns to answering, not to `/yours`.** The loop is the product: you
spent it, go earn another. `/yours` stays reachable as the ghost, and 005 is what makes it
worth visiting.

`Find me a question` is 001's existing `copy.action.findQuestion`, reused rather than reworded.

---

## Ask already spent (research D6) — **new**

The two-tab case. One tab published; the other recorded afterwards and submitted.

| Element | String |
| - | - |
| Heading | `Your ask is already spent.` |
| Helper | `A question from you is already out there. Answer another one to earn your next ask.` |
| Primary | `Find me a question` → `/answer` |
| Ghost | `Yours` → `/yours` |

**This must not reuse the processing-failure page.** Its helper — *Something on our side didn't
finish. Your recording was discarded. You can record again.* — gets the fault wrong and then
instructs the participant to do something the server will refuse.

**It does not apologise and does not offer a retry.** Nothing went wrong. The ask bought a
question; this recording simply arrived after it.

---

## Withheld, crisis, and processing failure — destinations

002 owns every string. 004 owns where the buttons go.

| State | Primary | Ghost |
| - | - | - |
| Withheld (any reason) | `Record another question` → `/ask`, fresh recording, ask intact | `Back` → `/ask` unlocked state |
| Crisis | `Record another question` → `/ask` | `Back` → `/ask` unlocked state |
| Processing failure | `Record another question` → `/ask` | `Back` → `/ask` unlocked state |
| Rate limited | `Go to Yours` → `/yours` | — |

**Every retry lands on `/ask` with a fresh recording and the ask intact** (FR-021). Unlike
003's retry, no question id travels — there is no prior question to return to, which is the
whole difference between the flows.

**On the crisis page the retry sits alongside the resources, never behind them.** The
classification can be wrong, and nobody should have to dismiss an offer of help to reach the
control that lets them try again. Constitution III.

---

## Forbidden here, as everywhere

No "who answers" framing, no marketplace or expert language, nothing describing the pipeline as
an agent, bot or assistant, no generated dialect, no positioning on "safe", no therapy or feed
framing, no Appalachian dialect, no "Busy Bees". Constitution VII, swept by
`tests/unit/copy.test.ts` over every string in the file — including the two new blocks above,
automatically, because the sweep walks the object.
