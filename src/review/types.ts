/**
 * Shapes the review passes around inside one request. None of them is ever serialized to
 * storage: check results, retry counts and the recording itself exist only for the life of
 * the active submission (FR-023, constitution Principle V). Only published questions and
 * answers become rows, and 003 and 004 own that.
 *
 * specs/002-contribution-review/data-model.md describes the same shapes in prose. Where the
 * two differ, these types and the Zod schemas beside them are what actually runs — several
 * fields were deliberately loosened after measurement showed strictness discarding real
 * refusals, and the spec text trails those decisions.
 */

/**
 * One call per signal (FR-008a). Not a taxonomy — a measurement: the same crisis prompt on
 * the same audio caught 3 of 10 unseen recordings sharing a call with two other judgments
 * and 10 of 10 alone. A call holding several jobs stops doing the subtle one.
 *
 * `relevance` is dispatched for answers only. For a question it is absent from the fan-out
 * entirely rather than present with a null verdict (FR-003), so there is no absent-versus-
 * inapplicable ambiguity for the gate to resolve.
 */
export type ReviewCall = 'content' | 'crisis' | 'illegal' | 'relevance';

/**
 * Why a contribution was withheld. Exists only to select copy: the transcript of a withheld
 * contribution is never published, so the reason is the sole thing left worth carrying
 * (FR-008e, FR-021).
 */
export type WithheldReason = 'crisis' | 'illegal' | 'relevance' | 'content';

/**
 * Which of the three content headings to render (contracts/copy.md).
 *
 * Returned by the content call whenever it refuses, and only it can supply one. A refusal
 * arriving without it is a validation fault that retries (FR-008h) — no other call reports on
 * the audio, and guessing the heading tells a participant the wrong thing about their own
 * recording.
 */
export type ContentReason = 'silence' | 'unintelligible' | 'unpublishable';

/** Produced by content processing (FR-009 – FR-013, FR-017). */
export interface ContentPayload {
  /** Intelligibility and privacy-safety only — never relevance or legality. */
  canPublish: boolean;
  displayText: string;
  sourceLanguage: string | null;
  /**
   * Broad direction, `null` when none is reliably detectable. Null rather than an empty
   * string on purpose: the spec requires recording *no* direction, and `''` is a value. A
   * blank or whitespace-only response from the model normalizes to `null` here, so absence
   * cannot arrive looking like a detected direction.
   */
  emotion: string | null;
  /** Populated when `canPublish` is false; `null` otherwise. */
  contentReason: ContentReason | null;
}

/**
 * Produced by the crisis call (FR-008d), which does nothing else.
 *
 * Positive polarity, and only here. Every other call answers *may this be published*; this
 * one answers *is this person in trouble*, because that is the wording that was measured at
 * 10/10 — flipping it inside the prompt scored worse. The gate consumes
 * `crisisCanPublish = !inTrouble`, so the inversion is one line of code rather than an edit
 * to a prompt whose exact wording is the load-bearing part.
 */
export interface CrisisPayload {
  /** `true` means crisis detected. */
  inTrouble: boolean;
  /**
   * Which named signal category fired. `"none"` when the model says so, `""` when it omitted
   * or nulled the field — both mean the same thing to a reader and neither gates anything.
   * For operators only; MUST NOT be rendered.
   */
  signal: string;
}

/**
 * Produced by the illegal-or-dangerous call (FR-008c) and the relevance call (FR-008g).
 *
 * One shape, two calls, different questions. For illegal, `false` means unsafe or unlawful to
 * publish; for relevance, `false` means the answer is about something else. There is no field
 * naming the failing signal: the call that refused is the reason (FR-008e).
 */
export interface VerdictPayload {
  canPublish: boolean;
  /**
   * One clause, for operators, `""` when omitted or nulled. MUST NOT be rendered — FR-027
   * fixes every visible string.
   */
  detail: string;
}

/**
 * `fault` and `refuse` are different states and MUST NOT collapse into one. A `fault`
 * retries; a `refuse` ends the submission. Conflating them turns a provider outage into a
 * participant rejection, which FR-038 forbids in those words.
 */
type Settled<C extends ReviewCall, P> =
  | {
      call: C;
      /** A validated result. `refuse` keeps its payload for the log line it carries. */
      outcome: 'permit' | 'refuse';
      payload: P;
      attempts: number;
    }
  | { call: C; outcome: 'fault'; payload: null; attempts: number };

/**
 * A call's result, in the one envelope the gate treats uniformly (Principle III).
 *
 * Written as a union so the compiler refuses the two shapes that would be wrong rather than
 * leaving them to review: a payload belonging to the other call, and a `permit` carrying no
 * payload at all. The second is the dangerous one — rule 2 says a missing result is not a
 * permit, and a lost transcript can never publish.
 *
 * `attempts` is 0–3, not 1–3: a call aborted or past the deadline before its first
 * invocation returns zero (FR-039).
 */
export type CheckResult =
  | Settled<'content', ContentPayload>
  | Settled<'crisis', CrisisPayload>
  | Settled<'illegal', VerdictPayload>
  | Settled<'relevance', VerdictPayload>;

/** What `reviewContribution` was asked to judge. */
export interface ReviewInput {
  kind: 'answer' | 'question';
  audio: Uint8Array;
  mimeType: string;
  /** Required when `kind` is `'answer'`, `null` otherwise (FR-006). */
  questionText: string | null;
  participantId: string;
  /** Aborting this cancels every in-flight call and releases the audio (FR-045). */
  signal: AbortSignal;
}

/**
 * The request-scoped state the spec calls an Active Submission. Discarded at completion,
 * failure or abandonment — there is no table behind it and there must never be one.
 */
export interface ActiveSubmission extends ReviewInput {
  /** Epoch ms: receipt + 90s (FR-039). */
  deadline: number;
}

/**
 * What `reviewContribution` returns. A discriminated union so a caller cannot read
 * `displayText` off a rejection — the type makes the mistake unrepresentable rather than
 * leaving it to review.
 */
export type ReviewOutcome =
  | {
      status: 'publish';
      displayText: string;
      sourceLanguage: string;
      emotion: string | null;
    }
  // Split rather than one variant with a nullable field. `copy.review.withheld.content` is
  // keyed by exactly the three ContentReason values, so a null there indexes nothing — and a
  // content refusal that carried no reason never became an outcome at all, because validation
  // rejected it as a fault first. By the time a ReviewOutcome exists the null is
  // unrepresentable, so the type says so.
  | { status: 'withheld'; reason: Exclude<WithheldReason, 'content'> }
  | { status: 'withheld'; reason: 'content'; contentReason: ContentReason }
  | {
      /**
       * Retries exhausted or the 90s deadline expired. Never a participant rejection: the
       * copy for this state puts the fault on this system's side (FR-040).
       */
      status: 'failed';
      cause: 'exhausted' | 'deadline';
    }
  | {
      status: 'rate_limited';
      /** FR-049 requires telling the participant *when*, not merely that they cannot. */
      retryAt: Date;
    };
