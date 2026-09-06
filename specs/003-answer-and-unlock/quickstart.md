# Quickstart: Answer One

**Feature**: 003-answer-and-unlock · **Date**: 2026-09-06

How to prove each success criterion, and what is honestly not proven yet.

---

## Run it

```bash
make install
make db-up && make migrate && make seed
make dev            # http://localhost:3000/answer
```

`GEMINI_API_KEY` must be set or every submission returns `failed` — correctly, but it will look
like a bug for the thirty seconds it takes to notice.

```bash
make ai-checks      # format, lint, typecheck, unit, integration, secrets
make e2e            # Playwright against a disposable Neon branch
```

---

## Proving the success criteria

| SC | How | Where |
| - | - | - |
| **SC-002** ceiling holds, nothing lost | record past 60 s in each project; assert the recorder stopped and the blob is non-empty | e2e |
| **SC-003** exactly one ask | publish an answer from a participant with `can_ask` false, then again with it true; assert `askGranted` true then false | integration |
| **SC-004** no ask before a decision | call the ask-eligibility read while a submission is in flight | integration |
| **SC-005** never more than one | repeat qualifying answers; assert `can_ask` never leaves `true` and no second grant is reported | integration |
| **SC-006** own/answered refused server-side | call `publishAnswer` directly, bypassing the interface entirely | integration |
| **SC-007** duplicates and retries | two concurrent submissions with one `submissionId`, then a repeat after a "lost" response | integration |
| **SC-008** no minimum duration | a five-second recording publishes | integration + e2e |
| **SC-010** dead-screen-free failures | deny permission, remove the device, stub `MediaRecorder` away | e2e |

**SC-006 is tested by calling the query directly, not through the route.** Testing it through
the interface proves the interface hides the button. The requirement is that the server refuses
regardless of what the interface allowed, and only a direct call asks that question.

---

## ⚠️ Not proven — required before launch

Five gaps, each with a threshold so "go check it" has a pass and a fail.

### 1. Real browsers, real microphones (SC-009)

Everything is Playwright with a faked media stream. No real microphone has ever recorded into
this app.

| Budget | Pass |
| - | - |
| Current iPhone Safari | permission grant, 60 s recording, publishes |
| Current Android Chrome | same |

**Fail action**: this is the feature. There is no shipping around it.

### 2. Bytes per second, per browser ([research D3](research.md))

The server's duration check is a byte-length bound with no measured basis. 002's 5 MB ceiling
is ~10x the worst measured case — enough to stop abuse, far too loose to infer a duration.

| Budget | Pass |
| - | - |
| 60 s recorded in each target browser | byte range recorded, and the check narrowed to it |

**Fail action**: keep the bound as a bound, and say so in the contract rather than implying a
verification it does not perform.

### 3. The minute on a real phone (US2 scenario 5)

A backgrounded tab, a locked screen, and an incoming call all end a recording differently, and
none of them happen in a headless browser.

| Budget | Pass |
| - | - |
| Lock the screen mid-recording | whatever was captured is submittable or discarded cleanly, never ambiguous |

### 4. Latency at the ceiling — inherited from 002 (T080)

SC-001's three minutes is dominated by the review fan-out, measured at 2.4 s median on 12–16 s
clips and never re-measured at 60 s, which carries four times the audio.

### 5. Concurrent unlock across two devices

The spec's own assumption. Two simultaneous passing answers from one participant must leave one
unspent ask. The single-statement grant should make this true by construction; *should* is not
a measurement.

| Budget | Pass |
| - | - |
| Two answers to different questions, submitted together | exactly one grant reported, `can_ask` true |

---

## Settled — do not re-litigate

| Question | Answer | Evidence |
| - | - | - |
| Ledger or boolean for the ask? | Boolean. A counter can represent a state the product has no meaning for | [D1](research.md) |
| Can eligibility be a read-then-write? | No. Every rule is a race | [D2](research.md) |
| Is the unique constraint enough for idempotency? | No — it handles the double-tap and fails the retried upload | [D4](research.md) |
| Is `<>` fine for the own-question check? | No. NULL author means it drops every seeded question | [D2](research.md) |
| One failure state for recording problems? | No. Three causes, three next actions | [D5](research.md) |
| Can the format be hard-coded? | No. Safari has no WebM; Chrome has no MP4 | [D6](research.md) |
