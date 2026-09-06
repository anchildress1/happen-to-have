import { z } from 'zod';

/**
 * Row parsers for every table this feature reads or writes.
 *
 * Generated SQL Connect types describe the shape the schema promised, not the shape
 * that arrived. Every row crossing into application code is parsed here first
 * (data-model.md "Validation") so a driver returning an unexpected shape fails loudly
 * instead of rendering an empty card.
 */

export const participantRowSchema = z.object({
  id: z.uuid(),
  can_ask: z.boolean(),
  created_at: z.coerce.date(),
});

export type ParticipantRow = z.infer<typeof participantRowSchema>;

export const questionStatusSchema = z.enum(['open', 'closed']);

export const questionRowSchema = z.object({
  id: z.uuid(),
  participant_id: z.uuid().nullable(),
  display_text: z.string().min(1).max(2000),
  source_language: z.string().min(1),
  status: questionStatusSchema,
  created_at: z.coerce.date(),
});

export type QuestionRow = z.infer<typeof questionRowSchema>;

export const answerRowSchema = z.object({
  id: z.uuid(),
  question_id: z.uuid(),
  participant_id: z.uuid(),
  created_at: z.coerce.date(),
});

export type AnswerRow = z.infer<typeof answerRowSchema>;

/**
 * The one row 002 writes (data-model.md). Parsed at the boundary like every other, so a
 * driver returning an unexpected shape fails loudly instead of silently disabling the limit.
 *
 * There is deliberately no contribution, outcome or audio column: the row records THAT
 * something was submitted, never WHAT. Adding one would make it attempt history, which
 * FR-023 forbids.
 */
export const rateLimitRowSchema = z.object({
  participant_id: z.uuid(),
  window_started_at: z.coerce.date(),
  submission_count: z.number().int().nonnegative(),
});

export type RateLimitRow = z.infer<typeof rateLimitRowSchema>;
