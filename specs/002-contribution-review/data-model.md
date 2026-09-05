# Data Model: Contribution Review

**Feature**: 002-contribution-review · **Date**: 2026-09-05

Most of this document describes shapes that are deliberately **not** tables. 002's defining
property is that almost nothing it computes survives the request.

One table is added. Its justification is in [plan.md](plan.md) Complexity Tracking.

---

## What is not persisted, and which requirement forbids it

| Shape | Lives | Forbidden by |
| - | - | - |
| Original recording | request memory, released on exit | FR-043, FR-044, FR-045, Principle IV |
| Transcript / display text of a *withheld* contribution | request memory | FR-023 — only published contributions become rows |
| Per-check results | request memory | FR-023, Principle V |
| Retry counts, timeouts, provider errors | request memory | FR-023, FR-041 |
| Withheld reason | returned to the caller, rendered, discarded | FR-023 |
| Any attempt, draft, or recovery entry | nowhere | FR-023, US4 scenario 5 |

There is no `submissions` table, no `attempts` table, and no status column anywhere. **Existence
of an `answers` or `questions` row is publication** — the rule 001's migration already encodes.

---

## In-request shapes

TypeScript shapes in `src/review/`, never serialized to storage. Full schemas in
[contracts/review.md](contracts/review.md).

### `ActiveSubmission`

The spec's Key Entity, realised as a request-scoped object.

| Field | Type | Notes |
| - | - | - |
| `kind` | `'answer' \| 'question'` | the fan-out is two calls either way; this decides only whether `relevanceCanPublish` is evaluated or null |
| `audio` | `Uint8Array` | the original recording; never copied outside the request |
| `mimeType` | `string` | as recorded by the browser |
| `questionText` | `string \| null` | required for `answer`, `null` for `question` (FR-006) |
| `participantId` | `string` | for rate limiting only |
| `deadline` | `number` | epoch ms, receipt + 90 s (FR-039) |
| `signal` | `AbortSignal` | chained from `request.signal`; fires on rejection or disconnect |

### `CheckResult`

Every check returns the same envelope, so the gate treats them uniformly (Principle III).

| Field | Type | Notes |
| - | - | - |
| `call` | `'content' \| 'judgment'` | which of the two parallel calls produced it |
| `outcome` | `'permit' \| 'refuse' \| 'fault'` | `refuse` is a validated `canPublish: false`; `fault` is a timeout, empty candidate, or parse failure |
| `payload` | `ContentPayload \| JudgmentPayload \| null` | shaped by which call returned it |
| `attempts` | `number` | 1–3 (FR-039) |

**`fault` and `refuse` are different states and must not collapse.** A `fault` retries; a `refuse`
ends the submission. Conflating them turns a provider outage into a participant rejection, which
FR-038 forbids in exactly those words. The empty-candidate case from
[research D3](research.md) is a `fault`.

### `ContentPayload`

Produced only by the content-processing call.

| Field | Type | Notes |
| - | - | - |
| `canPublish` | `boolean` | intelligibility and privacy-safety, not relevance or legality |
| `displayText` | `string` | translated, redacted, 1–2000 chars — matches the `questions.display_text` bound 001 set |
| `sourceLanguage` | `string` | BCP-47-ish, as detected (FR-010) |
| `emotion` | `string \| null` | broad direction, `null` when not reliably detectable (FR-017, edge case *No reliable emotion*) |
| `contentReason` | `'silence' \| 'unintelligible' \| 'unpublishable' \| null` | why `canPublish` is false; `null` when it is true |

`emotion` is nullable on purpose. The edge case requires recording *no* direction rather than a
default, so an empty string would be wrong.

`contentReason` exists because [contracts/copy.md](contracts/copy.md) requires **three distinct
headings** for content rejections — silence, unintelligible, and everything else — and a single
`reason: 'content'` cannot select among them. The content check is the only call that knows which
applies, so it returns it. Without this field the three headings are unreachable and
`WithheldPage` has nothing to branch on.

### `JudgmentPayload`

Produced by the judgment call. Three verdicts, plus the two fields that exist because a
reconstruction is not the same as a statement.

| Field | Type | Notes |
| - | - | - |
| `crisisCanPublish` | `boolean` | `false` means crisis detected (FR-008d); crisis publishes nowhere and appears in no other participant's view (FR-031) |
| `illegalCanPublish` | `boolean` | `false` means unsafe or unlawful to publish (FR-008c) |
| `relevanceCanPublish` | `boolean \| null` | `null` for a question; relevance does not apply (FR-003) |
| `primaryReason` | `'none' \| 'crisis' \| 'illegal' \| 'relevance'` | the failing signal, named by the judge (FR-008e) |
| `reasonDetail` | `string` | one clause, for operators only — **never rendered** |
| `audioQuality` | `'clear' \| 'unintelligible' \| 'silent'` | selects content copy when the transcript is lost (FR-008h) |

`primaryReason` exists because inferring the reason from which boolean flipped is a
reconstruction of the judge's reasoning. Measured 16/16 correct across the fixture set, so the
reconstruction is unnecessary.

`reasonDetail` MUST NOT reach the interface. FR-027 fixes every participant-facing string, and
model-generated text on the Withheld page would break both that and Principle VII. It exists for
logs.

`audioQuality` is the fallback for a lost transcript. Content processing is the call the provider
blocks; when it does, this is the only remaining signal that can choose between *We couldn't hear
anything* and *We couldn't make out the recording*. It never authorises publication.

### `ReviewOutcome`

What `reviewContribution()` returns — a discriminated union, so a caller cannot read
`displayText` off a rejection. The three terminal states are exactly FR-020's: publishable,
Withheld carrying a reason, or processing failure. Abandonment publishes nothing and returns
nothing, because the request is gone.

| Variant | Fields | Consumed by |
| - | - | - |
| `{ status: 'publish' }` | `displayText`, `sourceLanguage`, `emotion` | 003 publishes an answer, 004 a question |
| `{ status: 'withheld' }` | `reason: 'crisis' \| 'illegal' \| 'relevance' \| 'content'`, plus `contentReason` when `reason` is `'content'` | renders `WithheldPage` |
| `{ status: 'failed' }` | `cause: 'exhausted' \| 'deadline'` | renders `ProcessingFailed` |
| `{ status: 'rate_limited' }` | `retryAt: Date` | renders `RateLimited`; FR-049 needs the time |

The four `reason` values are FR-021's required distinctions: crisis, illegal/dangerous,
relevance, and content (silence, unintelligible, spam, harassment, privacy).

`withheld.reason` exists solely to select copy (FR-008e). The transcript of a withheld
contribution is never published, so the reason is the only thing left worth carrying.

---

## The one table

### `submission_rate_limits`

Bounds submissions per participant. Justified in [plan.md](plan.md) Complexity Tracking against
Principle V.

| Column | Type | Notes |
| - | - | - |
| `participant_id` | `uuid PRIMARY KEY REFERENCES participants (id)` | one row per participant, upserted |
| `window_started_at` | `timestamptz NOT NULL` | start of the current fixed window |
| `submission_count` | `integer NOT NULL` | submissions inside that window |

**Columns that deliberately do not exist**: no `contribution_id`, no `outcome`, no `reason`, no
`audio_ref`, no `transcript`. The row must not become a record of what was submitted — only that
something was. Adding any of them would make it attempt history and break FR-023.

The primary key is the participant id rather than a synthetic one: there is exactly one live
window per participant, so an upsert on conflict is the whole write path and no second row can
race into existence.

**Limits are environment-configured** (FR-048): `HTH_RATE_LIMIT_MAX` and
`HTH_RATE_LIMIT_WINDOW_SECONDS`, with defaults in code. FR-051 requires the values be validated
against a complete answer-then-ask cycle before launch — tracked in
[quickstart.md](quickstart.md), not settled here.

**Cleanup** joins the existing `db-sweep` job rather than adding a second scheduled task: rows
whose window closed long ago carry no meaning.

### Row parser

`src/schema/rows.ts` gains `rateLimitRowSchema`, matching the boundary rule 001 set — every row
crossing into application code is Zod-parsed first, so a driver returning an unexpected shape
fails loudly.

---

## Relationship to 001's schema

Unchanged. 002 adds one table and touches no existing column.

```text
participants ──< submission_rate_limits     (new, 002)
participants ──< questions                  (001)
participants ──< answers                    (001)
questions    ──< answers                    (001)
```

`answers` still has no text column, and `questions.display_text` is still written only by the
seed script. 002 produces the text; 003 and 004 add the columns that store it, in their own
migrations. Creating them now would be speculative work under Principle VI — the same reasoning
001 used when it declined to build the handoff's full schema up front.
