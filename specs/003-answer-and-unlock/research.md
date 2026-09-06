# Research: Answer One

**Feature**: 003-answer-and-unlock · **Date**: 2026-09-06

Only decisions that changed the build. Where something was measured, the measurement is here;
where it was reasoned, the reasoning says so.

---

## D1 — The ask is a boolean on the participant, not a ledger

**Decision**: ask eligibility stays `participants.can_ask boolean`. No asks table, no counter,
no grant history.

**Rationale**: FR-023 caps unspent asks at one. A column that can hold exactly the two states
the product allows cannot drift into a third; a counter can, and the first bug in 004 would be
a participant holding two.

The grant is expressed as `UPDATE participants SET can_ask = true WHERE ... AND can_ask = false`.
The guard is what makes FR-021 true — a second passing answer publishes and grants nothing —
and it is one predicate rather than a read, a comparison and a write.

**Alternatives considered**:

- *An `asks` table with a row per grant* — makes "how many unspent asks" a query rather than a
  fact, and makes FR-023 an invariant to enforce rather than a shape that cannot violate it.
  It would also be the durable history Principle V says not to build.
- *A counter column* — same problem, fewer rows. `can_ask = 2` is representable; the product
  has no meaning for it.

**Cost paid**: 005 cannot show "you have earned 4 asks over time" without a new table. Nothing
in 003–005 asks for that.

---

## D2 — Every eligibility rule is one statement, because every rule is a race

**Decision**: FR-016, FR-017 and FR-019 are enforced inside a single `WITH` statement, not by
reading and then writing.

**Rationale**: all three rules are checks on state that another request can change between the
read and the write. Two tabs, a double-tap, a retried upload after a dropped response — a
`SELECT` that says *not yet answered* is true only until the second insert lands.

The statement is four parts: `eligible` filters the question, `published` inserts, `granted`
updates, and the outer `SELECT` reports both. Nothing between them can interleave.

**Two guards, not one, and neither is observable while the other stands.** `NOT EXISTS` refuses
cheaply and reports `ineligible`; `ON CONFLICT DO NOTHING` closes the window where two
statements both read *no answer yet*. Mutation testing found that removing either alone left
every behavioural test green — which is why the statement itself is asserted, and why the first
attempt at asserting it was vacuous: it matched the string `NOT EXISTS`, which also appears in
a comment two lines below.

**`IS DISTINCT FROM`, not `<>`.** A seeded question has a NULL author, and `<>` evaluates to
NULL there — dropping the row and refusing an answer to every seeded question in the pool. This
is the whole starting pool.

**Alternatives considered**:

- *Read, check in TypeScript, then write* — readable, and wrong under exactly the conditions
  the rules exist for.
- *A serializable transaction* — correct, and buys nothing a single statement does not already
  give, at the cost of retry handling on a path that must not fail noisily.

---

## D3 — Duration is enforced twice and stored once

**Decision**: the recorder stops at 60 s, the server re-checks the submitted duration, and the
value is stored on the answer.

**Rationale**: FR-013 says the server MUST reject an answer exceeding sixty seconds, and the
spec's own assumption says the client value alone is not trusted. The recorder's ceiling is a
product behaviour — it makes the minute feel intentional (US2) — not a security boundary. A
crafted request skips the recorder entirely.

Server-side there are **two independent bounds, not a correlation**. The declared duration must
be an integer in 1–60, checked in the route before review and again by the column's CHECK. The
audio has its own size bounds — a 1 KB floor and a 5 MB ceiling, both 002's. Nothing compares
one to the other.

An earlier draft of this decision described a cross-check that refused a submission "where they
disagree by more than a wide margin". No such check was ever built, and the sentence was
unimplementable as written — no number, no unit, no per-container bytes-per-second figure to
compare against. Two honest bounds beat one imaginary correlation.

⚠️ **Not yet measured**: the byte-per-second range for a 60 s recording in each target browser.
The 5 MB ceiling 002 already enforces is ~10x the worst measured case, which bounds abuse but
is far too loose to infer a duration from. Until that is measured, the byte check is a bound,
not a verification, and the plan says so rather than implying a precision it does not have.

**Alternatives considered**:

- *Trust the recorder* — what the built code does today, and D-3 in the plan.
- *Decode the audio server-side to measure it* — exact, and puts a media decoder on the request
  path for a rule a bound already enforces.

---

## D4 — Idempotency needs a submission id, not just the unique constraint

**Decision**: the client generates a submission id per recording and sends it with the audio.
The answer row carries it, uniquely.

**Rationale**: SC-007 asks that duplicate *or retried* submissions produce exactly one answer
and one ask. The `(participant_id, question_id)` unique constraint satisfies the first half —
a double-tap cannot publish twice — and quietly fails the second.

The case it misses: the request succeeds, the response is lost, the client retries. Without a
submission id the retry is refused as *already answered*, and the participant is told they
already answered a question whose outcome they never saw. With one, the retry recognises its own
prior submission and returns the original outcome.

That is the difference between an idempotent endpoint and one that merely cannot corrupt data.

**Alternatives considered**:

- *The unique constraint alone* — what is built. Handles the visible case, fails the one that
  loses an answer.
- *A dedicated idempotency-key table with TTL* — the general solution, and a table plus a sweep
  for a property one column on an existing row provides.

---

## D5 — Microphone denial is not a processing failure

**Decision**: permission denial, an unsupported browser, and a review failure get three
different messages.

**Rationale**: they have three different causes and three different next actions. The built
code reuses the processing-failure helper for denial, which tells someone *something on our
side didn't finish* when in fact their browser refused — wrong fault, and an instruction they
cannot act on.

FR-028 requires explaining how to grant permission. FR-029 requires saying plainly that the
browser cannot record, rather than rendering a control that does nothing.

**Detection**: `getUserMedia` rejects with a `NotAllowedError` for denial and a `NotFoundError`
where there is no device; the absence of `navigator.mediaDevices` or `MediaRecorder` is the
unsupported case and is checked before the control renders, not after it is pressed.

**Alternatives considered**:

- *One "recording didn't work" state* — fewer strings, and it is the state that makes someone
  reload the page instead of opening their browser's site settings.

---

## D6 — Format is chosen with `isTypeSupported`, never assumed

**Decision**: the recorder picks from an ordered list of codec-qualified types, taking the
first the browser reports as supported, and falls back to the browser's own default.

**Rationale**: mobile Safari has never supported WebM recording and Chrome does not produce
MP4. A hard-coded type constructs a `MediaRecorder` that yields an empty blob on one of the two
target platforms — and that reaches the participant as *We couldn't hear anything*, blaming
them for a format bug.

The types are codec-qualified (`audio/webm;codecs=opus`) because that is the string
`MediaRecorder` reports back and therefore what the request carries. 002's allowlist matches on
the base type specifically so these are accepted; an exact-match allowlist would have rejected
every Chrome recording before any provider call.

**Alternatives considered**:

- *Convert to a single format client-side* — a codec in the bundle for a problem the server
  already accepts both sides of.
- *Send whatever, let the server sort it out* — the server would then need to identify the
  container, which is the same work in a worse place.
