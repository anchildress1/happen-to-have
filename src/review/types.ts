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
 * The fan-out is split here and nowhere else: content processing reproduces the recording as
 * text and is the call the provider's core-harm protections trip, while the judgment call
 * emits booleans and has not been observed blocking (FR-008a).
 */
export type ReviewCall = 'content' | 'judgment';

/**
 * Why a contribution was withheld. Exists only to select copy: the transcript of a withheld
 * contribution is never published, so the reason is the sole thing left worth carrying
 * (FR-008e, FR-021).
 */
export type WithheldReason = 'crisis' | 'illegal' | 'relevance' | 'content';

/**
 * Which of the three content headings to render (contracts/copy.md).
 *
 * Returned by the content call when it refuses. When it refuses WITHOUT one — or never
 * returns at all — the gate falls back to the judgment call's `audioQuality`, which is what
 * FR-008h exists for.
 */
export type ContentReason = 'silence' | 'unintelligible' | 'unpublishable';

/** The judgment call's read on the recording itself, not on what was said. */
export type AudioQuality = 'clear' | 'unintelligible' | 'silent';

/** Produced by content processing (FR-009 – FR-013, FR-017). */
export interface ContentPayload {
  /** Intelligibility and privacy-safety only — never relevance or legality. */
  canPublish: boolean;
  displayText: string;
  sourceLanguage: string | null;
  /**
   * Broad direction, `null` when none is reliably detectable. Null rather than an empty
   * string on purpose: the spec requires recording *no* direction, and `''` is a value.
   */
  emotion: string | null;
  /** Populated when `canPublish` is false; `null` otherwise. */
  contentReason: ContentReason | null;
}

/**
 * Produced by the judgment call (FR-008a1). Three verdicts plus the two fields that exist
 * because a reconstruction is not the same as a statement.
 */
export interface JudgmentPayload {
  /** `false` means crisis detected (FR-008d). */
  crisisCanPublish: boolean;
  /** `false` means unsafe or unlawful to publish (FR-008c). */
  illegalCanPublish: boolean;
  /** `null` for a question — relevance does not apply (FR-003). */
  relevanceCanPublish: boolean | null;
  audioQuality: AudioQuality;
  /**
   * The failing signal, named by the judge rather than inferred from a boolean (FR-008e).
   *
   * `content` is excluded: this call never judges content, and a withheld reason of
   * `content` without a `contentReason` gives WithheldPage nothing to render.
   */
  primaryReason: 'none' | Exclude<WithheldReason, 'content'>;
  /** One clause, for operators. MUST NOT be rendered — FR-027 fixes every visible string. */
  reasonDetail: string;
}

/**
 * `fault` and `refuse` are different states and MUST NOT collapse into one. A `fault`
 * retries; a `refuse` ends the submission. Conflating them turns a provider outage into a
 * participant rejection, which FR-038 forbids in those words.
 */
type Settled<C extends ReviewCall, P> =
  | {
      call: C;
      /** A validated result. `refuse` keeps its payload: rule 2a reads the reason off it. */
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
export type CheckResult = Settled<'content', ContentPayload> | Settled<'judgment', JudgmentPayload>;

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
  // keyed by exactly the three ContentReason values, so a null there indexes nothing — and
  // the gate's rule 2c already resolves it from audioQuality BEFORE returning. By the time a
  // ReviewOutcome exists the null is always illegal, so the type says so.
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
