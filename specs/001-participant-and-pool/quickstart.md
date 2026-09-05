# Quickstart: Participant Identity and Question Pool

**Feature**: 001-participant-and-pool | **Date**: 2026-09-04

Run the feature locally and prove each success criterion. Written for someone with the repo
cloned and nothing else.

---

## Prerequisites

| Tool | Version | Check |
| - | - | - |
| Node.js | 24 LTS | `node --version` |
| pnpm | 11.25.0 | `pnpm --version` |
| Neon CLI | 4.14.1 | `neon --version` |

Tests need no database service: integration tests run Postgres in-process via PGlite.

`.nvmrc` pins Node 24. With `nvm`, `nvm use` in the repo root is enough.

---

## Setup

```bash
pnpm install
cp .env.example .env
```

Fill `.env`:

| Variable | Local value | Production source |
| - | - | - |
| `DATABASE_URL` | pulled by `neon checkout` | Secret Manager |
| `SESSION_SECRET` | any 32+ char string — `openssl rand -base64 32` | Secret Manager |

Do not set `NODE_ENV` in `.env`. Next sets it per command, and pinning it to `development`
breaks `next start` and would drop the session cookie's `secure` flag in a deployment.

`.env` is gitignored. Never commit a real secret; `.env.example` carries placeholders only.

Check out a Neon branch for your git branch, migrate, and seed:

```bash
make db-up        # create + check out dev-<git-branch>; pulls DATABASE_URL into .env
make migrate      # node-pg-migrate up against that branch
make seed         # upserts seed/questions.json by id; idempotent, safe to re-run
make dev          # http://localhost:3000
```

Every git branch gets its own copy-on-write Neon branch, so a migration you are developing
never touches another branch's database. `neon checkout` re-pulls `DATABASE_URL` on every
switch.

Sharp edge: the Neon docs say `neon checkout <name>` creates a missing branch. On CLI 4.14.1 it
does not — it errors with "Branch not found." `make db-up` runs `neon branches create` first.

---

## Validation scenarios

Each maps to success criteria in [spec.md](spec.md). Automated equivalents live in `tests/`.

### 1. Arrival and first question — SC-001, FR-006, FR-007

1. Open `http://localhost:3000` in a **fresh private window**.
2. Expect `Happen to Have?` and `Answer one. Ask one.` verbatim, `Find me a question`, and the
   helper line `Sixty seconds, in your own voice. Once your answer counts, you can ask.`
3. Click it. You land on `/answer`. The question renders with no label above it, and both
   `I can answer this` and `Try another question` are present.
4. Elapsed from page open to question visible: **under 10 seconds**.

No iPhone bezel and no browser chrome may appear anywhere — those exist only in the design
canvas and must not ship.

Confirm identity was created on interaction, not page view:

```bash
make db-shell   # psql against the checked-out Neon branch
select count(*) from participants;   -- 1 after clicking, not after merely loading /
```

### 2. Skipping is free — SC-003, FR-020 through FR-025

1. Click `Try another question` twenty times.
2. Expect the pointer to follow answer-count/creation/id order and wrap after the last item.
3. Repeat with two eligible questions (A → B → A), one question (keep it visible with its helper),
   and zero questions (empty); no skip writes a cookie or rearranges the list.
4. Confirm nothing was written:

```sql
select can_ask from participants;         -- false, unchanged
select count(*) from answers;             -- 0
```

`can_ask` flipping here is a hard failure — it means skipping touched eligibility.

### 3. Exclusions — SC-002, FR-015 through FR-017

```bash
make db-shell   # psql against the checked-out Neon branch
```

```sql
-- your participant id
select id from participants order by created_at desc limit 1;

-- own question: insert one authored by you
insert into questions (participant_id, display_text) values ('<your-id>', 'My own question');

-- already answered AND published: this one is excluded
insert into answers (question_id, participant_id)
values ('<some-question-id>', '<your-id>');

-- withheld/failed submissions leave no answer row; another unanswered question stays eligible

-- closed
update questions set status = 'closed' where id = '<another-id>';
```

Now skip through the entire pool.

- Your own question, the published-answer question, and the closed question **never** appear.
- The other unanswered question **still does**; an unpublished attempt creates no exclusion.

That last one is the retry rule (FR-016a): only published answers exist in the table, so a
withheld recording cannot exclude its question. 002/003 test that no row is inserted on rejection.

### 4. Strict least-answered order — SC-004, FR-018

Give eligible questions zero, one, and two published answers, with fixed creation times and ids.
Start a new pass: expect count 0 first, then 1, then 2 as the pointer advances, followed by wrap.
Repeat with tied counts to prove creation/id ordering, and with a question becoming closed mid-pass
to prove eligibility is checked before display. Counts are refreshed when the next pass starts.

### 5. Empty pool — SC-007, FR-029

> No design exists for this state (see [contracts/design.md](contracts/design.md) *Gaps*). It
> renders from authored copy on the design tokens.

```sql
update questions set status = 'closed';
```

Reload `/answer`. Expect `Nothing waiting right now` — **not** an error, not a blank screen,
not a closed question shown anyway.

### 6. Loading and failure — SC-007, FR-030, FR-031

There is no `make db-down`. Point the app at an unreachable host instead:

```bash
DATABASE_URL='postgres://u:p@ep-does-not-exist.us-east-2.aws.neon.tech/db' make dev
```

Reload `/answer`. Expect `That didn't load` and a working `Try again`; the API returns
`500 {"error":"selection_failed"}` with no driver message. Restore the real `DATABASE_URL`
(`make db-up`) and the retry succeeds.

### 7. Zero microphone prompts — SC-005

Click through every route. **No permission prompt may ever appear.** This feature ends at
`I can answer this` and touches no recording API.

```bash
pnpm exec playwright test a11y
```

`tests/e2e/a11y.spec.ts` asserts `navigator.mediaDevices.getUserMedia` is never invoked on
any route.

### 8. Responsive — SC-006

```bash
pnpm exec playwright test responsive
```

Widths come from the design, not from guesswork: the mobile frame is `402px` and the desktop
preview range is `768–1440` with a `1100` default ([contracts/design.md](contracts/design.md)).

Asserts on every route, at `402`, `767`, `768`, `1100`, and `1440`:

- `scrollWidth <= clientWidth` — no horizontal scrolling
- the layout switches to the desktop grid at exactly `768px`
- the `?` watermark is clipped and never introduces overflow

### 9. Retry after a withheld answer — FR-016a, FR-027a

Belongs to 002 and 003, listed here because 001's selection query is what makes it possible.

Once the answer flow exists: submit a deliberately irrelevant answer, land on the result page,
and confirm `Record another answer` returns you to the **same** question rather than making you
hunt for it. Confirm the crisis variant also offers fresh recording alongside its resources.
Repeat for a withheld question and confirm it opens `/ask` with the earned ask intact.

Until then, scenario 3 verifies selection behavior only; it does not prove the unbuilt review.

### 10. Session reset is a known limitation

Open a private window. You are a new participant with no history. **This is correct behavior**
for the weekend build, documented in the README, and not a bug to file.

### 11. Design fidelity — [contracts/design.md](contracts/design.md)

```bash
pnpm exec playwright test design
```

Asserts: no device or browser frame anywhere; only Sour Gummy and Source Sans 3 are requested,
with zero requests for any other family; no participant content is set in Sour Gummy; primary
buttons ≥56px, ghost ≥52px, header ≥44px; every interactive element shows a visible
`:focus-visible` ring; watermark and status dot are `aria-hidden`; no uppercase eyebrow label
renders anywhere.

The focus ring is the one to watch — the design uses `all: unset` on real `<button>` elements,
which strips the default outline. Copied literally, that is an accessibility regression.

---

## Full check

```bash
make ai-checks    # format-check, lint, typecheck, test, e2e, secret-scan
```

Everything must pass with **zero warnings** — the constitution treats warnings as hard errors.

---

## If `make typecheck` fails on dependency types

The known risk from [research.md](research.md) D2. TypeScript 7.0.2 is two months old and no
dependency here declares a TypeScript peer range, so nothing guarantees third-party `.d.ts` files
compile cleanly under the new checker.

Documented fallback:

```bash
pnpm add -D typescript@6.0.3
```

Then restore ESLint + `eslint-config-next` in place of Biome — TypeScript 6 is inside
`typescript-eslint`'s `>=4.8.4 <6.1.0` peer range. Cost is build speed, not correctness. Record
the swap in `research.md` if you take it.

---

## Deploy

```bash
./deploy.sh    # build, push to Artifact Registry, deploy to Cloud Run ($REGION, default us-east1)
```

Requires `SESSION_SECRET` and `DATABASE_URL` in Secret Manager, the Neon project reachable,
and migrations applied against `main`.
