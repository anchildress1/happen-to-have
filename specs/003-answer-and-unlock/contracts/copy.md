# Contract: Copy — Answer One

**Feature**: 003-answer-and-unlock · **Date**: 2026-09-06

Every participant-facing string this feature adds. 002 owns checking, Withheld, crisis,
processing failure and the rate limit; those are consumed verbatim and are not repeated here.

---

## Published (FR-020)

| Element | String |
| - | - |
| Heading | `Your answer counts. Ask one.` |
| Helper — no ask held before | `That's one question you can ask, whenever you're ready.` |
| Helper — an ask was already held | `Your question is still waiting for you.` |
| Action | `Ask your question` |
| Ghost | `Answer another` |

**The heading is fixed verbatim by FR-020 and MUST NOT be reworded.** It is the one screen that
states the product's rule back to the participant, and it is the sentence the whole feature
exists to earn.

**The two helpers are separate because the outcomes are separate.** A passing answer from
someone already holding an ask grants nothing (FR-021). Showing the granted line there would
claim something that did not happen.

---

## Recording (US2, FR-005, FR-007)

| Element | String |
| - | - |
| Start | `Start recording` |
| Stop | `Stop` |
| Re-record | `Record again` |
| Submit | `Share this answer` |
| Timer | `<elapsed>s of 60s` |
| Reached the ceiling | `That's the minute. Share it, or record again.` |

**The ceiling line says what happened and offers both ways forward.** FR-007: a recording that
stopped because the limit was reached is not a failure, and copy that reads like one loses an
answer the participant already gave.

---

## Recording will not work (FR-028, FR-029)

| Case | Heading | Helper |
| - | - | - |
| Permission denied | `We need your microphone to hear you.` | `Allow microphone access for this site in your browser settings, then try again.` |
| No microphone found | `We can't find a microphone.` | `Connect one, or try a different device.` |
| Browser cannot record | `This browser can't record audio.` | `Try Safari on iPhone, or Chrome on Android or desktop.` |

**Three states, not one.** They have three causes and three different next actions
([research D5](../research.md)). The built code reused the processing-failure helper for
denial, which tells someone *something on our side didn't finish* when their browser refused —
wrong fault, and an instruction they cannot act on.

**The unsupported case renders instead of the control, not after it.** FR-029 forbids
presenting a control that does nothing.

---

## Retry after a Withheld (FR-027a)

Every Withheld outcome, **including crisis**, offers a fresh recording for the same question:

```
/answer/record?questionId=<the same question>
```

002 owns the Withheld and crisis strings. What 003 owns is the destination, and it must carry
the question — a retry that lands on an empty recorder is not the retry FR-027a guarantees.

On the crisis page the retry sits **alongside** the resources, never behind them. The
classification can be wrong, and nobody should have to dismiss an offer of help to reach the
control that lets them try again.

---

## Forbidden here, as everywhere

No "who answers" framing, no marketplace or expert language, nothing describing the pipeline as
an agent, bot or assistant, no generated dialect, no positioning on "safe", no therapy or feed
framing. Constitution VII, swept by `tests/unit/copy.test.ts` over every string in the file.
