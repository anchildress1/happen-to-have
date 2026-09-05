# Contract: Routes

**Feature**: 001-participant-and-pool | **Date**: 2026-09-04

Two pages, one route handler. Only `/api/questions/next` may create a participant through
`getOrCreateParticipant` ([session.md](session.md)); skipping is client-side and requires no
session. Neither Server Component creates participants or sets cookies.

Route names come from the design, not from me — each Chrome frame's `url` prop names its route.
The full product map, from [design.md](design.md):

| Route | Screen | Spec |
| - | - | - |
| `/` | Arrival | **001** |
| `/answer` | Question selection | **001** |
| `/answer/record` | Recording an answer; `?questionId=` retries a specific one | 003 |
| `/ask` | Ask unlocked, then recording a question | 004 |
| `/yours` | Your Answers · Your Questions | 005 |
| `/yours/questions/[id]` | Responses to one question | 005 |

001 builds the first two. Checking, the result page, the failure page, and the rate-limit page
are states within the flow that produced them, not routes.

---

## Pages

### `GET /` — Landing

Server component. Renders fixed copy from [copy.md](copy.md): product name, tagline, and
`Find me a question` as the primary action.

- Does **not** create a participant. Identity is created on first *interaction*, not on first
  page view, so a crawler or a preview fetch does not mint rows.
- The action navigates to `/answer`.
- No microphone API is referenced anywhere on this route (SC-005).

### `GET /answer` — Presented question

Server component renders a client selection shell. On mount, that shell calls
`POST /api/questions/next`; the handler establishes the session and returns the first question
plus the ordered eligible ids. No cookie mutation occurs during Server Component rendering.
The shell renders these request states:

| Condition | Renders |
| - | - |
| A row is returned | Question text + `I can answer this` + `Try another question` (FR-013, FR-014) |
| Zero rows | Empty state (FR-029) |
| POST fails | Client failure state with retry (FR-031); `error.tsx` covers route-render failures |

The client shell owns loading and retry (FR-030, FR-031). There is no `loading.tsx`: `/answer`
awaits nothing, so no Suspense boundary ever suspends and the file could never execute.

`I can answer this` is the boundary of this feature. It links to `/answer/record?questionId=<displayed-id>`, which does not
exist yet and is delivered by 003. Until then it is a disabled or placeholder target — it must
never request microphone permission from this feature's code.

### Header

001 builds the shared header the whole product uses. It has a left slot and a right slot, and the
right slot is **contextual — it offers wherever you are not** ([design.md](design.md) lists all
six variants; `/yours` flips its right slot to `Find me a question`).

001 renders two of them:

| Screen | Left | Right |
| - | - | - |
| Arrival, mobile | *(empty)* | `Yours` |
| Arrival desktop, Selection | `Happen to Have?` | `Yours` |

On Arrival at mobile width there is no product name in the header, because the H1 *is* the
product name.

`Yours` points at `/yours`, which [005](../../005-yours-and-playback/spec.md) delivers. In this
feature it renders but **must not 404** — disable it or point it at a placeholder. A header link
to nothing is the most visible possible bug on the landing screen.

---

## Route handlers

### `POST /api/questions/next`

Start a pass for the current participant, strictly ordered by answer count, creation time, and id.
Return one question's text plus the eligible ids for tab-local traversal; the list is not a
public browse API. The browser stores the list and pointer only in page memory.

**Request**: no body. Participant comes from the session cookie.

**200**

```json
{
  "question": {
    "id": "b6f1c2e8-....",
    "displayText": "How do you tell a friend their business idea has a hole in it?",
    "publishedAnswers": 1
  },
  "queue": [{ "id": "b6f1c2e8-....", "displayText": "...", "publishedAnswers": 1 }]
}
```

**200 — empty pool** (FR-029; not an error)

```json
{ "question": null, "queue": [] }
```

**200 — empty pool** still establishes the session; a later request can find newly published questions.

**500**

```json
{ "error": "selection_failed" }
```

---

### Skipping is not an endpoint

There is no `/api/questions/skip`. `POST /api/questions/next` returns the full ordered `queue`
of eligible questions, and the tab holds that list plus a pointer in page memory. `Try another
question` advances the pointer and wraps at the end.

**Why no round trip.** A skip is a presentation change, not a contribution. Every requirement it
has to satisfy — no write to `participants`, no write to `answers`, no penalty, no cooldown, no
rate limit, no microphone (FR-020 through FR-023) — is satisfied *by construction* when nothing
leaves the tab. An endpoint would merely promise the same thing and cost a round trip on every
press.

**The staleness this trades away, and why it is acceptable.** The queue is fetched on mount and
again at each pass boundary, so it can go stale for at most one pass. If another participant
publishes an answer that closes a question mid-pass, the pointer can land on one that is no longer
eligible. At challenge scale that window is seconds wide, and the consequence is bounded: the
participant taps `I can answer this` and the submit-time check in
[003](../../003-answer-and-unlock/spec.md) refuses it. Eligibility is enforced where it changes
an outcome — at submission — not where it only changes a display.

**What the client must do:**

1. Advance the pointer by one; never mutate or reorder the queue.
2. Wrap to index 0 past the end, rather than rendering a false empty state (FR-025 — a skipped
   question stays permanently eligible).
3. Re-request on that wrap, and only on that wrap (FR-025). Wrap the pointer first, then let
   the new queue land underneath — blanking to the loading state renders as the false empty
   state item 2 forbids. The in-flight response must not move the pointer again: the
   participant may have skipped on, and yanking them back breaks FR-024.
4. Never write a cookie, never re-request mid-pass, never touch a recording API.
5. With `queue.length === 1`, hold the question and show
   `This is the only question waiting right now.` (FR-024). No re-request — that would be a
   request per press.
6. Treat `queue.length === 0` as the only empty-pool case (FR-029).

**Hard requirements** — verifiable by reading `QuestionCard.tsx` and confirming what is absent:

- **No write to `participants`.** Not `can_ask`, not anything (FR-022).
- **No write to `answers`.** A skip is not a contribution.
- **No penalty, cooldown, or counter** of any kind (FR-023).
- **No rate limit, and no network call inside a pass.** Skipping is unlimited (FR-020). The one
  call a traversal makes is the FR-025 refresh at a pass boundary — a read that writes nothing.

---

## Cross-cutting

**Validation**: every request body is parsed with Zod before use. Every database row is parsed
with Zod before rendering (research D5).

**Method rejection**: the handler exports only `POST`. Any other method gets 405 from the
framework.

**Caching**: `/answer` and the handler are dynamic — `export const dynamic = 'force-dynamic'`.
Caching a per-participant selection would serve one person's question to another, which breaks
FR-015 and FR-016 in the most visible way possible.

**Error shape**: `{ "error": "<snake_case_code>" }`. Never a stack trace, never a database
message.

---

## What is deliberately absent

No endpoint returns a public catalogue or more than one question's text. The private ordered-id
list includes only that participant's eligible questions; each requested id is checked again.

---

## Test obligations

| Behavior | Level |
| - | - |
| `/` renders name, tagline, primary action verbatim | E2E |
| `/` creates no participant row | Integration |
| `/answer` returns one question with both actions | E2E |
| Own question never selected | Integration |
| Question with a published answer from this participant never selected | Integration |
| Withheld or failed submission leaves no row and does not affect selection | Integration |
| Closed question never selected | Integration |
| Strict answer-count order with stable creation/id ties (SC-004) | Integration |
| Pointer traverses and wraps over 20 skips, including pools of 0, 1, 2, and 15 (SC-003) | E2E |
| Skip writes nothing to `participants` or `answers` | Integration |
| Empty pool renders the empty state, not an error | Integration + E2E |
| Selection failure renders the retry state | E2E |
| `getUserMedia` is never called on any route (SC-005) | E2E |
| No horizontal scroll at 390px and 412px widths (SC-006) | E2E |
