# Contract: Session and Identity

**Feature**: 001-participant-and-pool | **Date**: 2026-09-04

---

## The authority boundary

**The cookie authenticates identity; ask eligibility is read from the database.**

The authenticated cookie binds the requester to a participant. A tampered cookie is rejected,
not used to impersonate another participant. Every eligibility decision reads current Postgres state.

| Belongs in the cookie | Never in the cookie |
| - | - |
| `participantId` | `canAsk` or any ask eligibility |
| — | Traversal list/pointer, answer counts, contribution history |
| — | Any flag a route handler would trust without a database read |

A reviewer checking this feature should grep for `canAsk` in `src/session/` and find nothing.

---

## Cookie

| Property | Value |
| - | - |
| Name | `hth_session` |
| Library | `iron-session` 9.0.1 |
| Encryption | AEAD via iron-session defaults; secret from Secret Manager |
| `httpOnly` | `true` |
| `secure` | `true` in production, `false` on `localhost` |
| `sameSite` | `Lax` |
| `path` | `/` |
| `maxAge` | 30 days |

Secret comes from `SESSION_SECRET`, minimum 32 characters. Absent or short → the application
fails to boot. It must never fall back to a default; a default secret is a forgeable session for
every deployment that forgot to set one.

---

## Payload

```ts
type SessionData = {
  participantId: string   // authenticated participant uuid
}
```

Question traversal is tab-local: keep the ordered ids and a pointer in page memory. Skipping
advances that pointer, never mutates the cookie, and never stores an exclusion history.

---

## Get-or-create

Only a Route Handler or a client-invoked Server Action may call the mutating get-or-create helper.
`GET /answer` renders a selection shell; its client starts `POST /api/question`, which
creates the participant and returns `Set-Cookie` before any contribution action is enabled.
Server Components may read an existing session but MUST NOT create or save one during rendering.

```
getOrCreateParticipant(request) -> { participantId, isNew }
```

1. Read and decrypt the session cookie.
2. **No cookie, or decryption fails** → insert a new `participants` row, write a fresh session,
   return `isNew: true`.
3. **Cookie holds a `participantId`** → `SELECT id FROM participants WHERE id = $1`.
   - Row found → return it (FR-004: same session, same participant, history intact).
   - **Row missing** → treat as new. A cookie referencing a deleted or foreign participant must
     not produce a 500 and must not be trusted. Insert a new participant, overwrite the session.

Step 3's missing-row branch is a required behavior, not an edge case: it is what stops a
cookie left over from a database reset producing a 500 on the next write.

**Read paths do not call this.** `POST /api/question` uses `readParticipantId`, which
decrypts the cookie and touches no database, then runs selection against whatever id it
finds. Selection filters on `participant_id IS DISTINCT FROM $1` and `NOT EXISTS (their
answers)`, so an id with no row returns exactly what a brand-new participant would — proven
in `tests/integration/exclusions.test.ts`. Verifying the row there could only confirm what
the result already implied, and cost a second round-trip on every question load.

A missing row is a **write** concern, enforced by the foreign key on `answers`. 003 submits
against this id and must call `getOrCreateParticipant` before it does.

**Failure to reach the database** is a 500 rendered as the FR-031 failure state with a retry
action. It is never silently treated as "new participant" — that would hand someone a fresh
identity and quietly discard their history.

---

## Concurrency

Two tabs (spec Edge Cases) share one cookie and therefore one participant. Each tab may hold a
different presented question; neither affects the other's eligibility, because eligibility lives
in Postgres and nothing in this feature writes to it.

A race between two simultaneous first requests can insert two participant rows, of which the
cookie keeps one. The orphan is harmless — no contributions, no eligibility, three columns. Not
worth a lock in this feature.

---

## Session reset is a documented limitation

Clearing cookies or opening a private window produces a new participant with no history and no
earned ask. This is accepted by the constitution and explicitly not solved in this build window.
It must be stated in the README, not hidden.

---

## Test obligations

| Behavior | Level |
| - | - |
| No cookie → participant created, cookie written | Integration |
| Valid cookie → same `participantId` returned, no new row | Integration |
| Cookie referencing a missing row → new participant, no 500 | Integration |
| Missing row yields the same eligible list as a real participant | Integration |
| Tampered or undecryptable cookie → new participant, no 500 | Integration |
| Database unreachable → 500 and failure state, never a silent new identity | Integration |
| First visit to `/answer` creates identity through POST, not Server Component rendering | E2E |
| Skip advances tab-local pointer and does not write a session cookie | Integration |
| No authority field is ever written to the session | Unit — assert the serialized keys |
