# Implementation Plan: Participant Identity and Question Pool

**Branch**: `001-participant-and-pool` | **Date**: 2026-09-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-participant-and-pool/spec.md`

## Summary

Stand up the application shell and deliver the first participant journey: arrive, become an
anonymous participant, receive one question from the pool, skip freely until something fits.

This feature ends at `I can answer this`. No recording, no review, no asking.

Because it is the first feature built, it also carries the project scaffold — Next.js app,
database, migrations, tooling, CI — **and the shared design system**. The imported design covers
all 11 screens across all five specs; 001 builds the tokens, header, buttons, and layout that the
other nine screens are assembled from. That foundation is real work and is planned here rather
than pretended away.

The technical approach: a single Next.js 16 App Router application on Node 24, backed by Cloud
Neon serverless Postgres, reached through `@neondatabase/serverless` with plain parameterized
SQL. Identity is an encrypted `iron-session` cookie
that carries a participant id and no authority whatsoever — every eligibility decision reads
current state from the database. Selection is one SQL statement that filters eligible questions
and orders them by answer count, creation time, and id. Each tab advances a pointer through
that list and refreshes it on wrap; no skip history is stored.

One decision is louder than the rest: running TypeScript 7 (per direction to use latest) makes
`typescript-eslint` unusable at every published version, which takes `eslint-config-next` with
it. Lint and format move to Biome. Full reasoning in [research.md](research.md) D2 and D3.

## Technical Context

**Language/Version**: TypeScript 7.0.2 on Node.js 24 LTS, ESM only. Imports in `src/` and `app/`
carry **no file extension** — Turbopack cannot resolve `.js` to `.ts` and offers no setting that
would (research D16). `seed/` is exempt; it runs under plain Node.

**Primary Dependencies**: Next.js 16.3.4 (App Router), React 19.2.8,
`@neondatabase/serverless` 1.1.0, `node-pg-migrate` 9.0.0, `iron-session` 9.0.1, Zod 4.5.4,
`next/font/google` (Paprika + Source Sans 3)

**Storage**: Neon serverless Postgres 18 (`aws-us-east-2`), project
`silent-meadow-11692011`. Schema owned by committed migrations. Every git branch gets its own
copy-on-write Neon branch.

**Testing**: Vitest 5.0.0 (unit, integration against Dockerized Postgres), Playwright 1.62.1 (E2E,
mobile viewports)

**Tooling**: pnpm 11.25.0, Biome 2.5.12 (lint + format), Lefthook 2.1.12, commitlint 21.2.2

**Target Platform**: Responsive web. Cloud Run (`us-east1`), container from a repo-root
Dockerfile via Artifact Registry. Browsers: current mobile Safari, Android Chrome, desktop
evergreen.

**Project Type**: Web application — single Next.js project, server route handlers included. Not
a monorepo.

**Performance Goals**: A first-time visitor reaches a displayed question in under 10 seconds
(SC-001). Question selection is one indexed query.

**Constraints**: Zero microphone permission prompts anywhere in this feature (SC-005). No
horizontal scrolling at any width (SC-006). All eligibility computed server-side; client state
is advisory only. Visual design is fixed by [contracts/design.md](contracts/design.md); the
breakpoint is 768px.

**Scale/Scope**: Weekend challenge scale — tens of participants, a seeded pool of at least
15 questions, 3 database tables, 2 screens of its own plus the shared shell that the other four
specs' 9 screens are built on.

## Constitution Check

Checked against constitution **v2.0.0**. Re-checked after Phase 1 design and after the
Principle II amendment — result unchanged.

| Principle | Applies here? | Status | Evidence |
| - | - | - | - |
| I. Human Contribution Is The Product | Partially | **PENDING SEEDS** | Ashley authors the seeds; content and provenance remain TBD. No generated substitutes or agent framing (FR-010). |
| II. Server-Authoritative Reciprocity | Yes | **PASS** | Cookie carries identity only, never authority (research D8). Selection exclusions FR-015–FR-017 enforced in SQL, with FR-016a keeping withheld attempts retryable per constitution v2.0.0. Skipping cannot touch eligibility (FR-022). Closure state honored, defined in 004. |
| III. Aggregate Guardrail Gate | No | **N/A** | No contribution is submitted or reviewed in this feature. |
| IV. Original Audio Is Transient | No | **N/A** | No audio is captured. Enforced negatively: SC-005 asserts zero `getUserMedia` calls. |
| V. Structured Output Or Failure | Partially | **PASS** | No model output here. The underlying rule — validate before use — is applied to database rows via Zod at the boundary (research D5). |
| VI. Scope Discipline | Yes | **PASS** | No ORM for 3 tables. No signup. No public browse, search, or tags. Scope ends at `I can answer this`. Exclusion list in spec Out of Scope. |
| VII. Voice And Provenance | Yes | **PASS** | FR-006–FR-012 encode the name, tagline, forbidden framings, dialect prohibition, and the ban on "safe" positioning. Copy is fixed in `contracts/copy.md` and audited against the imported design — no forbidden term appears in it. |

### Infrastructure and workflow gates

| Gate | Status | Note |
| - | - | - |
| Cloud Run `us-east1`, root `deploy.sh`, Artifact Registry | **PASS** | Planned in Phase 1 structure. |
| Secrets in Secret Manager or gitignored `.env` | **PASS** | Session secret and database URL from Secret Manager; `.env.example` committed, `.env` ignored. |
| Managed Postgres reachable from Cloud Run | **PASS** | Neon, pooled endpoint, bounded pool. Research D7. |
| Node 24 LTS, ESM only, no CommonJS | **PASS** | `"type": "module"`, research D1. |
| Next.js App Router, TypeScript strict | **PASS** | research D4. |
| pnpm | **PASS** | pnpm 11.25.0. |
| Makefile exposes the 12 required targets | **PASS** | Phase 1 structure. |
| Lefthook pre-commit / commit-msg / pre-push | **PASS** | Phase 1 structure. |
| CI with SonarCloud, CodeQL, Release Please, Dependabot | **PASS** | Phase 1 structure. Dependabot max 2 open PRs, 7-day cooldown. |
| Every dependency version verified against a current source | **PASS** | All versions verified against the npm registry on 2026-09-04, recorded in research.md. |
| Warnings are hard errors | **PASS** | This is precisely why ESLint was dropped — see Complexity Tracking. |

**Result: design contracts aligned; seed readiness pending.** These are planning checks, not executed implementation validation.

## Project Structure

### Documentation (this feature)

```text
specs/001-participant-and-pool/
├── plan.md              # This file
├── research.md          # Phase 0 — 13 decisions with alternatives
├── data-model.md        # Phase 1 — schema, indexes, selection query
├── quickstart.md        # Phase 1 — run it and prove it works
├── contracts/
│   ├── design.md        # Tokens, type scale, layout, components; staging that must not ship
│   ├── routes.md        # Route handler and page contracts
│   ├── session.md       # Cookie shape and identity contract
│   └── copy.md          # Fixed participant-facing strings
├── checklists/
│   └── requirements.md  # Spec review; seeds and runtime proof pending
└── tasks.md             # Phase 2 — created by /speckit-tasks, NOT here
```

### Source code (repository root)

```text
.
├── app/
│   ├── layout.tsx                   # Root layout, theme, viewport meta
│   ├── page.tsx                     # Landing: name, tagline, Find me a question
│   ├── answer/
│   │   ├── page.tsx                 # Selection shell; client POST establishes identity
│   │   ├── loading.tsx              # FR-030 loading state — no design, authored
│   │   └── error.tsx                # FR-031 failure state with retry — no design, authored
│   └── api/
│       └── questions/
│           ├── next/route.ts        # POST — select a question for this participant
│           └── skip/route.ts        # POST — validate/read the next pointer candidate
├── src/
│   ├── db/
│   │   ├── client.ts                # @neondatabase/serverless Pool, server-only
│   │   └── queries/
│   │       ├── participants.ts      # find-or-create by session id
│   │       └── questions.ts         # eligible-question selection
│   ├── session/
│   │   └── session.ts               # iron-session config, get-or-create participant
│   ├── schema/
│   │   └── rows.ts                  # Zod parsers for every row shape
│   └── ui/
│       ├── tokens.css               # design.md token block, :root custom properties
│       ├── AppHeader.tsx            # contextual left/right slots, all six variants
│       ├── Button.tsx               # primary | ghost | muted, focus-visible ring
│       ├── Watermark.tsx            # decorative ?, aria-hidden, .09 / .05
│       ├── ProgressDots.tsx         # 10px and 6px, reduced-motion aware
│       ├── StatusBadge.tsx          # success | withheld | failure
│       ├── ListRow.tsx              # shared response/history row
│       ├── QuestionCard.tsx         # question + both actions
│       └── EmptyPool.tsx            # FR-029 — no design, authored
├── migrations/
│   └── *_initial-schema.sql         # authoritative schema, applied by node-pg-migrate
├── seed/
│   ├── questions.json               # Ashley-authored seeds; content/provenance TBD
│   └── seed.ts                      # idempotent seeding script
├── tests/
│   ├── unit/                        # Zod parsers, session helpers
│   ├── integration/                 # selection rules against real Postgres
│   └── e2e/                         # Playwright: landing, skip, empty, mobile
├── .github/
│   ├── workflows/{ci.yml,codeql.yml,release-please.yml}
│   ├── dependabot.yml
│   └── CODEOWNERS
├── biome.json
├── lefthook.yml
├── commitlint.config.js
├── next.config.ts
├── tsconfig.json
├── Dockerfile
├── deploy.sh
├── Makefile
├── .nvmrc
└── .env.example
```

**Structure Decision**: Single Next.js application at the repository root. Not a monorepo, and no
separate backend service — App Router route handlers are the server, which is what keeps
eligibility decisions server-side without a second deployable. `app/` holds routing and UI;
`src/` holds everything testable in isolation; `tests/` mirrors that split. This is the layout
the remaining four specs extend rather than restructure.

## Phase 1 outputs

| Artifact | Contents |
| - | - |
| [data-model.md](data-model.md) | Three tables, the columns 001 actually needs, indexes, and the annotated selection query |
| [contracts/routes.md](contracts/routes.md) | Two route handlers and two pages, with request/response shapes and status codes |
| [contracts/session.md](contracts/session.md) | Cookie name, flags, payload shape, and the authority boundary |
| [contracts/copy.md](contracts/copy.md) | Every fixed participant-facing string, so Principle VII is verifiable |
| [contracts/design.md](contracts/design.md) | **Design system of record for the whole product** — tokens, type, layout, 11 components, the full route map, and all 11 screens with their copy, marked by owning spec |
| [quickstart.md](quickstart.md) | Clone-to-running steps and the checks that prove each success criterion |

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| - | - | - |
| Biome replaces ESLint + Prettier, dropping `eslint-config-next` and all Next-specific lint rules | Running TypeScript 7 (explicit user direction to use latest) makes `typescript-eslint` unusable at every published version — `8.69.0` and canary `8.69.1-alpha.0` both peer `typescript >=4.8.4 <6.1.0`. `eslint-config-next@16.3.4` hard-depends on it. Biome never loads the TypeScript API, so it is unaffected. | Keeping ESLint would leave a permanent unmet peer-dependency warning under pnpm, which the constitution classifies as a hard error. Downgrading to TypeScript 6.0.3 would restore ESLint but contradicts the directive to run latest. Documented fallback if TS 7 misbehaves against dependency type definitions. |

### Constitution amendment — resolved

Constitution v2.0.0 permits a fresh recording for every Withheld reason, including crisis.
It also removes durable unpublished attempts and restricts structured output to review calls;
TTS validates returned audio. Selection uses strict ordering and tab-local pointer traversal.
The session is established in the first selection POST, never during Server Component rendering.

### Known debt introduced by the scaffold

`package.json`'s `test:integration` script carries `--passWithNoTests`. Vitest exits non-zero on a
project with no test files, and the integration suite does not exist until T027 and T032, so
without the flag `make ai-checks` could never pass during Phase 1.

It is **temporary and must be removed by T032a**. Left in place past that point it hides a real
failure mode: integration tests that stop being discovered — a renamed directory, a broken glob,
a misconfigured project — would report green instead of red. A suite that passes because it found
nothing is worse than no suite, because it buys false confidence in the reciprocity gate.

### Deviation notes

The full database schema from the handoff is **not** created in this feature's migration. Only
the columns 001 reads and writes exist here; 002 through 005 add their own columns as they need
them. Creating twenty unused columns up front to match a document is speculative work, and
Principle VI is explicit that "it might be useful later" is not a justification. See
[data-model.md](data-model.md) for the columns deferred and which spec owns each.
