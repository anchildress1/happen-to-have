import { z } from 'zod';
import type { ContentPayload, JudgmentPayload } from './types';

/**
 * Parsers for every provider response before it is used (FR-036, FR-037, Principle V).
 *
 * `responseSchema` constrains generation; it does not make the parsed object trustworthy.
 * The SDK types `responseSchema` as `unknown`, so TypeScript catches nothing there, and the
 * spike saw two responses whose `.text` was `undefined` outright. A model response is
 * untrusted input and crosses into application code here or not at all — the same boundary
 * `src/schema/rows.ts` draws for database rows.
 *
 * A parse failure is a **fault**, not a rejection. It retries independently (FR-038) and
 * must never be relabelled as a participant rejection.
 */

/** FR-008h. Only the judgment call can distinguish these. */
export const audioQualitySchema = z.enum(['clear', 'unintelligible', 'silent']);

/** contracts/copy.md maps these one-to-one onto the three content headings. */
export const contentReasonSchema = z.enum(['silence', 'unintelligible', 'unpublishable']);

/**
 * Content processing (FR-009 – FR-013, FR-017).
 *
 * `displayText` is capped at 2000 to match the upper half of the `questions.display_text`
 * CHECK constraint 001's migration enforces, so an over-long transcript fails here as a
 * retryable fault rather than reaching 003 and dying on a database constraint after the ask
 * has been granted. The constraint's LOWER bound is deliberately not mirrored — see the
 * field comment.
 */
export const contentResultSchema = z
  .object({
    canPublish: z.boolean(),
    // Capped, never floored. A silent or unintelligible recording has nothing to transcribe,
    // so `displayText: ''` is its natural and CORRECT output — rejecting it would turn the
    // exact case FR-021 wants withheld into three faults and a processing failure, and the
    // participant would read "we couldn't check that" instead of "we couldn't hear anything".
    displayText: z.string().max(2000),
    // Nullable so a recording with no discernible speech can say so — it has no source
    // language for the same reason it has no transcript. `null` is the way to express that;
    // a blank string is not, because whitespace reaching questions.source_language is a
    // silent data defect rather than an honest absence.
    sourceLanguage: z.string().trim().min(1).nullable(),
    // Nullable, never optional: the model must state that it found no reliable direction
    // rather than omitting the field, so a missing key stays a schema failure.
    //
    // Capped because this is the ONLY model-generated string that leaves the module — it
    // rides ReviewOutcome into 003 and 004. displayText and reasonDetail are both bounded
    // for the same reason reasonDetail gives: an unbounded field is somewhere a model can
    // put the transcript it was told not to repeat. This one would carry it downstream.
    emotion: z.string().max(40).nullable(),
    contentReason: contentReasonSchema.nullable(),
  })
  // The 1-character floor belongs only to text that will actually be published. That is the
  // bound `questions.display_text` enforces, and it only ever sees permitted transcripts.
  .refine((result) => !result.canPublish || result.displayText.length >= 1, {
    message: 'a publishable result must carry non-empty displayText',
    path: ['displayText'],
  })
  // A contentReason on a PUBLISHABLE result is incoherent: the field names why something was
  // refused, so its presence beside a permit means the two disagree. Refusals may still omit
  // it — the gate's rule 2c falls back to audioQuality — which is why this is one-directional
  // rather than the biconditional the judgment call uses.
  .refine((result) => !result.canPublish || result.contentReason === null, {
    message: 'a publishable result must not carry a refusal reason',
    path: ['contentReason'],
  })
  .refine((result) => !result.canPublish || result.sourceLanguage !== null, {
    message: 'a publishable result must name the language it was translated from',
    path: ['sourceLanguage'],
  });

/**
 * The judgment call (FR-008a1, FR-008e, FR-008h).
 *
 * `reasonDetail` is capped because it is an operator log line, not prose. An unbounded
 * string here is somewhere a model can put the transcript it was told not to repeat.
 */
const judgmentShape = {
  crisisCanPublish: z.boolean(),
  illegalCanPublish: z.boolean(),
  // Defaulted rather than required. It selects a heading and gates nothing, so an omitted or
  // unrecognised value must not discard the verdict alongside it — `clear` routes to the
  // general content heading, which is true of every case. Its two other values have never
  // been observed, so the unexpected-value path is the likely one, not the exotic one.
  audioQuality: audioQualitySchema.catch('clear').default('clear'),
  // Exactly the four values contracts/review.md defines and the judgment prompt is told it
  // may return. `content` is deliberately absent: this call never judges content, and
  // accepting it would hand the gate a withheld reason with no contentReason to render.
  primaryReason: z.enum(['none', 'crisis', 'illegal', 'relevance']),
  // Truncated, never rejected. It is an operator log line that renders nowhere and decides
  // nothing (FR-027), so failing the parse over its length would discard a real refusal —
  // a crisis verdict would arrive as a processing failure. Clipping still denies a model
  // somewhere to hide the transcript it was told not to repeat.
  reasonDetail: z
    .string()
    .optional()
    .default('')
    .transform((detail) => detail.slice(0, 500)),
};

/**
 * Built per contribution kind so `null` cannot mean two things.
 *
 * For a question, `relevanceCanPublish: null` is correct — relevance does not apply
 * (FR-003). For an answer the same null is an ABSENT verdict, and absence is not permission
 * (FR-019). One schema accepting both would let an omitted relevance verdict publish an
 * off-topic answer at the only layer positioned to catch it.
 */
export function judgmentResultSchemaFor(kind: 'answer' | 'question') {
  return z
    .object({
      ...judgmentShape,
      // Strict for an answer, forgiving for a question. On an answer a missing verdict is
      // absence, and absence is not permission (FR-019) — that rejection is load-bearing.
      // On a question the field is unused, so refusing an over-eager judge that scored it
      // anyway would discard a crisis verdict to protect nothing.
      relevanceCanPublish:
        kind === 'answer'
          ? z.boolean()
          : z
              .union([z.boolean(), z.null()])
              .optional()
              .transform(() => null),
    })
    .refine(
      (result) => {
        const verdicts = [
          result.crisisCanPublish,
          result.illegalCanPublish,
          result.relevanceCanPublish,
        ].filter((verdict): verdict is boolean => verdict !== null);
        const allPermit = verdicts.every(Boolean);
        return allPermit === (result.primaryReason === 'none');
      },
      {
        // `{ crisisCanPublish: false, primaryReason: 'none' }` parses cleanly without this,
        // and the gate takes withheld.reason straight from primaryReason — leaving it
        // nowhere to go. An incoherent verdict is a fault to retry, not a coin flip.
        message: 'primaryReason must be none exactly when every applicable verdict permits',
        path: ['primaryReason'],
      },
    )
    .refine(
      (result) => {
        // Precedence, not merely membership. When two signals refuse — a recording that is
        // both a crisis and unlawful is not hypothetical — accepting either name would let
        // the gate render the illegal variant and omit the crisis resources entirely, since
        // it takes withheld.reason straight from this field. FR-022 fixes the order.
        const refusedInPrecedenceOrder = (
          [
            ['crisis', !result.crisisCanPublish],
            ['illegal', !result.illegalCanPublish],
            ['relevance', result.relevanceCanPublish === false],
          ] as const
        ).find(([, refused]) => refused);

        return result.primaryReason === (refusedInPrecedenceOrder?.[0] ?? 'none');
      },
      {
        message:
          'primaryReason must name the highest-precedence refusing signal (crisis, illegal, relevance)',
        path: ['primaryReason'],
      },
    );
}

export type ContentResult = z.infer<typeof contentResultSchema>;
export type JudgmentResult = z.infer<ReturnType<typeof judgmentResultSchemaFor>>;

/**
 * Parses a provider response body that has already been read as text.
 *
 * Returns `null` on any failure — malformed JSON and schema-invalid output are the same
 * thing to the caller: a fault to retry. Distinguishing them would invite treating one of
 * them as a verdict, which is what FR-008b1 forbids.
 */
export function parseResult<T>(schema: z.ZodType<T>, raw: string | undefined): T | null {
  if (!raw) {
    return null;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }

  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/**
 * Compile-time gate keeping the hand-written interfaces in `types.ts` exactly in step with
 * what these schemas actually infer.
 *
 * Without it, adding a field here leaves `types.ts` silently stale — and because nothing
 * imports `types.ts` yet, no build would break. The gate is what makes the duplication safe
 * rather than merely tidy.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

export const _contentPayloadMatchesSchema: Exact<ContentPayload, ContentResult> = true;
export const _judgmentPayloadMatchesSchema: Exact<JudgmentPayload, JudgmentResult> = true;
