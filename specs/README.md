# Specs — Happen to Have?

Five specs. Build in numeric order; each depends only on lower numbers.

| # | Spec | Owns |
|---|------|------|
| 001 | [participant-and-pool](001-participant-and-pool/spec.md) | Anonymous identity, landing, seeded pool, selection, skip, empty states |
| 002 | [contribution-review](002-contribution-review/spec.md) | The per-signal review fan-out, aggregate decision, shared result page, crisis routing, retry, audio lifecycle, rate limiting |
| 003 | [answer-and-unlock](003-answer-and-unlock/spec.md) | Answer recording, 60s ceiling, checking state, **granting** one ask |
| 004 | [ask-one](004-ask-one/spec.md) | Question recording, publication, **consuming** the ask, question lifecycle and closure |
| 005 | [yours-and-playback](005-yours-and-playback/spec.md) | `Yours` history, flat responses, lazy generated playback |

## Dependency graph

```mermaid
%%{init: {'theme':'default'}}%%
graph TD
    accTitle: Happen to Have? spec dependency graph
    accDescr: Five specs. 001 and 002 are foundations. 003 depends on both. 004 depends on 002 and 003. 005 depends on 002, 003 and 004.
    S001["001 participant-and-pool"]
    S002["002 contribution-review"]
    S003["003 answer-and-unlock"]
    S004["004 ask-one"]
    S005["005 yours-and-playback"]
    S001 --> S002
    S001 --> S003
    S002 --> S003
    S002 --> S004
    S003 --> S004
    S002 --> S005
    S003 --> S005
    S004 --> S005
    S004 -. "closure state" .-> S001
```

## Design system

One design covers all 11 screens across all five specs:
[`001-participant-and-pool/contracts/design.md`](001-participant-and-pool/contracts/design.md).

001 builds the foundation — tokens, header, buttons, watermark, list rows — and 002–005 assemble
their screens from it. Route map, per-screen copy, and component specs all live there. Do not
re-derive any of it per spec.

Source: Claude Design project `Happen to Have UI mockups`. The `ios-frame.jsx` and
`browser-window.jsx` wrappers in that project are canvas staging and never ship.

## Ownership boundaries

Rules that touch more than one spec are defined once and referenced elsewhere:

- **Ask granting** → 003. **Ask consumption** → 004. Neither restates the other.
- **Question closure rule** → 004. 001 honors the resulting closed state.
- **Review, Withheld page, crisis resources, independent check retries, audio deletion** → 002.
  003 and 004 supply contribution-specific fresh-recording routes; crisis also permits retry.
- **Persistence** → only published contributions enter the database and Yours; no retained attempts.
- **Selection** → 001 uses strict answer-count order and a tab-local pointer with wraparound.
- **Seeds** → Ashley supplies the content; authorship and recording provenance remain TBD.
- **Recording behavior** → 003. 004 reuses it rather than respecifying it.
- **Answer eligibility** appears twice on purpose: 001 controls what is *shown*, 003 controls what is *accepted*. The server-side refusal in 003 is the one that matters.
- **Original-recording prohibition** appears twice on purpose: 002 forbids retention, 005 forbids offering it in the interface.

## Handoff validation coverage

The handoff's validation cases map to the specs below; this is planned coverage, not executed proof:

| Case | Spec |
|------|------|
| Recording stops at 60s | 003, 004 |
| Short answer can qualify | 003 |
| Irrelevant answer does not unlock | 002, 003 |
| Silence does not unlock | 002 |
| Unintelligible does not unlock | 002 |
| Guardrail failure does not unlock | 003 |
| Passing answer unlocks exactly one | 003 |
| Second question needs another answer | 004 |
| Failed checks retry independently; exhausted submissions offer a fresh recording | 002, 003, 004 |
| Non-English produces valid text | 002 |
| Identifying info removed | 002 |
| Crisis is Withheld with resources and a fresh-recording action | 002, 003, 004 |
| Illegal withheld with distinct text | 002 |
| Provider's own safety filter is insufficient on its own | 002 — proven, spike |
| Cannot answer own question | 001, 003 |
| No repeat question after answering | 001, 003 |
| Multiple answers, no ranking | 005 |
| Unanswered questions stay open | 004 |
| Closes after 3 answers from 3 participants | 004 |
| Original audio not publicly reachable | 002 |
| Playback does not block publication | 005 |
| Skipping never grants an ask | 001 |
| Rate limiting covers a full cycle | 002 |

## Weekend build order

The kill spike ran on 2026-09-05, scoped down to the guardrail checks
([results](../docs/spike-002-guardrails.md)). It found the provider returns no safety ratings
and its adjustable filters ship off by default, so nothing screens a contribution unless 002
does — which it now does in one parallel call per signal: four for an answer, three for a
question, with crisis on the content tier. The constitution was amended to 4.0.0. Fan-out latency
measured 2.4s median and 3.6s p90 on 12–16 second clips of the earlier two-call shape; cost, and
latency at both the 60-second ceiling and the wider fan-out, remain unmeasured.

Day 1 → 001, 002, 003. Day 2 → 004, 005, deploy, demo.
