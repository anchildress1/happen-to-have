# Contract: Visual Design System

**Feature**: 001-participant-and-pool | **Date**: 2026-09-04

**Source**: Claude Design project `Happen to Have UI mockups`
(`e13f24fb-d885-4609-a6c0-883711d7a802`), file `Happen to Have - Arrival.dc.html`, turn 2.

**This is the design system of record for the whole product.** The source file stages all 11
screens across all five specs. 001 builds the foundation — tokens, header, buttons, layout — and
specs 002–005 consume it rather than re-deriving anything.

The source design described the initial layout; the contracts below include the subsequent
user decisions about Withheld, fresh recordings, and published-only history.

The design's original note states the intent:

> Order follows the participant state machine: Arrival → Needs answer → Recording → Checking →
> Ask unlocked → Recording question → back to Needs answer, plus the failure and history
> screens. Desktop pairs are shown where the layout changes; the rest share a centered 560px
> column on desktop.
>
> Copy from the handoff doc is verbatim (button labels, Checking text, unlock text, result-page
> texts). Crisis resources are human-authored and static. Nothing on the result page argues with
> the participant.

---

## Staging is not product

Every screen is wrapped in components that exist only to present mockups on a canvas.
**None ship.**

| File | What it is | Verdict |
| - | - | - |
| `ios-frame.jsx` | iOS bezel, dynamic island, status bar, home indicator, keyboard | Staging. Discard. |
| `browser-window.jsx` | macOS Chrome — traffic lights, tab bar, URL bar | Staging. Discard. |
| `support.js` | Generated `dc-runtime`; renders `<x-dc>` / `<x-import>` | Canvas renderer. Irrelevant. |

Both frames carry `@ds-adherence-ignore -- omelette starter scaffold` and a `data-om-starter`
marker. Shipping a simulated phone bezel around a responsive web app would also contradict
FR-032 outright.

Two things do leak usefully out of the staging: the **route map** (below) from each Chrome
frame's `url` prop, and the **breakpoint** — the desktop preview declares `min: 768, default:
1100, max: 1440`, and the mobile frame is `402px`.

---

# Part 1 — The system

## Tokens

Define once as CSS custom properties on `:root`. Values verbatim from the design.

### Color

| Token | Value | Use |
| - | - | - |
| `--bg` | `#FAFAF7` | Page background, every screen |
| `--ink` | `#14201A` | Primary text |
| `--green` | `#2E7D4F` | Primary action, accent, watermark |
| `--green-deep` | `#24603c` | Display headings (7.14:1 on `--bg`) |
| `--green-hover` | `#286f46` | Primary button hover |
| `--green-85` | `rgba(46,125,79,.85)` | Tagline |
| `--green-18` | `rgba(46,125,79,.18)` | Strong divider, resource-list rules |
| `--green-16` | `rgba(46,125,79,.16)` | Muted button hover |
| `--green-14` | `rgba(46,125,79,.14)` | Recorder dial track |
| `--green-12` | `rgba(46,125,79,.12)` | Light divider, icon-chip fill |
| `--green-10` | `rgba(46,125,79,.10)` | Muted button fill |
| `--green-08` | `rgba(46,125,79,.08)` | Ghost hover, segmented-tab trough |
| `--green-06` | `rgba(46,125,79,.06)` | Desktop panel fill |
| `--ink-70` | `rgba(20,32,26,.70)` | De-emphasised body (unanswered question) |
| `--ink-65` | `rgba(20,32,26,.65)` | Crisis body |
| `--ink-60` | `rgba(20,32,26,.60)` | Desktop helper |
| `--ink-55` | `rgba(20,32,26,.55)` | Helper, secondary state |
| `--ink-50` | `rgba(20,32,26,.50)` | Tertiary label |
| `--ink-45` | `rgba(20,32,26,.45)` | Desktop footer |
| `--ink-35` | `rgba(20,32,26,.35)` | Inactive timer digits |

`#f0eee9` and `#1a1a1a` in the source belong to the **canvas chrome**. Do not carry them over.

### Type

**Two families, split by job.**

| Role | Family | Weight |
| - | - | - |
| Product name, headings, display chrome | **Sour Gummy** | 500, width 115% |
| Participant content, body, UI, buttons, meta | **Source Sans 3** | variable, 400 / 500 in use |

Sour Gummy is a variable family (`wght` 100–900, `wdth` 100–125), loaded with **both axes
live** — `next/font/google` rejects `axes` unless `weight` is `variable`. The instance is
picked in CSS by `--weight-display` (500) and `--width-display` (115%), so changing either is
a token edit, not a font reload.

**Widen on the axis, never with letter-spacing.** `font-stretch` stretches the letterforms
themselves; tracking only pushes thin glyphs further apart, which reads as loose rather than
wide. Every element that sets `--font-display` sets `font-stretch: var(--width-display)`.

**Weight 300 is gone.** The imported design set every display element at weight 300, and that
thinness was its identity. Display type is 500 — heavier than the mockups, deliberately. Do
not try to recover the original feel with a synthetic stroke.

**Display headings are `--green-deep`, not `--ink`.** At 58–84px, near-black ink reads as a
black slab (16:1 on `--bg`); `--green` is too light at that size and collides with the primary
button, which is the same value. `--green-deep` sits between them at 7.14:1 — clearing AA for
normal text, not just large.

**The watermark tracks the same tokens.** The decorative `?` reads `--weight-display` and
`--width-display`, so it moves with display type by design. At 520–760px and 9% opacity it is
the largest thing on the screen; if it ever overpowers, give it its own tokens — do not thin it
with opacity, which changes the colour relationship the tokens define.

**Participant content does not use Sour Gummy, even at display sizes.** Question text renders at
34px mobile / 44px desktop, which is display-sized, but it is *participant writing* and 002
translates contributions into the display language. Sour Gummy ships latin and latin-ext only —
no Cyrillic, no Vietnamese, no CJK. Setting translated content in it would break for languages
the product explicitly supports. Source Sans 3 carries every string a participant wrote.

Source Sans 3 was chosen for reach: **latin, latin-ext, cyrillic, cyrillic-ext, greek,
greek-ext, vietnamese** — well past what 002 translates into, and far past Sour Gummy's two.

**The recorder timer needs no `tabular-nums`.** Source Sans 3's digits are already monospaced —
every glyph `0`–`9` advances 472 units in the Google-served font. This is load-bearing, because
Google Fonts **strips GSUB features from its subsets**: the served face has no OpenType features
at all, so `font-variant-numeric: tabular-nums` is a silent no-op. The default figures do the job
the declaration would have. Do not "fix" a timer jitter by adding that declaration; if digits ever
jitter, the font changed.

Load both through `next/font/google`. Nothing else. An E2E test asserts no request for any
third family.

| Role | Mobile | Desktop |
| - | - | - |
| Display XL (product name, unlock) — **Sour Gummy** | `50–58px / .98–1`, w500, wdth 115%, `-.025em` | `80–84px / .95–.96`, w500, wdth 115%, `-.03em` |
| Display L (question, result heading) — **Source Sans 3** | `34px / 1.1–1.15`, w400, `-.02em` | `44px / 1.12`, `-.025em` |
| Display M (crisis heading, section) — **Source Sans 3** | `30px / 1.14`, w400, `-.02em` | `30px`, w400, `-.02em` |
| Heading S (question in recorder) | `20px / 1.3`, `-.01em` | `34px / 1.18`, `-.02em` |
| Question in history | `24px / 1.2`, `-.015em` | `34px / 1.15`, `-.02em` |
| Tagline | `22px / 1.3`, w400 | `28px / 1.3` |
| Timer — **Source Sans 3** | `56px`, w400, `-.03em` (digits monospaced by default) | `64px` |
| Body | `16px / 1.45` | `16–17px / 1.45` |
| Helper | `15px / 1.5` or `13px / 1.5` | `15–18px / 1.5` |
| Header / nav | `15px`, w500 | same |
| Button — primary | `18px`, w500 | same |
| Button — ghost | `17px`, w500 | same |
| Meta / caption | `13–14px` | `13–14px` |

All display text uses `text-wrap: pretty`. Timer digits need no declaration — see above.

### Layout

| | Mobile (< 768px) | Desktop (≥ 768px) |
| - | - | - |
| Padding | `78px 28px 52px` | `28px 56px 40px` |
| Structure | flex column, content block `flex: 1` centered | `grid-template-rows: auto 1fr [auto]` |
| Content gap | `18–22px` | `22–24px` |
| Default column | full width | **centered 560px column** |

Screens with a bespoke desktop grid — everything else uses the 560px centered column:

| Screen | Desktop grid | Gap |
| - | - | - |
| Arrival | `1fr 1fr`, copy column `max-width: 520px` | `48px` |
| Question selection | `minmax(0,1.4fr) minmax(0,1fr)` | `64px` |
| Recording | `minmax(0,1fr) auto` | `64px` |
| Ask unlocked | single column, `max-width: 600px` | `24px` |
| Responses | `minmax(0,1fr) minmax(0,1.3fr)` | `64px` |
| Yours | `1fr 1fr` | `56px` |

Breakpoint is **768px**, from the design's own desktop-preview minimum.

---

## Components

### Buttons

Three variants. All are real `<button>` elements with `all: unset`, `border-radius: 14px`,
`font-family: inherit`, weight 500, centred content.

| Variant | Fill | Text | Height | Hover | Used for |
| - | - | - | - | - | - |
| **Primary** | `--green` | `#fff`, 18px | `min-height: 56px` | `--green-hover` | The one forward action |
| **Ghost** | transparent | `--green`, 17px | `min-height: 52px` | `--green-08` | Secondary, dismissive |
| **Muted** | `--green-10` | `--green`, 18px | `min-height: 56px` | `--green-16` | Rate-limited screen only |

Full width on mobile. On desktop, Arrival and Ask-unlocked use auto width with `padding: 0 30px`
(primary) / `0 22px` (ghost); the recorder uses a fixed `260px`.

A primary button may carry a leading glyph: a `14px` white square (stop) or circle (record),
`gap: 10px`.

> `all: unset` strips the default focus outline. Every button **must** define a visible
> `:focus-visible` ring. This is the one accessibility regression the design will introduce if
> copied literally.

### Header

`min-height: 44px`, `15px`, weight 500. Left slot, right slot, `space-between`. Six variants:

| Screen | Left | Right |
| - | - | - |
| Arrival (mobile) | *(empty)* | `Yours` |
| Arrival (desktop), Ask unlocked, Result, Failure, Rate limited | `Happen to Have?` | `Yours` |
| Selection | `Happen to Have?` | `Yours` |
| Recording an answer | `Cancel` | *(empty)* |
| Recording a question | `Back` | *(empty)* |
| Responses | `Yours` | *(empty)* |
| Yours (mobile) | `Back` | centred title `Yours` + `36px` spacer |
| Yours (desktop) | `Happen to Have?` | `Find me a question` |

The right slot is contextual: it offers wherever you are **not**. On `Yours` it flips to
`Find me a question`.

> **No eyebrow text anywhere.** The design used a small uppercase label above headings
> (`Someone asked`, `Recording`, `Your question`, `You're answering`, `Take a breather`). That
> pattern is removed product-wide. Screens carry their context in the heading and the controls;
> where an eyebrow sat in a header slot, the slot is simply empty.

### Watermark

Decorative `?`, absolutely positioned, clipped by `overflow: hidden` on the screen container.

| | Mobile | Desktop |
| - | - | - |
| Position | `right: -30px; top: 120px` | `right: -70px; top: -60px` |
| Size | `520px` | `760px` |

```
font-weight: 300; color: var(--green); opacity: .09;
letter-spacing: -.06em; line-height: 1; pointer-events: none;
```

**Exception**: on the Checking screen the opacity drops to `.05`, so nothing competes with the
blocking state. `aria-hidden="true"` everywhere.

### Recorder dial

Concentric circles. Outer ring is the progress track, inner disc is the face.

| | Mobile | Desktop |
| - | - | - |
| Outer | `220px` | `260px` |
| Inner | `196px` | `232px` |
| Timer | `56px` | `64px` |

- **Recording**: outer `conic-gradient(var(--green) 0 <pct>, var(--green-14) 0)`.
- **Idle, before start**: outer is flat `--green-14`; timer reads `0:00` in `--ink-35`.
- Inner disc is `--bg`, centred column, `gap: 4px`.
- Sub-label under the timer: `14–15px`, `--ink-55` — `37s left` while running, `60s max` idle.

### Waveform

Seven bars, `3px` wide, `border-radius: 2px`, in a `28px` row with `gap: 3px`, aligned to
baseline. Heights `10, 18, 26, 14, 22, 8, 16`px; opacity varies `--green` at `.4 / .6 / 1 / .6 /
.8 / .4 / .6`. Live amplitude, decorative — `aria-hidden="true"`.

### Progress dots

Three `10px` circles, `gap: 8px`, `--green` at opacity `.3 / .6 / 1`. Used full-size on the
Checking screen and at `6px` inline in a `Checking…` history row.

### Status badge

`44px` circle (`48px` desktop), centred glyph.

| State | Fill | Glyph |
| - | - | - |
| Success | `--green` | `✓` white, 20–22px |
| Withheld | `--green-12` | `–` in `--green`, 22px w300 |
| Failure | transparent, `1.5px solid rgba(46,125,79,.4)` | `!` in `--green`, 20px |

The withheld and failure badges are deliberately quiet. Nothing in this product uses red, and
nothing scolds.

### Play affordance

A circular chip plus a label, `--green`, 14px w500, `gap: 8px`.

| Context | Chip | Label |
| - | - | - |
| Hear the question | `22px` mobile / `24px` desktop, `--green-12`, `▶` 10px | `Hear the question` |
| Idle response | `28px`, `--green-12`, `▶` | `Listen · 0:41` |
| Playing response | `28px`, solid `--green`, `❚❚` white | `Playing · 0:12 / 0:28` |

Row `min-height: 32px`. On desktop the response label drops `Playing` and shows only the times.

### Resource list

Crisis routing only. `border-top` and per-row `border-bottom` in `--green-18`, rows
`min-height: 56px`, `space-between`, `gap: 12px`.

Left is a stacked name (`16px` w500) and qualifier (`13px`, `--ink-55`); right is the contact
value in `--green` `16px` w500.

### List row

The general pattern for responses and history. Vertical stack, `gap: 8–12px`, `padding: 18px 0`
mobile / `16–20px 0` desktop, `border-bottom: 1px solid var(--green-12)`; last row has none.

Desktop response rows become `grid-template-columns: 1fr auto; gap: 24px; align-items: start`
with `white-space: nowrap` on the play affordance.

Section headers above a list: `14px` w500, `padding-bottom: 10px`,
`border-bottom: 1px solid var(--green-18)`.

### Segmented tabs

`Yours` on mobile. Trough: `padding: 4px`, `border-radius: 12px`, `--green-08`. Each tab
`flex: 1`, `min-height: 40px`, `border-radius: 9px`, `15px` w500. Active is `--green` filled with
white text; inactive is `--green` text on transparent.

Desktop drops the tabs and shows both sections side by side.

---

## Accessibility

The design clears most bars already. Keep it that way.

- **Touch targets**: primary 56px, ghost 52px, header 44px, play affordance 32px. Do not shrink
  any of them to fit a layout.
- **Contrast**: `--ink` on `--bg` and `#fff` on `--green` both pass AA. `--ink-45`, `--ink-50`,
  and `--ink-35` are below AA for body text — restrict them to supplementary copy that is never
  the only source of information. `--ink-35` appears only on an idle `0:00`, which is duplicated
  by the `60s max` label.
- **Focus**: mandatory visible `:focus-visible` ring on every interactive element. See Buttons.
- **Decorative**: watermark, waveform, progress dots, status dots all take `aria-hidden="true"`.
- **Live regions**: the recording timer and the Checking state must announce to screen readers —
  `aria-live="polite"`, and the timer as `role="timer"`. A blocking state that is silent to a
  screen reader is a blocking state that looks like a hang.
- **Motion**: the progress dots and waveform animate. Respect
  `prefers-reduced-motion: reduce` — freeze them and let the text carry the state.
- **`overflow: hidden`** clips the watermark. It must never clip content at any width.

---

# Part 2 — Screens

## Route map

Read from each Chrome frame's `url` prop. This is the product's real URL structure.

| Route | Screen | Spec |
| - | - | - |
| `/` | Arrival | **001** |
| `/answer` | Question selection | **001** |
| `/answer/record` | Recording an answer | 003 |
| `/ask` | Ask unlocked, then recording a question | 004 |
| `/yours` | Your Answers · Your Questions | 005 |
| `/yours/questions/[id]` | Responses to one question | 005 |

Checking, the result page, the failure page, and the rate-limit page are states rendered within
the flow that produced them, not separate routes.

---

## 001 — Arrival (`/`)

Watermark. Header: mobile shows only `Yours`; desktop adds the product name left and a footer
line. Centred content: a decorative `10px`/`12px` status dot at `--green` opacity `.45`, the
product name as H1, the tagline, then the primary action and helper.

| Element | String |
| - | - |
| H1 | `Happen to Have?` |
| Tagline | `Answer one. Ask one.` |
| Primary | `Find me a question` |
| Helper | `Sixty seconds, in your own voice. Once your answer counts, you can ask.` |
| Footer (desktop) | `Every question and every answer comes from a person.` |

Desktop: `1fr 1fr` grid, copy column `max-width: 520px`, action and helper side by side.

## 001 — Question selection (`/answer`)

Header, watermark, centred content: question, helper, then both actions.

| Element | String |
| - | - |
| Question | *(from the pool)* |
| Helper (mobile) | `Answer in your own voice. Up to 60 seconds.` |
| Helper (desktop) | `Answer in your own voice. Up to 60 seconds. Once your answer counts, you can ask one of your own.` |
| Primary | `I can answer this` → `/answer/record?questionId=<displayed-id>` |
| Ghost | `Try another question` |

Question type is `34px` mobile / `44px` desktop. Desktop puts the question in the left column and
wraps helper + both buttons in a `--green-06` panel, `padding: 32px`, `border-radius: 20px`.

**Missing from the design** — 001 needs all three, and they are authored, not designed:
empty pool (FR-029), loading (FR-030), selection failure with retry (FR-031). See
[copy.md](copy.md). Worth a design pass before the demo; the empty state is what a judge hits by
clicking once more than expected.

---

## 003 — Recording an answer (`/answer/record`)

Header `Cancel`, right slot empty. The question stays visible at `20px` (mobile) above a
`Hear the question` play affordance. Centred: recorder dial at 38% fill showing `0:23` and
`37s left`, waveform beneath. Primary carries a white square glyph.

| Element | String |
| - | - |
| Play | `Hear the question` |
| Timer sub-label | `37s left` |
| Primary | `Stop and send` |
| Helper | `Stops on its own at 60 seconds.` |

## 002 / 003 — Checking

No header, no actions — deliberately blocking. Watermark drops to `.05`. Centred: progress dots,
heading, helper.

| Element | String |
| - | - |
| Heading | `Checking your answer…` |
| Helper | `This usually takes a few seconds. Keep this page open.` |

## 003 — Ask unlocked (`/ask`)

Success badge, display-XL heading, helper, primary and ghost.

| Element | String |
| - | - |
| Heading | `Your answer counts.` / `Ask one.` — line break on mobile, one line on desktop |
| Helper | `Your answer is published. You have one question to ask, whenever you're ready.` |
| Primary | `Ask a question` |
| Ghost | `Not now — it'll keep` |

`Not now — it'll keep` is the design stating Principle II in the participant's language: the ask
is held, not spent, until a question is created.

## 004 — Recording a question (`/ask`)

Header `Back`, right slot empty. Prompt heading and helper at the top, idle dial centred, primary
with a white circle glyph.

| Element | String |
| - | - |
| Heading | `What do you happen to need?` |
| Helper | `Say it plainly, the way you'd ask a neighbor. Up to 60 seconds. People will answer in their own voices.` |
| Timer | `0:00` in `--ink-35`, sub-label `60s max` |
| Primary | `Start recording` |
| Helper | `Your ask is used only once the question is published.` |

## 002 — Result page

One shared **Withheld** page for all rejection reasons, used by both question and answer flows.

**Irrelevant** and **illegal/dangerous** share a shape: withheld badge, heading, reassurance, then
**two** actions.

| Variant | Heading | Sub |
| - | - | - |
| Irrelevant | `That response doesn't appear to answer this question. Try another.` | `It wasn't shared. Nothing else changes.` |
| Illegal | `That response can't be shared here. Try another.` | `It wasn't shared. Nothing else changes.` |
| Silence / empty | `We couldn't hear anything. Try recording again.` | `It wasn't shared. Nothing else changes.` |
| Unintelligible / corrupt | `We couldn't make out the recording. Try recording again.` | `It wasn't shared. Nothing else changes.` |
| Privacy / spam / harassment / other content | `That recording can't be shared here. Try recording again.` | `It wasn't shared. Nothing else changes.` |

| Contribution | Primary | Destination | Ghost |
| --- | --- | --- | --- |
| Answer | `Record another answer` | `/answer/record?questionId=<same>`, fresh recording | `Try another question` → `/answer` |
| Question | `Record another question` | `/ask`, fresh question recording; ask intact | `Back` → `/ask` unlocked state |

Retry always records anew; the withheld audio is deleted. The answer target is checked for
authorship and an existing published answer before recording. An existing in-progress answer
may finish after routing closure, as specified in 003.

**Crisis** uses the same Withheld page with a `30px` heading and fixed resources. It also offers
the contribution-specific fresh-recording action above: Gemini can be wrong. Resources remain
visible alongside retry; the participant does not have to dismiss them first.

| Element | String |
| - | - |
| Heading | `It sounds like you might be going through something serious right now.` |
| Body | `This isn't the right place for that, but these people are, any hour.` |
| Primary | `Record another answer` or `Record another question`, according to the originating flow |
| Ghost | `Back to questions` for answers; `Back` to the unlocked ask state for questions |

Resources, human-authored and static:

| Name | Qualifier | Value |
| - | - | - |
| `988 Suicide & Crisis Lifeline` | `United States · call or text` | `988` |
| `Crisis Text Line` | `United States · text` | `HOME to 741741` |
| `Find a Helpline` | `International directory` | `findahelpline.com` |
| `Emergency` | `If someone is in immediate danger` | `Local number` |

Satisfies FR-033 (US **and** international) and FR-034 — nothing is generated, nothing claims
intervention.

## 002 — Processing failed

Failure badge, heading, helper, primary and ghost.

| Element | String |
| - | - |
| Heading | `We couldn't check your answer.` or `We couldn't check your question.` |
| Helper | `Something on our side didn't finish. Your recording was discarded. You can record again.` |
| Lost response | `We couldn't confirm what happened. Check Yours before recording again.` |
| Primary | `Record another answer` → `/answer/record?questionId=<same>`; `Record another question` → `/ask` |
| Ghost | `Try another question` → `/answer` for answers; `Back` → `/ask` unlocked state for questions |

Failed checks retry independently while the active submission is Checking. This page appears
only after retry exhaustion or deadline expiry and retains no audio or recoverable attempt.
A later retry starts with a fresh recording; an existing earned ask remains intact.

## 002 — Rate limited

Heading with the retry time in `--green`, helper, muted button.

| Element | String |
| - | - |
| Heading | `You've sent a lot today. You can record again at <time>.` |
| Helper | `Everything you've already sent is still being checked or is published. Listening is always open.` |
| Muted | `Go to Yours` |

The heading names the time, satisfying FR-049. `Listening is always open` confirms the limit
covers submission only, never playback.

## 005 — Responses (`/yours/questions/[id]`)

Header `Yours`, right slot empty. Question at `24px`, then a count row, then flat rows.

| Element | String |
| - | - |
| Count | `3 responses` |
| Status | `Closed to new answers` |
| Meta (desktop) | `Asked Tuesday · Closed to new answers` |
| Per row | response text + `Listen · 0:41` |
| Playing | `Playing · 0:12 / 0:28` |

No ranking, no votes, no reply control anywhere — FR-017 through FR-020 hold. `Closed to new
answers` is visible to the asker while the question and every answer stay readable.

## 005 — Yours (`/yours`)

Mobile: `Back` / centred `Yours`, segmented tabs, then one list. Desktop: two columns, both
sections visible, header CTA flips to `Find me a question`.

**Your Answers** — each row is the original question (`13px`, `--ink-50`), the published answer
text, and `Published` in `--green` `13px` w500. No pending, withheld, failed, or abandoned
entries exist, and there is no attempt-recovery control.

**Your Questions** — question text with a right-aligned count:

| State | Rendering |
| - | - |
| Answered | `3 responses` / `1 response` in `--green` w500 |
| Unanswered | text at `--ink-70`, `Open · no responses yet` in `--ink-50` |

Withheld reasons appear only on the active flow's shared Withheld page, never in history.

---

## Test obligations

| Behavior | Level | Owner |
| - | - | - |
| No device or browser frame renders anywhere | E2E | 001 |
| Tokens resolve; no hard-coded hex outside the token block | Unit — scan compiled CSS | 001 |
| Only Sour Gummy and Source Sans 3 are requested; zero requests for any other family | E2E — assert network | 001 |
| Sour Gummy renders the product name and display chrome only; no participant content is set in it | E2E | 001 |
| Primary ≥56px, ghost ≥52px, header ≥44px, play ≥32px | E2E | 001 |
| Every interactive element has a visible `:focus-visible` ring | E2E | 001 |
| Watermark, waveform, dots are `aria-hidden` | E2E | 001 |
| No horizontal scroll at 402 / 767 / 768 / 1100 / 1440 | E2E | 001 |
| Desktop grid engages at exactly 768px | E2E | 001 |
| Screens without a bespoke desktop grid centre at 560px | E2E | 001 |
| `prefers-reduced-motion` freezes dots and waveform | E2E | 001 |
| Timer announces via `role="timer"` + `aria-live` | E2E | 003 |
| Checking state announces via `aria-live` | E2E | 002 |
| All rejection reasons render one Withheld layout with the correct text and contribution-specific actions | E2E | 002 |
| Crisis resources render verbatim, all four rows | E2E | 002 |
| Publication, Withheld, exhausted failure, deadline, and abandonment delete the original recording | Integration | 002 |
| No ranking, vote, or reply control in any response list | E2E | 005 |
| No uppercase eyebrow label renders on any screen | E2E | 001 |
| Every Withheld reason offers a fresh recording in the correct answer/question flow | E2E | 002 |
| Crisis resources and a fresh-recording action are both available | E2E | 002 |
