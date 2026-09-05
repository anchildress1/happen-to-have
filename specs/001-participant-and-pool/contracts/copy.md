# Contract: Participant-Facing Copy

**Feature**: 001-participant-and-pool | **Date**: 2026-09-04

Principle VII is only verifiable if the strings are fixed somewhere a reviewer can check them.
This is that place. Everything below is exact. The question mark in the product name is part of
the name.

---

## Fixed strings

| Key | String | Requirement |
| - | - | - |
| `product.name` | `Happen to Have?` | FR-006, FR-008 |
| `product.tagline` | `Answer one. Ask one.` | FR-006 |
| `action.findQuestion` | `Find me a question` | FR-007 |
| `action.canAnswer` | `I can answer this` | FR-014 |
| `action.tryAnother` | `Try another question` | FR-014 |

These five are asserted verbatim in E2E tests. A typo in the tagline is a failing test, not a
nit.

---

## From the design

Taken verbatim from the Claude Design source, Arrival and Question selection. These are design
decisions, not my inventions — change them in the design first.

Copy for the other nine screens is catalogued in [design.md](design.md) Part 2, per screen, with
its owning spec. It is not repeated here.

| Key | String | Where |
| - | - | - |
| `nav.yours` | `Yours` | Header, both screens |
| `arrival.helper` | `Sixty seconds, in your own voice. Once your answer counts, you can ask.` | Under the primary action, both breakpoints |
| `arrival.footer` | `Every question and every answer comes from a person.` | Desktop only, page footer |
| `selection.helper.mobile` | `Answer in your own voice. Up to 60 seconds.` | Mobile, under the question |
| `selection.helper.desktop` | `Answer in your own voice. Up to 60 seconds. Once your answer counts, you can ask one of your own.` | Desktop panel |

`arrival.footer` is the clearest statement of Principle I anywhere in the product. Keep it.

**Removed from the design**: the eyebrow label `Someone asked` above the question. No eyebrow
text appears anywhere in the product — see [design.md](design.md). The question stands on its own.

---

## Authored copy

Not in the handoff and **not in the design** — the design covers no empty, loading, or failure
state (see [design.md](design.md) *Gaps*). Written here so a reviewer checks copy in one file,
and flagged so a designer can replace it.

| Context | String | Source |
| - | - | - |
| Page title | `Happen to Have?` | Authored |
| Meta description | `A human advice exchange. Answer one question, then ask one of your own.` | Authored |
| Empty pool heading | `Nothing waiting right now` | Authored — needs design |
| Empty pool body | `There aren't any questions for you to answer right now. Check back in a bit.` | Authored — needs design |
| Single eligible question | `This is the only question waiting right now.` | Authored — pointer stays on the sole eligible question |
| Loading | `Finding you a question…` | Authored — needs design |
| Failure heading | `That didn't load` | Authored — needs design |
| Failure body | `Something on our end went wrong. Try again.` | Authored — needs design |
| Failure action | `Try again` | Authored — needs design |

---

## Prohibitions

Each is a grep a reviewer can actually run.

| Forbidden | Requirement | Why |
| - | - | - |
| "Who answers", "who will answer", "let me ask someone else" | FR-009 | Reframes the product as routing to experts. Wrong shape entirely. |
| "Marketplace", "expert", "expertise", "professional", "therapy", "counseling", "feed", "community feed" | FR-009 | Every one of these is a different product. |
| "Agent", "assistant", "bot", "AI-powered", "our AI" | FR-010 | The pipeline is not an agent and must never be described as one. |
| Dialect spelling — "y'all", "reckon", "fixin' to", "holler", dropped g's | FR-011 | Appalachia is the origin story, never a performance. |
| "Safe", "safely", "safe space", "keeping you safe" | FR-012 | Safety is expected infrastructure, not positioning. |

Two clarifications, because both have tripped people up:

- **"Happen to have"** appears in the product name and may appear in the origin story. That is
  the phrase the product is named after — it is not dialect performance.
- FR-011 forbids *generating or marketing* dialect. It does not restrict who may participate, and
  no copy may imply a regional audience.

---

## Voice

Plain, warm, short. Second person. The participant is a neighbor, not a user, a customer, or a
contributor.

- Say what happened and what to do next. Nothing else.
- Never apologize for a guardrail decision, and never argue with one.
- Never congratulate someone for helping. The exchange is the point; a gold star is not.
- No exclamation marks.

---

## Test obligations

| Behavior | Level |
| - | - |
| The five fixed strings render verbatim | E2E |
| Product name retains its question mark, including `<title>` | E2E |
| Design-sourced strings render verbatim at their breakpoint | E2E |
| `selection.helper` swaps between the mobile and desktop wording at 768px | E2E |
| Empty, loading, and failure copy renders in the right state | E2E |
| No forbidden term appears in any rendered route | E2E — case-insensitive scan of rendered text |
| No eyebrow label renders on any screen | E2E |
