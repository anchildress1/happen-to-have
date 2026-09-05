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

## D5: Data access — `@neondatabase/serverless`, plain parameterized SQL

**Decision**: Talk to Postgres directly through `@neondatabase/serverless` 1.1.0. No ORM, no
query builder, no generated SDK. Hand-written parameterized SQL, validated with Zod at the
boundary.

**Rationale**: Three reasons, in order of weight.

First, the selection query in [data-model.md](data-model.md) is the whole feature: one statement
that filters open questions, excludes the participant's own and already-answered, aggregates
published-answer counts, and orders by that count. It is exactly what SQL is for, and exactly
what every abstraction above SQL makes harder.

Second, KISS and YAGNI outrank other design preferences per Principle VI. Three tables, six
queries. Nothing above raw SQL earns its place at this size.

Third, TypeScript 7.0.2 is a from-scratch type checker released 2026-07-08. Libraries whose
value is deep type inference — Drizzle, Kysely — are the ones most likely to hit checker
differences, and none declares a TypeScript peer range. `@neondatabase/serverless` exposes a
node-postgres-compatible `Pool` with shallow types.

**Why the serverless driver over plain `pg`**: it speaks Neon's pooled endpoint natively and
handles connection reuse in short-lived serverless invocations, which is the pressure research
D7 flagged for Cloud Run. It is `pg`-API-compatible, so moving to plain `pg` later is an import
change, not a rewrite.

**Validation is not optional.** Generated types would have described the shape the schema
promised; hand-written SQL describes nothing at all. Every row is parsed with **Zod 4.5.4**
before it leaves the query module, per Principle V.

**Alternatives considered**:

- **Firebase SQL Connect** — adopted, fully implemented, then reverted. Its differentiator is
  server-deployed operations that clients may safely invoke. Every generated operation ended up
  annotated `@auth(level: NO_ACCESS)`, because nothing client-side touches the database — route
  handlers own every read. That left 1.9 MB of Admin SDK, a codegen step, a build-order
  dependency in CI, and a second connection pool, all serving three one-line queries.
- **Drizzle ORM / Kysely** — TypeScript 7 inference risk, and unnecessary for three tables.
- **Plain `pg`** — works, and is the fallback if Neon is ever left behind. The serverless driver
  is strictly better while on Neon.

---

## D6: Schema and migrations — `node-pg-migrate` 9.0.0

**Decision**: Schema lives in SQL migrations under `migrations/`, applied with
`node-pg-migrate` 9.0.0 and committed to the repository.

**Rationale**: Plain `.sql` files, applied in order, tracked in a `pgmigrations` table. It gives
up/down, an applied-migrations ledger, and a CLI, and it is boring in the way schema tooling
should be. The initial migration is transcribed directly from [data-model.md](data-model.md) and
is the authoritative schema — there is no second source.

Migrations run against whichever Neon branch is checked out (D7a), so a schema change is
developed and tested on an isolated database before it reaches `main`.

**Alternatives considered**:

- **A hand-rolled runner over numbered `.sql` files** — about 25 lines and zero dependencies, but
  hand-rolling the applied-migrations ledger is what quietly breaks at 2am on day two.
- **SQL Connect schema SDL** — went away with D5.
- **An ORM's migration generator** — rejected with the ORM.

---

## D7: Database host — Neon

**Decision**: Neon serverless Postgres. Project `silent-meadow-11692011` in org
`org-bold-hat-14494774`, region `aws-us-east-2`, Postgres 18.

**Rationale**: Neon was the right answer twice before it was chosen, and the reasons held up.

- **Scale-to-zero and a free tier.** 0.5 GB storage and 100 CU-hours per month, suspending after
  five minutes idle with a 300–500ms cold start. Against SC-001's ten-second budget that is
  noise, and the weekend costs nothing.
- **The selection query survives untouched.** It is Postgres.
- **Branchable databases**, which D7a builds on.
- **An HTTP/pooled driver** that sidesteps the Cloud Run connection-pool pressure a
  conventional instance would create.

**Accepted tradeoffs**:

- **A second vendor.** Everything else — Cloud Run, Artifact Registry, Secret Manager, the
  transient-audio bucket — is GCP. Neon adds one console and one secret. This was the objection
  that kept Neon out twice; it is smaller than it looked once SQL Connect's differentiator
  turned out to be disabled.
- **Region split.** Neon is `aws-us-east-2` (Ohio); Cloud Run is GCP `us-east1` (South
  Carolina). Single-digit milliseconds of cross-cloud latency on the selection query. Chosen
  over `us-east-1` because Neon's beta primitives — Object Storage in particular, which 002 may
  want for transient audio — are region-gated to `us-east-2` and `eu-central-1`.

**Alternatives considered**:

- **Firebase SQL Connect** — see D5. Also never solved the cost floor: Cloud SQL underneath, a
  three-month trial, then from $9.37/month.
- **Cloud SQL direct** — GCP-native and boring, but a 24/7 instance with no free tier and no
  branching.
- **Supabase** — same second-vendor cost, plus a large surface this project uses none of.

---

## D7a: Branch-first development

**Decision**: Every git branch gets a Neon branch, created with `neon checkout`. Migrations run
against the checked-out branch. `.neon` and `.env` stay gitignored.

**Rationale**: A Neon branch is a copy-on-write clone, so it costs approximately nothing. This
project ships as a stack of dependent pull requests, and 002's migrations will change the schema
underneath 003–005. Without isolation, one branch's migration breaks every other branch's tests.

`neon checkout` re-pulls `DATABASE_URL` on every switch, so changing git branches swaps the
database under the application with no manual step.

**Known sharp edge**: the Neon skill states that `neon checkout <name>` creates a missing branch.
**On CLI 4.14.1 it does not** — it errors with "Branch not found." Create it first with
`neon branches create --name <name> --parent main`. `make db-up` wraps both.

**Alternatives considered**:

- **A single shared database for the weekend** — simpler, and wrong the first time two stacked
  branches disagree about the schema.
- **A local Postgres in Docker** — the original plan. Neon branches make it redundant: a real
  database per branch, no container to run.

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

## D13: Fonts — Sour Gummy for display, Source Sans 3 for everything else

**Decision**: **Sour Gummy at weight 600** sets the product name and display chrome. **Source Sans 3** sets
participant content, body, UI, and meta. Both load through `next/font/google`. Nothing else
loads.

**Rationale**: Sour Gummy carries the product's voice at large sizes. Its subset coverage is
too narrow for body or participant text, so pairing it is not a preference — it is what the
family can and cannot do.

**Verified against the Google Fonts metadata API**: Sour Gummy is a variable family with
`wght` 100–900 and `wdth` 100–125, subsets latin and latin-ext. Only weight 600 is requested,
so a single instance ships and the width axis is unused.

**Two consequences worth stating plainly, because neither is reversible by tuning:**

**Weight 300 is gone.** The imported design set every display element at 300, and that thinness
was the identity. Display type is now 600 and reads heavier and denser than the mockups. Faking 300 with a lighter colour or a synthetic stroke looks worse than the honest
weight, so the design changes rather than the rendering.

**Sour Gummy cannot carry participant content.** Question and answer text renders at display sizes,
but it is participant writing, and 002 translates contributions into the display language.
Sour Gummy has no Cyrillic, no Greek, no Vietnamese, no CJK. A translated contribution set in it would fall
back mid-sentence or render as tofu. Source Sans 3 takes every string a participant wrote,
regardless of size — the split is by *origin*, not by type scale.

`next/font/google` self-hosts at build time, removing the render-blocking round trip to
`fonts.googleapis.com` and eliminating layout shift through a size-adjusted fallback.

**Alternatives considered**:

- **Paprika** — an earlier pick, replaced by direction. Display category, weight 400 only.
- **Bricolage Grotesque** — the imported design's face, replaced by direction. It had the 300
  weight and a wider subset range; the tradeoff is accepted deliberately.
- **Sour Gummy for everything** — a Display face at 16px body is a legibility problem, and the
  subset gap becomes a correctness problem the moment a non-English contribution publishes.
- **A system-font stack** — free and fast, but the product name at 58–84px is the whole first
  impression, and system faces do not carry it.

**Source Sans 3, verified on 2026-09-04**: variable `wght` axis spanning 200–900, so 400 and 500
both come from one file. Subsets: latin, latin-ext, cyrillic, cyrillic-ext, greek, greek-ext,
vietnamese — seven against Sour Gummy's two, and wider than the Bricolage Grotesque it replaces.

**A finding worth keeping**: Google Fonts **strips GSUB features from its subsets**. The served
Source Sans 3 has *no* OpenType features, so `font-variant-numeric: tabular-nums` — which the
imported design specified for the recorder timer — is a silent no-op. It would have looked
correct in review and done nothing.

It does not matter, because Source Sans 3's digits are **monospaced by default**: every glyph
`0`–`9` advances 472 units in the served font, measured directly from the woff2. The timer will
not jitter. But the declaration is removed rather than left in as decoration, and the reason is
recorded so nobody adds it back to fix a bug it cannot fix.

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
| Data access under TS 7 | `@neondatabase/serverless` + parameterized SQL + Zod (D5) |
| Managed Postgres provider | Neon, aws-us-east-2, Postgres 18 (D7) |
| Per-branch database isolation | branch-first via `neon checkout` (D7a) |
| Anonymous identity mechanism | iron-session encrypted cookie (D8) |
| Selection ordering semantics | strict answer count, creation time, id (D10) |
| Skip memory durability | tab-local ordered ids and pointer, discarded on reload (D11) |
| Visual design source and staging | all 11 screens imported; frames discarded (D12) |
| Full route map | from the design's URL props (D12) |
| Breakpoint | 768px, from the design's own preview range (D12) |
| Selection route path | `/answer`, from the design's URL bar (D12) |
| Font loading | Sour Gummy 600 for display + Source Sans 3, self-hosted (D13) |
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

---

## D16: Import specifiers carry no extension in `src/` and `app/`

**Decision**: Relative and aliased imports inside `src/` and `app/` are **extensionless**.
`seed/seed.ts` is the one exception and imports `../src/db/client.ts` with its real extension.

**Rationale**: Turbopack does not substitute `.js` for `.ts` during resolution, and Next.js 16
exposes no configuration that would make it. `turbopack.resolveExtensions` controls which
extensions are *appended* to an extensionless specifier; it cannot rewrite one that is already
present. There is no `extensionAlias` equivalent.

So `import { db } from '../client.js'` fails to build the moment anything under `app/` pulls that
module into the bundler graph — which is exactly what happened when the first route handler
landed. The failure is invisible until then: `tsc` and Vitest both resolve `.js` to `.ts`
happily, so a file can typecheck and unit-test clean for days and break the build the first time
a page imports it.

Aliased specifiers fail harder still. `paths` maps `@/copy.js` to `./src/copy.js` before any
extension logic runs, producing a literal path that does not exist.

`moduleResolution: "bundler"` — already set in `tsconfig.json` — makes extensionless imports
correct TypeScript. The `.js`-suffix convention belongs to `node16`/`nodenext`, which this
project does not use for bundled code.

**Why `seed/` is exempt**: it runs under plain `node`, whose ESM resolver requires a real
extension. It imports `src/db/client.ts` directly, and that module imports only bare package
specifiers, so Node never traverses a rewritten path.

**Alternatives considered**:

- **Configure Turbopack** — no such option exists. Verified against the Next.js 16.3.4
  `turbopack` config reference.
- **`.js` everywhere, bundle the seed script** — adds a build step to a script whose whole appeal
  is that Node 24 runs the TypeScript directly.
- **Drop the `@/*` alias** — would fix the aliased case and leave the relative case broken.
