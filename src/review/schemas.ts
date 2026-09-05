import { z } from 'zod';

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
 * `displayText` is bounded 1–2000 to match the `questions.display_text` CHECK constraint
 * 001's migration already enforces. Parsing it here means an over-long transcript fails as
 * a fault and retries, rather than reaching 003 and dying on a database constraint after
 * the ask has already been granted.
 */
export const contentResultSchema = z.object({
  canPublish: z.boolean(),
  displayText: z.string().min(1).max(2000),
  sourceLanguage: z.string().min(1),
  // Nullable, never optional: the model must state that it found no reliable direction
  // rather than omitting the field, so a missing key stays a schema failure.
  emotion: z.string().nullable(),
  contentReason: contentReasonSchema.nullable(),
});

/**
 * The judgment call (FR-008a1, FR-008e, FR-008h).
 *
 * `reasonDetail` is capped because it is an operator log line, not prose. An unbounded
 * string here is somewhere a model can put the transcript it was told not to repeat.
 */
export const judgmentResultSchema = z.object({
  crisisCanPublish: z.boolean(),
  illegalCanPublish: z.boolean(),
  // Null for a question: relevance does not apply, and the judgment call returns null
  // rather than the system making a third call (FR-003).
  relevanceCanPublish: z.boolean().nullable(),
  audioQuality: audioQualitySchema,
  primaryReason: z.enum(['none', 'crisis', 'illegal', 'relevance', 'content']),
  reasonDetail: z.string().max(500),
});

export type ContentResult = z.infer<typeof contentResultSchema>;
export type JudgmentResult = z.infer<typeof judgmentResultSchema>;

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
