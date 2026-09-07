# Contract: the `/yours` rendered view

**Feature**: 005-yours-and-playback · **Date**: 2026-09-07

What the screen renders, and — the longer half — what it must never render.

Column shapes are in [data-model.md](../data-model.md). The playback endpoint is
[playback-api.md](playback-api.md). Every fixed string is in
[copy.md](copy.md); this file names elements, not wording.

---

## 1. Component tree

| File | Kind | Owns |
| - | - | - |
| `app/yours/page.tsx` | **server** — `async`, no `'use client'` | session read, the three queries, both section renders, all three empty states |
| `app/yours/page.module.css` | CSS module | `--content-max`, and the `1fr 1fr` desktop grid on `.sections` |
| `app/yours/ResponseList.tsx` | **client** — `'use client'` | the `Listen` button, its per-response state, its retry |

`page.tsx` requirements:

- `export const dynamic = 'force-dynamic'` — the render depends on the session cookie. A cached
  `/yours` serves one participant's history to another.
- Reads the participant with `readParticipantIdFromCookies()` from `@/session/server`.
- Runs `listPublishedAnswers`, `listPublishedQuestions`, `listResponsesForQuestions`.
- Groups responses onto questions in TypeScript (research D7).
- Passes each question's responses down to `ResponseList` as plain props.

### Why the split

- Only the `Listen` control needs interactivity. Nothing else on the screen reacts to anything.
- Making the page a client component would ship the entire history render into the browser bundle
  to get one button.
- The history is already known at request time. Re-fetching it client-side buys nothing and costs
  SC-001's two-second budget.
- Mirrors the shipped `app/ask/page.tsx` → `AskQuestion.tsx` split. Same shape, same reason.

### What `ResponseList` must not do

- No `fetch` for history. It receives responses as props.
- No provider client and no audio bytes in props. The response rows carry text only — see
  [data-model.md](../data-model.md), which explains why not even a "has audio" boolean travels
  with them.

---

## 2. No session

`readParticipantIdFromCookies()` is read-only by design and **must not** mint a participant here.

| Behaviour | Verdict |
| - | - |
| Render both empty states | **Required** |
| Redirect to `/answer` | Forbidden |
| Render an error screen | Forbidden |
| Mint a participant id | Forbidden |
| Throw / 500 | Forbidden |

Why:

- A page that mints identity hands an unauthenticated caller a row for the cost of a GET. 001 owns
  identity creation, at `/answer`.
- "No session" and "session with no history" are the same screen from where the participant stands
  — both mean nothing has been published by them.
- The spec's edge case is explicit: a participant who has never contributed sees **both empty
  states**, not a blank or errored screen (SC-009).
- A redirect would bounce anyone who tapped `Yours` in the header out of the screen they asked for.

Treat `participantId === null` as "zero answers, zero questions". No branch, no special copy.

---

## 3. Section-by-section render contract

Two sections, in this order: `Your Answers`, then `Your Questions` (FR-001).

### 3a. `Your Answers` — one entry per published answer

| Element | Requirement | Notes |
| - | - | - |
| Original question text | **FR-005** | `question_text` from the join. Secondary weight — it is context, not the entry. |
| `Published` label | **FR-006** | Fixed string. `--green`, small. Every entry has it; there is no other state. |
| The answer's processed text | **FR-007** | `display_text`. The entry's primary content. |
| Section empty state | **FR-009** | See [§4](#4-the-three-empty-states). |

Absent by requirement:

- No `Listen` action here. **FR-014** puts `Listen` on responses only.
- No restore, retry, resume, or recover control for anything (**FR-008**).
- No pending / withheld / failed / abandoned entry (**FR-008**, **FR-021**, SC-007) — no such row
  exists to render.
- No timestamp is required. Order is newest-first from the query; that is not a rendered field.

### 3b. `Your Questions` — one entry per published question

| Element | Requirement | Notes |
| - | - | - |
| Processed question text | **FR-011** | `display_text`. |
| Response count | **FR-012** | The length of the grouped list. Never a stored counter. |
| Each response, as text | **FR-013** | Flat, chronological, unranked. |
| A `Listen` action per response | **FR-014** | Rendered by `ResponseList`. One per response, never one per question. |
| Per-question empty state | **FR-016** | When that question has zero responses. |
| Section empty state | **FR-016** | When the participant has published no questions. |

Rules:

- A **closed** question and every one of its answers stay fully visible to its asker (**FR-015**).
  Closure changes nothing on this screen except, at most, a status label.
- Responses render in `created_at ASC` order. That is chronology and carries no quality signal
  (**FR-018**, research D8).
- Seeded questions never appear — they carry `participant_id IS NULL` and the query excludes them.

---

## 4. The three empty states

All three are server-rendered. None is a spinner, a blank region, or an error.

| # | Where | Trigger | Requirement |
| - | - | - | - |
| 1 | `Your Answers`, section level | participant has published zero answers | **FR-009** |
| 2 | `Your Questions`, section level | participant has published zero questions | **FR-016** |
| 3 | Inside one question entry | that question has zero responses | **FR-016** |

- States 1 and 2 render **together** for a participant with no history and for no session at all.
- State 3 replaces the response list for that question only. Siblings are unaffected.
- The section heading still renders above its own empty state. The section does not disappear.
- Copy: state 1 points toward answering a question (US2 scenario 5); state 3 says nothing has come
  back yet (US1 scenario 7). Exact strings in [copy.md](copy.md).

---

## 5. Playback interaction states — per response

State is held **per response**, keyed by answer id (**FR-032**). There is no global playback state,
no shared spinner, and no shared error banner.

| State | Trigger | Control renders as | Status text | Response text |
| - | - | - | - | - |
| `idle` | default, and after playback ends | `Listen`, enabled | none | fully readable |
| `loading` | `Listen` pressed, request in flight | busy / disabled | loading, `aria-live="polite"` | fully readable |
| `playing` | `200` received, audio playing | playing indicator | playing, `aria-live="polite"` | fully readable |
| `failed` | `502 production-failed` | **retry offered** (**FR-033**) | error, `aria-live="polite"` | **fully readable** |
| `unavailable` | `503 unavailable` | degraded — disabled or absent, **no retry** (**FR-034**) | quiet; no error shouted | **fully readable** |

Hard rules:

- **The text never depends on the audio.** In every state above, the response's `display_text` is
  rendered and readable (**FR-030**, SC-002, SC-011).
- **`failed` offers retry; `unavailable` does not.** A retry that can never succeed is worse than no
  retry. See the 502-vs-503 table in [playback-api.md](playback-api.md).
- Pressing `Listen` on response A must not change the control, status, or text of response B.
- Two responses may be in different states simultaneously. Nothing serializes them.
- A `401` or `404` is not a rendered state — no `Listen` was ever rendered for a response the caller
  cannot reach.
- Repeat `Listen` after a successful play goes back through the same endpoint; the cache hit is the
  server's job, not the component's (FR-027, SC-004).

---

## 6. Must not render

**The most load-bearing section in this file.** Each row is a thing that does not exist anywhere in
the `/yours` component tree — not disabled, not hidden, not behind a flag. Absent.

| Forbidden | Forbidden by |
| - | - |
| Votes, upvotes, downvotes | FR-020, SC-008 |
| Likes, hearts, reactions, emoji responses | FR-020, SC-008 |
| Ratings, stars, scores shown or stored | FR-020, FR-018, SC-008 |
| Comments on a response | FR-020, Out of Scope |
| A reply control, follow-up, or further turn | FR-020, Out of Scope |
| Best-answer selection, accept, or mark-as-helpful | FR-019, SC-008 |
| Ranking, ordering by quality, "top", "most helpful" | FR-018, SC-008 |
| Nested responses, threads, reply trees — **flat list only** | FR-017 |
| Playback or review of an original participant recording, anywhere | FR-022, FR-024, SC-006 |
| A waveform, scrubber, or player bound to an original recording | FR-022, SC-006 |
| Edit, delete, withdraw, or hide a published contribution | Out of Scope |
| Restore / retry / resume of a pending, withheld, failed, or abandoned attempt | FR-008, FR-021, SC-007 |
| Withheld reasons, crisis copy, or any unpublished-attempt state | FR-021, SC-007 |
| Sorting, filtering, or search controls | FR-018, Out of Scope |
| Share, export, or permalink a question or response | Out of Scope |
| Download the generated playback audio | Out of Scope |
| Pagination, "load more", or infinite scroll | Out of Scope, spec Assumptions (Volume) |
| Live updating, polling, websockets, notifications, badges | Out of Scope, spec Assumptions (Freshness) |
| Anyone else's history, questions, or answers | FR-002 |
| A `Listen` on an unpublished contribution | FR-031 |
| A `Listen` on a question | FR-014 — responses only |

Two clarifications this table has to make, because both look defensible:

- **`created_at` ordering is not ranking.** It is chronology. It must never be relabelled, reversed
  "by relevance", or given a sort control — the moment a control exists, the order carries meaning.
- **A response count is not a score.** `3 responses` describes the list below it. It must not be
  compared, coloured by magnitude, or used to order questions.

---

## 7. Responsive and accessibility contract

### Layout

| Rule | Detail |
| - | - |
| No horizontal scroll, ever | FR-003, SC-010. `documentElement.scrollWidth <= clientWidth` at every configured width — `tests/e2e/responsive.spec.ts` already asserts this for `/yours`. |
| One breakpoint | `@media (min-width: 768px)`. House style; no second breakpoint. |
| Widen the column via `--content-max` only | `app/yours/page.module.css` sets `--content-max` inside the 768px query. **Never re-declare `max-width` on `.content`.** |
| 10+ responses on one question | Must render in full without breaking layout at phone width (spec Edge Cases, SC-010). No truncation, no clipping, no fixed-height scroller. |
| Long text wraps | `overflow-wrap: anywhere` / `min-width: 0` on grid and flex children. A 2000-character `display_text` and a long unbroken token must both wrap, not overflow. |

> **Why `--content-max` and not `max-width`:** both rules target `.content` at equal specificity, so
> a duplicate is resolved by stylesheet order across two CSS modules. Dev and production disagreed
> on that order once already and the screen silently collapsed to 560px. See the comment in
> `src/ui/Screen.module.css` and the regression test T085d.

### Accessibility

| Rule | Detail |
| - | - |
| Per-response playback status | `aria-live="polite"` on the status element, following `src/ui/QuestionCard.tsx:79`. One live region per response, never one for the page. |
| Contrast — **hard rule** | `--ink-55` (3.77:1) and `--ink-45` (2.80:1) **fail WCAG AA on `--bg`** at body sizes. Helper and secondary text on this screen use **`--ink-65`** (5.16:1). This includes the original-question line in `Your Answers` and the per-question empty state, which design.md assigns `--ink-50`. |
| Focus ring — mandatory | `outline: 2px solid var(--green); outline-offset: 3px;` on **every** interactive element, including every `Listen` button. `tests/e2e/a11y.spec.ts` walks the real tab order on `/yours` and asserts a visible ring at each stop. |
| Hit targets | primary `min-height: 56px`, ghost `52px`, absolute minimum `44px`. Measured, not declared — a shrink-wrapped inline element inside a tall container fails. |
| Participant text font | Must resolve through `--font-sans`, never `--font-display`. Pinned by `tests/e2e/design.spec.ts` (T081b): Sour Gummy loads latin only, and 002 publishes translated text. |
| No eyebrow labels | No small uppercase, letter-spaced label above a heading. Swept product-wide by `design.spec.ts` (T082). |
| No staging chrome | No device frame, status bar, or fake browser window. Swept by `design.spec.ts` (T080). |
| Reduced motion | Any animation added here must freeze under `prefers-reduced-motion: reduce` (`a11y.spec.ts` T084b sweeps for animated elements). |
| Decorative elements | `aria-hidden="true"` and unreachable by keyboard. |

---

## 8. The de-facto style scale

`src/ui/tokens.css` defines **colour and font tokens only**. There are no spacing, radius, or
type-scale tokens. A new component matches the literal values already in use:

| Property | Values in use | Where |
| - | - | - |
| Radius | `14px` buttons and button-shaped links; `20px` desktop panels; `12px` troughs; `4px` focus ring on inline links | `Button.module.css`, `QuestionCard.module.css`, `AppHeader.module.css` |
| Gaps (mobile) | `12px`, `16px`, `18px`, `20px`, `22px` | `Screen.module.css` (18/22), `QuestionCard.module.css` (12/20), `page.module.css` (16) |
| Gaps | `32px` between sections at mobile, **`56px` desktop grid gap**, `16px` between entries | `app/yours/page.module.css`, matching design.md's Layout table |
| Screen padding | mobile `78px 28px 52px`; desktop `28px 56px 40px` | `Screen.module.css` |
| Default column | `560px`, centred, via `--content-max` | `Screen.module.css` |
| Desktop panel padding | `32px` | `QuestionCard.module.css` |
| Type — display question | `34px` mobile / `44px` desktop, `line-height` 1.15 / 1.12 | `QuestionCard.module.css` |
| Type — section / status heading | `24px`, weight 500, `line-height` 1.2 | `QuestionCard.module.css` |
| Type — body | `16px`, `line-height` 1.45 | `QuestionCard.module.css` |
| Type — helper | `15px`, `line-height` 1.5, `--ink-65` | `QuestionCard.module.css` |
| Type — header / meta | `15px` header, `13px` meta lines | `AppHeader.module.css`, design.md §005 |
| Type — buttons | primary `18px`, ghost `17px` | `Button.module.css` |
| Weights | `var(--weight-medium)` = 500 for emphasis; 400 for body | `tokens.css` |

Do not invent a new value. If a spacing need is not on this list, use the nearest one that is.

---

## 9. Inbound links

`src/ui/ContributionOutcome.tsx` already links to `/yours` from four branches. All four currently
land on the placeholder; each becomes a real destination when this screen ships (plan divergence
D-1).

| Branch | Line | Link string | Why it points here |
| - | - | - | - |
| `rate_limited` | `ContributionOutcome.tsx:140` | `copy.review.rateLimited.action` — `Go to Yours` | Submission is capped; reading history is not. |
| `published` (question) | `ContributionOutcome.tsx:155` | `copy.review.publishedQuestion.ghost` — `Yours` | The ask was spent; responses will arrive here. |
| `spent` | `ContributionOutcome.tsx:180` | `copy.review.spent.ghost` — `Yours` | A question from them is already out there. |
| `lost` | `ContributionOutcome.tsx:203` | `copy.review.rateLimited.action` — `Go to Yours` | A dropped connection is not proof of failure; looking is what resolves it. |

Plus `src/ui/AppHeader.tsx` — the `Yours` link in the header's right slot, on every screen that
renders the default header variant.

Each of the four gets an e2e assertion that the link reaches a rendered `/yours`, not a placeholder.

---

## 10. Shipped tests this screen changes

Not new work — flagged so the change is not a surprise mid-implementation.

| Test | Why it moves |
| - | - |
| `tests/e2e/responsive.spec.ts` T085c | Asserts `/yours` uses the default 560px column and locates it by the placeholder string `Yours is on its way`. Both premises expire: the placeholder text goes away, and Yours widens `--content-max` to `720px`. Rewritten in this feature to assert the real column, with a lower bound so a collapse back to 560px fails. |
| `tests/e2e/a11y.spec.ts` T083 | Its comment allows `/yours` to have zero tab stops. It will now have many, each of which must show a focus ring. |
| `tests/e2e/design.spec.ts` header comment | Describes `/yours` as a placeholder. |
| `tests/e2e/copy.spec.ts` | Already lists `/yours` in `ROUTES`; the new screen falls under the banned-word sweep the moment it renders anything. |

## 11. Divergences from design.md's `/yours` sketch

`specs/001-participant-and-pool/contracts/design.md` sketched this screen before the spec existed.
Where they disagree, **spec.md and plan.md win**.

| design.md sketch | This contract | Why |
| - | - | - |
| Mobile segmented tabs over one list | Both sections stacked, always rendered | FR-001 says one area with exactly two sections; a tab hides one of them behind a control. |
| A `/yours/questions/[id]` sub-route for responses | Responses render inline under their question on `/yours` | plan.md's Project Structure builds one route. No second route is in scope. |
| Header: mobile `Back` / centred title; desktop right slot flips to `Find me a question` | The shared default `AppHeader` | plan.md's only header change is D-2: `AppHeader` reads `copy.nav.yours` instead of a hardcoded string. A contextual variant is not in this feature. |
| Secondary text at `--ink-50` / `--ink-45` | `--ink-65` | Those tokens fail WCAG AA on `--bg` at body sizes. See [§7](#accessibility). |

Retained from design.md: the `1fr 1fr` desktop grid at a `56px` gap, the `Published` label in
`--green`, and the `n responses` count.

The grid applies to a `.sections` wrapper, not to `Screen`'s `.content` — putting `display: grid`
on `.content` would pull the page heading into a column beside the sections, and `--content-max`
is the only property this screen may set there. Tracks are `minmax(0, 1fr)` rather than a bare
`1fr`: a `1fr` track floors at its content's min-content width, so one unbroken 2000-character
token would push its column past half the container and take the page into horizontal scroll,
which FR-003 forbids at every width. Sections stack below `768px`.
