# Contract: Copy — Yours and Playback

**Feature**: 005-yours-and-playback · **Date**: 2026-09-07

Every participant-facing string this feature adds, plus the ones it reuses without rewording.
001 owns `Yours` as a nav label; 002 owns the review outcomes; 003 owns recording; 004 owns
`/ask`. None of those strings are repeated here.

`tests/e2e/copy.spec.ts` already lists `/yours` in its `ROUTES`, so this screen falls under the
rendered-text sweep the moment it renders anything. `tests/unit/copy.test.ts` sweeps the object
itself, including the output of function-valued entries.

---

## Already in `src/copy.ts`, reused rather than reworded

| Key | String | Used for |
| - | - | - |
| `nav.yours` | `Yours` | The page H1 and the header link. **Do not add a second `Yours`.** |
| `product.name` | `Happen to Have?` | Composed into the document title |
| `action.findQuestion` | `Find me a question` | The action out of the `Your Answers` empty state |
| `ask.unlocked.action` | `Ask a question` | The action out of the `Your Questions` empty state, when an ask is held |
| `failure.action` | `Try again` | The audio-only retry (FR-033) |

`AppHeader.tsx` currently hardcodes `'Yours'`. It reads `copy.nav.yours` after this feature
([plan.md D-2](../plan.md)) — same string, one source.

---

## The object, paste-ready

Appended to `src/copy.ts` as the last block, after `review`.

```ts
  /**
   * 005. Every string at `/yours`, from specs/005-yours-and-playback/contracts/copy.md.
   *
   * The page H1 and the header link are both `nav.yours` — there is no second `Yours`
   * here. `Your Answers` and `Your Questions` are fixed by FR-001 and are the only two
   * sections that exist; a third section is a spec change, not a copy change.
   */
  yours: {
    answers: {
      /** FR-001, FR-004. Fixed verbatim by the spec, capitalization included. */
      heading: 'Your Answers',
      /** FR-006. The only status a history entry can carry — nothing unpublished is a row. */
      published: 'Published',
      /** FR-009. Points at answering, because that is the only way an entry gets here. */
      empty: {
        heading: 'No answers yet',
        body: 'Answer a question and it lands here, next to the question it answered.',
      },
    },

    questions: {
      /** FR-001, FR-010. Fixed verbatim by the spec, capitalization included. */
      heading: 'Your Questions',
      /**
       * FR-012. A function so the vocabulary sweep reaches it — allStrings() invokes
       * function-valued entries with one string argument, so this must stay safe to call
       * with anything and must not put a word next to the interpolation that a sweep
       * could catch.
       */
      responseCount: (count: number) => (count === 1 ? '1 response' : `${count} responses`),
      /** FR-016. Points at the loop: earn an ask, spend it, the question shows up here. */
      empty: {
        heading: 'No questions yet',
        body: 'Answer one to earn an ask. The question you spend it on lands here, with everything that comes back.',
      },
      /**
       * FR-016, US1 scenario 7. Per question, not per screen: the participant has published,
       * and nobody has answered yet. Says only that, and promises no arrival.
       */
      noResponses: 'Nothing has come back yet.',
    },

    playback: {
      /** FR-014. Fixed verbatim by the spec. */
      listen: 'Listen',
      /** FR-032. Rendered in that one response's status region, never page-level. */
      loading: 'Getting the audio ready…',
      /**
       * FR-032. Added after review: yours-view.md §5 requires a `playing` state and this
       * file did not author a string for it, so the two contracts disagreed. Without a
       * visible `playing`, that state rendered byte-identically to `idle` — enabled button,
       * same label, empty status — and a participant part-way through sixty seconds of
       * speech pressed Listen again and got a second voice over the first.
       */
      playing: 'Playing…',
      /**
       * FR-033. Names what failed and nothing else. The response's text is on screen
       * beside it, so the string must not imply the text is gone — and it must not
       * describe how audio is made (Principle I).
       */
      failed: "That didn't play.",
      /** FR-034. The 503 case: no retry is offered, and only this control degrades. */
      unavailable: "Listen isn't available right now.",
    },
  },
```

---

## Page heading and document title

| Element | String | Source |
| - | - | - |
| H1 | `Yours` | `copy.nav.yours` |
| `<title>` | `Yours · Happen to Have?` | `` `${copy.nav.yours} · ${copy.product.name}` `` in the route's `metadata` |

`app/page.tsx` sets `title: copy.product.name`; this composes the same way rather than
hardcoding a second product name. **No new key.** A page-level heading string that duplicates
the nav label is the one guaranteed to drift.

---

## Section headings (FR-001, FR-004, FR-010)

`Your Answers` and `Your Questions`, exactly. Both are quoted character-for-character in FR-001,
FR-004 and FR-010, including the capital letters.

**Not `Answers you gave` / `Questions you asked`.** Warmer, and it desynchronizes the copy from
the three FRs that quote it. When a spec quotes a string, the string is the contract.

---

## `Published` (FR-006)

One word, on every listed answer. It is a **label, not a status among several** — pending,
withheld, failed and abandoned submissions have no row and no entry (FR-008, FR-021), so there
is nothing for it to contrast against. It is there because FR-006 requires the participant be
told the thing reached someone.

---

## Response count (FR-012)

`1 response` / `3 responses`. A function, for two reasons.

1. **Singular/plural.** `3 response(s)` is the shape of a form, not a sentence.
2. **The sweep only reaches function output by invoking it.** `review.rateLimited.heading` was
   uninspected until `allStrings` started calling functions; anything interpolated must be
   callable by that sweep. It passes the single string `'4:30 PM'`, so `responseCount('4:30 PM')`
   returns `4:30 PM responses` — nonsense, and deliberately harmless: no banned word appears
   next to the interpolation regardless of what is substituted in.

**No `0 responses`.** Zero renders `questions.noResponses` instead — `0 responses` is a true
statement rendered as a tally, which reads as a score on a screen whose whole job is to carry no
score (FR-018 – FR-020).

---

## Empty states

### `Your Answers`, none published (FR-009)

> **No answers yet**
> Answer a question and it lands here, next to the question it answered.

The body states the mechanism, and the action beneath it is `Find me a question` — 001's
existing string, reused. **Does not apologize and does not congratulate.** Nothing has gone
wrong; the participant is new.

### `Your Questions`, none published (FR-016)

> **No questions yet**
> Answer one to earn an ask. The question you spend it on lands here, with everything that comes back.

`Answer one to earn an ask` echoes the tagline without quoting it. The sentence covers **both**
states — no ask held, and an ask held and unspent — which is why it names earning and spending
in one line rather than branching. Branching would need the page to know the ask state to pick a
string, for a difference the participant reads as identical.

`with everything that comes back` is the promise `Yours` exists to keep, stated once.

### A published question with no responses (FR-016, US1 scenario 7)

> Nothing has come back yet.

Per question, inside the question's own entry. The spec's own words.

**Rejected: `Nothing yet — check back soon.`** A question closes after enough answers (FR-015)
and the product sends no notification (Assumptions: freshness). "Soon" is a promise the system
cannot keep and does not track.

---

## Playback states

The three states live in **one status region per response**, and only one renders at a time.

| State | Trigger | String | Retry? |
| - | - | - | - |
| Loading (FR-032) | `Listen` pressed, request in flight | `Getting the audio ready…` | — |
| Failed (FR-033) | `502` — production failed this time | `That didn't play.` + `Try again` | **Yes**, audio only |
| Unavailable (FR-034) | `503` — playback unavailable entirely | `Listen isn't available right now.` | **No** |

The status codes are [research D5](../research.md)'s table. The copy draws the same line the
codes do: a `502` is worth pressing again, a `503` is not.

**`That didn't play.` does not say the text is fine.** It does not need to — the text is on
screen next to it, unchanged, which is FR-033 satisfied by layout rather than by reassurance.
Adding *"You can still read it below"* would explain a thing the participant is already looking
at.

**The retry is `failure.action` — `Try again`.** Same word, same act. A playback-specific
`Try the audio again` states in the label what its placement already states: the control sits
inside one response's status region and can only re-request that response's audio.

**Nothing in these three strings describes how the audio is made.** Not the voice, not the
model, not the fact that it is produced on demand. See the traps below.

---

## Banned vocabulary — the traps this screen walks past

`tests/unit/copy.test.ts` matches its list on case-insensitive Unicode word boundaries, so a
term fires on the bare word and not inside a longer one. The list is not advisory.

| Reached for | Term | Why it fires | Shipped instead |
| - | - | - | - |
| `Your feed`, `Activity feed`, `Your history feed` | **`feed`** | A reverse-chronological personal list *is* the shape a feed has, which is exactly why the reflex is strong here. It is also the social-product framing Principle VII forbids | `Your Answers` and `Your Questions` — two named sections, no third framing above them |
| `Your answers are safe here`, `Your history is safe` | **`safe`** | Safety as positioning. Bare `safe` is on the list, not only the longer phrasings | Nothing. The claim is not made |
| `See who answered`, `Here's who answered` | **`who answers`** (unit) / **`who will answer`** (e2e) | Reframes the product as routing to a person. Responses carry no attribution at all | `responseCount()` — how many, never who |
| `Answers from real people, not experts` | **`expert`**, plus **`expertise`** and **`professional`** in the e2e sweep | Naming what the product is not still puts the frame on the page | Nothing. Principle I is stated at `/`, not repeated here |
| `Our AI reads it aloud`, `AI voice`, `AI-generated audio`, `Let the assistant read it` | **`ai`**, **`ai-powered`**, **`our ai`**, **`assistant`**, **`agent`**, **`bot`** | **The single biggest trap in this feature.** Playback is the one place the product genuinely calls a model, and every natural way to explain that violates Principle I | `Listen`. The control names the act; nothing names the machine |
| `We couldn't generate the audio` | (not on the list) | Passes the sweep and still describes the pipeline to a participant. Principle I is broader than the word list | `That didn't play.` |
| `Talk it through`, `Someone to talk to` | **`therapy`**, **`therapist`**, **`counseling`** adjacency | Not banned words, but the framing they lead to is | Not used. `Yours` describes an exchange, never support |

Also absent, because the controls are absent: no string for a vote, like, reaction, rating,
comment, reply, best answer, sort, filter or share (FR-017 – FR-022). A copy contract that
authored one would be the first evidence the control was coming.

No Appalachian dialect (`y'all`, `reckon`, `fixin' to`, `holler`) and no `Busy Bees` — origin
story, never product vocabulary.

---

## Accessibility

Following `src/ui/QuestionCard.tsx`, which is the precedent in this repository:
`aria-live="polite"` goes on **transient status text that appears or swaps in place**
(`copy.loading`, `copy.selection.onlyQuestion`), and **not** on content that replaces the whole
screen and already carries a heading (`copy.failure.*`).

| String | Announced | How |
| - | - | - |
| `yours.playback.loading` | **Yes** | Inside that response's `aria-live="polite"` status region |
| `yours.playback.failed` | **Yes** | Same region — it swaps in where the loading text was |
| `yours.playback.unavailable` | **Yes** | Same region, same swap |
| `yours.answers.heading`, `yours.questions.heading` | No | Static `<h2>`s under the page `<h1>` |
| `yours.answers.published` | No | Static label on the entry |
| `yours.questions.responseCount()` | No | Static; the page does not update live (Assumptions: freshness) |
| Every empty state | No | Static content, present on first paint |

**One live region per response, not one per page.** FR-032 scopes the loading state to the
response being played. A page-level region would announce a state for a response the reader may
be nowhere near, and two concurrent `Listen` presses would overwrite each other's announcement.

**The `Listen` label stays `Listen` on every response.** FR-014 fixes it, and several identical
button names in one list is acceptable here because each sits inside its own list item beside
the response text — the accessible name is disambiguated by context, which is what list
semantics are for. Rewording the visible label per response to make each name unique would
break FR-014 to solve a problem the markup already solves.

**`Try again` is a real `<button>` inside the status region**, so the announcement and the
control the announcement refers to are adjacent in the reading order.

**Under `unavailable`, the `Listen` control is `disabled`** rather than removed. A control that
vanishes mid-session takes the reader's place in the list with it.
