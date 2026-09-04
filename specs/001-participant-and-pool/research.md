# Research: Participant Identity and Question Pool

**Feature**: 001-participant-and-pool | **Date**: 2026-09-04

All versions below were verified against the npm registry and vendor documentation on
2026-09-04. Nothing here is from memory.

---

## D1: Runtime — Node.js 24 LTS

**Decision**: Node.js 24 (Krypton), ESM only. Pin via `.nvmrc` and `engines` in `package.json`.
Constitution v2.0.0.

**Rationale**: Node 24 is Active LTS through 2026-10-20, with maintenance to 2028-04-30. It
satisfies `@google/genai`'s `engines: node >=20.0.0`, and Cloud Run base images, Docker tags, and
native modules have all had a year to settle on it.

**Alternatives considered**:

- **Node 26 (Current, `v26.8.1`)**: briefly adopted, then reverted. It does not reach Active LTS
  until **2026-10-28** — roughly eight weeks after this build window. Until then it takes breaking
  changes on a faster cadence than an LTS, and the native modules this project pulls in through
  the Gemini SDK (`protobufjs`, `ws`) plus the Cloud Run base image are all likelier to lag a
  brand-new major. Not a risk worth carrying on a two-day build.
- **Node 22**: in maintenance since 2025-10-21. No reason to start a new project there.

---

## D2: TypeScript 7.0.2 — accepted, with a lint consequence

**Decision**: TypeScript 7.0.2. Type checking runs through the `tsc` CLI.

**Rationale**: User directive is to run latest. Next.js 16.3 runs the project-local `tsc` binary
by default rather than loading the JavaScript compiler API, which is exactly what makes TS 7
usable — the Go rewrite does not ship `lib/typescript.js`. No `next.config` change is required;
the CLI checker is the default. Microsoft's benchmark shows type-checking VS Code dropping from
125.7s to 10.6s, so on a two-day build the feedback loop is materially better.

**The cost, stated plainly**: `typescript-eslint` does not support TypeScript 7 at any published
version. `typescript-eslint@8.69.0` (latest) and `8.69.1-alpha.0` (canary, 2026-08-31) both
declare `typescript: ">=4.8.4 <6.1.0"`. The programmatic API they depend on does not land until
TypeScript 7.1. `eslint-config-next@16.3.4` hard-depends on `typescript-eslint@^8.46.0`, so the
entire Next.js ESLint preset inherits the conflict.

This forces D3.

**Alternatives considered**:

- **TypeScript 6.0.3** (last 6.x, 2026-04-16): keeps `typescript-eslint` and
  `eslint-config-next` working exactly as expected. Rejected per explicit user directive to run
  latest. This is the fallback if TS 7 causes trouble in dependency `.d.ts` files.
- **TS 7 with `experimental.useTypeScriptCli: false`**: documented to make `next build` exit
  outright, because the JS compiler API is unavailable. Not viable.

---

## D3: Lint and format — Biome 2.5.12

**Decision**: Biome 2.5.12 for both linting and formatting. No ESLint, no Prettier.

**Rationale**: Forced by D2. Biome is a Rust toolchain that parses TypeScript itself and never
loads the TypeScript compiler API, so TS 7 is a non-issue for it. It replaces ESLint and
Prettier with one binary and one config file, which is less to wire up inside the build window.
The constitution specifies Makefile targets (`format`, `format-check`, `lint`) and Lefthook
stages, not specific tools — Biome satisfies both.

**What is lost**: `@next/eslint-plugin-next` rules (`no-html-link-for-pages`,
`no-sync-scripts`, and the rest of the Next-specific set) and all type-aware lint rules. For a
five-screen app the practical exposure is small, and `tsc --noEmit` still catches every type
error — only lint rules that *reason about types* are gone.

**Alternatives considered**:

- **ESLint 10.10.0 + `eslint-config-next`**, accepting the unmet peer: keeps Next rules but
  leaves a standing peer-dependency warning under pnpm. The constitution treats warnings as hard
  errors, so this is non-compliant, not merely untidy.
- **oxlint 1.81.0**: also Rust and also TS-API-free, and it does carry some Next.js rules. Less
  mature configuration story and no formatter, so it would still need a second tool. Revisit if
  the Next-specific rules turn out to be missed.
- **ESLint core only, no TS plugin**: works, but then two tools (ESLint + Prettier) do less than
  Biome does alone.

---

## D4: Framework — Next.js 16.3.4, App Router

**Decision**: Next.js 16.3.4 with the App Router and React 19.2.8. Server route handlers own
every database read and every eligibility decision.

**Rationale**: Pinned by the constitution as a MINOR-amendable decision. 16.3.4 (2026-08-31) is
the current stable on the 16 LTS line and is the version whose default `tsc`-CLI behavior makes
D2 work. Server-side rendering and route handlers give the server-authoritative enforcement that
FR-005 and Principle II require without a separate API service.

---

## D5: Data access — Firebase SQL Connect operations, native SQL for selection

**Decision**: Firebase SQL Connect. Schema and operations are authored in the repository and
deployed from it; the generated typed SDK is used from server route handlers. The
question-selection query uses SQL Connect's **native SQL** path.

**Rationale**: Constitution v2.0.0 pins SQL Connect. Two properties earn it here.

First, it is PostgreSQL, so the selection statement in [data-model.md](data-model.md) survives
intact — one query that filters open questions, excludes the participant's own and already-
answered, aggregates published-answer counts, and orders by that count. Nothing is denormalized
and nothing can drift.

Second, its access model matches Principle II without being argued into it: deployed operations
are stored server-side and clients invoke only predefined ones. Nothing is assembled in the
browser. A NoSQL store would have needed a rule forbidding its own default client path.

**Native SQL for selection, GraphQL for the rest.** The selection query aggregates and orders by
a computed count across a join. Expressing that through GraphQL operations obscures it for no
gain; the constitution explicitly permits native SQL where relational expression is clearer.
Simple reads and writes — get participant, create participant, insert published answer — stay as
generated operations.

**Validation still applies.** Generated types describe the shape the schema promised, not the
shape that arrived. Every row is parsed with **Zod 4.5.4** at the boundary, per Principle V.

**Alternatives considered**:

- **`pg` 8.23.0 with hand-written SQL** — the original plan, and less machinery. Superseded by
  the constitution. It would also have meant provisioning and connecting to Cloud SQL directly,
  which SQL Connect does for us.
- **Everything through GraphQL, no native SQL** — purer, but it hides the one query the whole
  feature turns on behind a layer that is bad at aggregate ordering.
- **Drizzle ORM / Kysely** — rejected on TypeScript 7 inference risk (see D2) and unnecessary for
  three tables. SQL Connect's own codegen supersedes the question entirely.

---

## D6: Schema and migrations — SQL Connect, deployed from the repository

**Decision**: Schema lives in the SQL Connect GraphQL SDL under version control, alongside its
operations. Deployment is from the repository, never from the console.

**Rationale**: The constitution requires it: schema or operations edited by hand in a console do
not exist as far as this repository is concerned. That rule buys reproducibility — the same
tooling that deploys the app deploys the schema, so a fresh environment is one command rather
than a console session someone half-remembers.

`node-pg-migrate` is **dropped**. Running a second migration tool against a database whose schema
SQL Connect already owns is two sources of truth racing each other.

**Alternatives considered**:

- **`node-pg-migrate` 9.0.0** — the original plan. Mature and boring, and exactly the kind of
  redundancy that breaks at 2am on day two when the two tools disagree about what is applied.
- **Console-authored schema** — forbidden by the constitution, and unreviewable.

---

## D7: Managed Postgres — Firebase SQL Connect on Cloud SQL

**Decision**: Firebase SQL Connect, default provisioning, same GCP project as Cloud Run.

**Rationale**: SQL Connect is fully-managed PostgreSQL on Cloud SQL with server-deployed
operations and typed SDKs on top. It keeps the whole stack in one project, one console, and one
IAM boundary alongside Cloud Run, Artifact Registry, Secret Manager, and the transient-audio
bucket. The default configuration (`db-f1-micro`, 1 vCPU, 10 GB, 628.74 MB) carries a three-month
no-cost trial, one per Firebase project, which covers this challenge outright.

**Accepted tradeoffs**:

- **No scale-to-zero.** The instance runs continuously. Free for three months, then from
  $9.37/month. For a weekend build the cost is nil; past that it is a real, small bill.
- **A GraphQL layer to learn.** Schema SDL, operations, and codegen are new machinery inside a
  two-day window. The native-SQL escape hatch limits how much of it has to be mastered up front.
- **`db-f1-micro` is 628 MB of RAM.** Ample for challenge scale; not a production tier.

**Alternatives considered**:

- **Cloud Firestore** — briefly adopted, then reverted. NoSQL: no joins, no cross-collection
  `NOT EXISTS`, no ordering by a query-time aggregate. It would have forced a denormalized
  answer counter maintained transactionally, a membership subcollection for the already-answered
  exclusion, and an application-side tiebreak. That is roughly a day of the two available, and
  the counter is drift-capable underneath the two rules that must not drift — the fewer-answers
  bias (FR-018) and the three-answer closure (004 FR-023). `COUNT` cannot drift; a maintained
  counter can, silently.
- **Neon serverless Postgres** — genuinely viable and the cheapest long-term: free tier,
  scale-to-zero after five minutes, 300–500ms cold start, an HTTP driver that sidesteps Cloud Run
  connection pooling, and the selection query survives with no new machinery at all. Rejected
  only to stay on one vendor inside the existing GCP project. Revisit if the SQL Connect bill or
  the GraphQL layer becomes annoying.
- **Cloud SQL direct with `pg`** — the original plan. Same engine, less tooling, but no
  server-deployed operations and a Cloud SQL instance to wire up by hand.

---

## D8: Anonymous identity — `iron-session` 9.0.1

**Decision**: `iron-session@9.0.1`. Encrypted, signed, `httpOnly`, `SameSite=Lax`, `Secure`
cookie carrying the participant id. Session secret from Secret Manager.

**Rationale**: The constitution prefers frameworks over vanilla code, and iron-session is
purpose-built for exactly this: stateless encrypted cookie sessions with first-class Next.js App
Router support. Rolling HMAC cookie signing by hand with `node:crypto` is maybe thirty lines, but
it is thirty lines of security-relevant code written under time pressure.

The authenticated cookie binds identity; every eligibility decision reads current Postgres
state. Tampered cookies are rejected. Initial identity creation and cookie writes occur in
`POST /api/questions/next`, invoked by the client selection shell, never in a Server Component.

**Accepted limitation**: session-scoped identity means clearing cookies produces a new
participant with no history and no earned ask. Documented in the spec, accepted by the
constitution, and explicitly not solved in this build window.

**Alternatives considered**:

- **`jose` 6.2.11 signed JWT**: works, but JWT claims invite putting authority in the token,
  which is the exact mistake Principle II forbids.
- **Hand-rolled HMAC over a UUID**: fewer dependencies, more security-critical code.
- **Server-side session table**: a second round trip and a table to reap, buying nothing when the
  cookie holds no authority anyway.

---

## D9: Testing — Vitest 5.0.0 and Playwright 1.62.1

**Decision**: Vitest 5.0.0 for unit and integration; Playwright 1.62.1 for end-to-end.

**Rationale**: Vitest 5.0.0 is current stable. Playwright drives the real mobile-viewport checks
that SC-006 requires (iPhone and Android widths, no horizontal scrolling) and is the only way to
prove SC-005 — that this feature triggers **zero** microphone permission prompts — by asserting
`getUserMedia` is never called.

Integration tests run against a real Postgres in Docker, not a mock. Selection rules
(FR-015 through FR-019) are SQL behavior; mocking the database would test the mock.

**Alternatives considered**:

- **`node:test`**: no watch ergonomics, weaker fixture story.
- **Cypress**: heavier, and its mobile-viewport emulation is worse than Playwright's device
  descriptors.

---

## D10: Strict selection order

**Decision**: Read eligible questions ordered by published-answer count ascending, creation time
ascending, and id ascending. Start each pass at the least-answered question. Concurrent
participants can receive the same question; that is accepted.

A pass fixes its order at creation. Re-check eligibility before displaying each candidate and
refresh counts on a new pass. No random tiebreak or probabilistic preference.

---

## D11: Pointer traversal

**Decision**: Keep ordered eligible ids and a pointer only in the current tab's memory.
Skipping increments the pointer without moving ids or adding exclusions; the server validates
the candidate before returning its text. Stale candidates are skipped.

At the end, refresh the list and wrap. Avoid immediately repeating the previous question when
another exists. A singleton stays visible with an explanation; only zero eligible questions
shows empty. Refresh starts a new pass, and tabs have independent pointers.

This uses no skip cookie, exclusion ring, database history, or recovery state.

---

## D12: Visual design imported, staging discarded

**Decision**: The visual design is fixed by the Claude Design project
`Happen to Have UI mockups` (`e13f24fb-d885-4609-a6c0-883711d7a802`), file
`Happen to Have - Arrival.dc.html`. **All 11 staged screens** are transcribed into
[contracts/design.md](contracts/design.md), which is the design system of record for the whole
product. 001 owns the foundation — tokens, header, three button variants, watermark, progress
dots, status badge, list row — and specs 002–005 assemble their screens from it.

**Rationale**: The design exists and is the user's own. Re-deriving a look when one is already
decided wastes the build window and produces something that will not match specs 002–005, whose
screens live in the same source file.

**Staging is discarded.** `ios-frame.jsx` (iOS bezel, dynamic island, home indicator, keyboard)
and `browser-window.jsx` (macOS Chrome traffic lights, tab bar, URL bar) are vendor canvas
scaffolding, both marked `@ds-adherence-ignore -- omelette starter scaffold`. `support.js` is a
generated `dc-runtime` bundle that renders `<x-dc>` / `<x-import>` custom elements. None of the
three has any bearing on a Next.js application, and shipping a simulated phone bezel around a
responsive web app would contradict FR-032 outright.

Two facts do leak usefully out of the staging:

- Each Chrome frame's `url` prop names its route, giving the whole product map: `/`, `/answer`,
  `/answer/record`, `/ask`, `/yours`, `/yours/questions/[id]`. The selection screen is therefore
  `/answer`, not `/question`, and 003 extends that path rather than introducing a second
  vocabulary.
- The desktop preview control declares `min: 768, default: 1100, max: 1440`; the mobile frame is
  `402px`. **768px is the breakpoint**, taken from the design rather than guessed.

**Failure behavior**: the current design contract replaces retained-audio retry with fresh
recording after exhausted processing. Independent check retries happen only during the active
submission; publication, Withheld, failure, deadline, and abandonment delete source audio.

**Gap**: the design covers no empty-pool, loading, or failure state for 001, all three of which
are required (FR-029, FR-030, FR-031). Copy for them is authored in
[contracts/copy.md](contracts/copy.md) and explicitly flagged as needing a design pass.

---

## D13: Fonts — Bricolage Grotesque only, self-hosted

**Decision**: Load **Bricolage Grotesque** alone, through `next/font/google`, with
`system-ui, sans-serif` as the fallback stack. **Figtree and Space Grotesk are out** —
confirmed by the user, and an E2E test asserts no request is ever made for either.

**Rationale**: The design's `<head>` requests three families — Bricolage Grotesque, Figtree, and
Space Grotesk — but every screen's markup sets exactly one:
`font-family:'Bricolage Grotesque',system-ui,sans-serif`. The other two are leftovers from
exploration. Loading three variable families to use one is roughly two unnecessary font payloads
on a mobile-first app whose landing screen is the first impression.

`next/font/google` self-hosts at build time, which removes the render-blocking round trip to
`fonts.googleapis.com` and the `fonts.gstatic.com` connection, and eliminates layout shift via an
automatic size-adjusted fallback.

**Alternatives considered**:

- **Keep the three-family `<link>` verbatim**: faithful to the file, wrong for the product. Two
  of the three are provably unused.
- **`system-ui` only**: free and fast, but the 300-weight display treatment at 58–84px is the
  design's whole identity. System fonts do not carry it.

---

## D14: Fresh recordings after Withheld

**Decision**: Every Withheld reason, including crisis, offers a fresh recording. An answer
returns to its same question; a question returns to `/ask` with the earned ask intact.
Crisis resources stay visible because a classification may be wrong.

Only published contributions exist in the database. A withheld or failed attempt neither
excludes the question nor creates history. Failed checks retry independently within the
active submission; no audio or unpublished attempt survives for later recovery.

**Constitution**: v2.0.0 reverses the crisis retry prohibition and removes retained attempts.
Repeated fresh submissions remain subject to the submission rate limit.

---

## D15: No eyebrow text

**Decision**: The small uppercase label above headings is removed product-wide. Header slots that
held one are empty.

**Rationale**: User directive. The design used it in five places — `Someone asked`, `Recording`,
`Your question`, `You're answering`, `Take a breather`. Every one of them restated what the screen
already made obvious: a question is a question, a running timer means recording. The `--green-80`
token existed only for this label and is removed with it.

---

## Resolved unknowns

| Unknown from Technical Context | Resolution |
| - | - |
| Node version | 24 LTS (D1) |
| TypeScript version and lint consequence | 7.0.2 + Biome (D2, D3) |
| Data access under TS 7 | SQL Connect operations + native SQL for selection + Zod (D5) |
| Managed Postgres provider | Firebase SQL Connect on Cloud SQL, same GCP project (D7) |
| Anonymous identity mechanism | iron-session encrypted cookie (D8) |
| Selection ordering semantics | strict answer count, creation time, id (D10) |
| Skip memory durability | tab-local ordered ids and pointer, discarded on reload (D11) |
| Visual design source and staging | all 11 screens imported; frames discarded (D12) |
| Full route map | from the design's URL props (D12) |
| Breakpoint | 768px, from the design's own preview range (D12) |
| Selection route path | `/answer`, from the design's URL bar (D12) |
| Font loading | Bricolage Grotesque only, self-hosted (D13) |
| Question exclusion after a withheld attempt | no stored row; stays eligible; fresh recording offered including crisis (D14) |
| Eyebrow labels | removed product-wide (D15) |

## Open risks carried into implementation

- **TS 7 against dependency type definitions** is unproven for this dependency set. No vendor
  declares support because no vendor declares a TypeScript peer range. Mitigation: `make
  typecheck` is the first thing run after `pnpm install`; the documented fallback is TypeScript
  6.0.3, which restores `eslint-config-next` and costs only build speed.
- **Losing `@next/eslint-plugin-next`** may surface as Next-specific mistakes that lint would
  have caught. Mitigation: revisit oxlint, or move to TS 7.1 once `typescript-eslint` supports it.
- **Three unstyled states** (empty pool, loading, failure) ship on authored copy and tokens
  alone. The empty state is the one a judge is most likely to hit by clicking once more than
  expected. Mitigation: a short design pass on those three before the demo.
- **`all: unset` on buttons** removes the default focus outline. Copied literally from the design
  it is an accessibility regression. Mitigation: an explicit `:focus-visible` ring is a stated
  requirement in [contracts/design.md](contracts/design.md) with an E2E test behind it.
