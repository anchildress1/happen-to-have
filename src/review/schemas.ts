import { z } from 'zod';
import type { ContentPayload, CrisisPayload, VerdictPayload } from './types';

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
  // Biconditional, in both directions and deliberately. A reason beside a permit means the
  // two disagree. A refusal WITHOUT one is the case FR-008h now calls a fault: no other call
  // reports on the audio any more, so there is nothing to fall back to, and rendering the
  // general heading regardless would tell a participant their recording was unshareable when
  // it was merely silent. Retrying is cheap; telling someone the wrong thing is not.
  .refine((result) => result.canPublish === (result.contentReason === null), {
    message: 'contentReason must be present exactly when canPublish is false',
    path: ['contentReason'],
  })
  .refine((result) => !result.canPublish || result.sourceLanguage !== null, {
    message: 'a publishable result must name the language it was translated from',
    path: ['sourceLanguage'],
  });

/**
 * Crisis (FR-008d, FR-008a1). Its own call, on the content tier, and the only schema here
 * stated in POSITIVE polarity — `inTrouble`, not `canPublish`.
 *
 * That is not an inconsistency to tidy up. The wording that scores 10/10 asks the model
 * whether the person is in trouble; asking it whether the recording may be published scored
 * worse (research D4). The prompt's exact wording is the measured artefact, so the inversion
 * lives in the gate: `crisisCanPublish = !inTrouble`.
 */
export const crisisResultSchema = z.object({
  inTrouble: z.boolean(),
  // Which named category fired, or "none". Truncated rather than rejected, for the reason
  // every operator string here is: discarding a crisis verdict over a long log line would
  // turn the one refusal that must never be missed into a processing failure.
  signal: z
    .string()
    .optional()
    .default('')
    .transform((signal) => signal.slice(0, 200)),
});

/**
 * Illegal-or-dangerous (FR-008c) and relevance (FR-008g). Two calls asking different
 * questions in the same shape — a boolean and one operator clause.
 *
 * Shared because the shape is identical, not because the calls are. They carry different
 * prompts on different concerns, and merging them into one call is what FR-008a forbids.
 * There is no `primaryReason` here: with one signal per call, the call that refused IS the
 * reason (FR-008e), so there is nothing left to state or to cross-check.
 *
 * `detail` is capped because it is an operator log line, not prose. An unbounded string is
 * somewhere a model can put the transcript it was told not to repeat.
 */
export const verdictResultSchema = z.object({
  canPublish: z.boolean(),
  // Truncated, never rejected. It renders nowhere and decides nothing (FR-027), so failing
  // the parse over its length would discard a real refusal.
  detail: z
    .string()
    .optional()
    .default('')
    .transform((detail) => detail.slice(0, 500)),
});

export type ContentResult = z.infer<typeof contentResultSchema>;
export type CrisisResult = z.infer<typeof crisisResultSchema>;
export type VerdictResult = z.infer<typeof verdictResultSchema>;

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
export const _crisisPayloadMatchesSchema: Exact<CrisisPayload, CrisisResult> = true;
export const _verdictPayloadMatchesSchema: Exact<VerdictPayload, VerdictResult> = true;
