/**
 * Shapes the review passes around inside one request. None of them is ever serialized to
 * storage: check results, retry counts and the recording itself exist only for the life of
 * the active submission (FR-023, constitution Principle V). Only published questions and
 * answers become rows, and 003 and 004 own that.
 *
 * See specs/002-contribution-review/data-model.md, which is the authoritative field list.
 */

/** Which of the two parallel calls produced a result (FR-002, FR-003). */
export type ReviewCall = 'content' | 'judgment';

/**
 * Why a contribution was withheld. Exists only to select copy: the transcript of a withheld
 * contribution is never published, so the reason is the sole thing left worth carrying
 * (FR-008e, FR-021).
 */
export type WithheldReason = 'crisis' | 'illegal' | 'relevance' | 'content';

/**
 * Which of the three content headings to render (FR-008h, contracts/copy.md). Only the
 * content call can distinguish these, which is why it returns the value rather than the
 * renderer inferring it.
 */
export type ContentReason = 'silence' | 'unintelligible' | 'unpublishable';

/** The judgment call's read on the recording itself, not on what was said. */
export type AudioQuality = 'clear' | 'unintelligible' | 'silent';

/** Produced by content processing (FR-009 – FR-013, FR-017). */
export interface ContentPayload {
  /** Intelligibility and privacy-safety only — never relevance or legality. */
  canPublish: boolean;
  displayText: string;
  sourceLanguage: string;
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
 * A call's result, in the one envelope the gate treats uniformly (Principle III).
 *
 * `fault` and `refuse` are different states and MUST NOT collapse into one. A `fault`
 * retries; a `refuse` ends the submission. Conflating them turns a provider outage into a
 * participant rejection, which FR-038 forbids in those words.
 */
export interface CheckResult {
  call: ReviewCall;
  outcome: 'permit' | 'refuse' | 'fault';
  payload: ContentPayload | JudgmentPayload | null;
  /** 1–3 (FR-039). */
  attempts: number;
}

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
  | {
      status: 'withheld';
      reason: WithheldReason;
      /** Set when `reason` is `'content'`; selects among the three content headings. */
      contentReason: ContentReason | null;
    }
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
