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

export const questionRowSchema = z.object({
  id: z.uuid(),
  participant_id: z.uuid().nullable(),
  display_text: z.string().min(1).max(2000),
  source_language: z.string().min(1),
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
 * One entry in `Your Answers` (005 FR-004 – FR-007).
 *
 * Flat, not nested, because the query joins rather than aggregates: `json_agg` would mean
 * validating a shape the database invented, while a flat row validates against a schema written
 * here (research D7).
 *
 * There is no status field and no way to add one — only published answers are rows at all, so
 * the row's existence IS publication. That is 001's guarantee, and FR-008 depends on it.
 */
export const answerHistoryRowSchema = z.object({
  id: z.uuid(),
  display_text: z.string().min(1).max(2000),
  created_at: z.coerce.date(),
  /** The question this answer addressed (FR-005). */
  question_text: z.string().min(1).max(2000),
});

export type AnswerHistoryRow = z.infer<typeof answerHistoryRowSchema>;

/** One entry in `Your Questions` (005 FR-010, FR-011). Responses arrive separately. */
export const questionHistoryRowSchema = z.object({
  id: z.uuid(),
  display_text: z.string().min(1).max(2000),
  created_at: z.coerce.date(),
});

export type QuestionHistoryRow = z.infer<typeof questionHistoryRowSchema>;

/**
 * One response to one of the participant's questions (005 FR-013, FR-014).
 *
 * `has_playback` is a boolean and never the audio. The screen has no use for the bytes until
 * somebody presses Listen, and selecting 3-4 MB per response into a server render to answer a
 * yes/no question would put the entire cache on the critical path SC-001 budgets at two seconds.
 *
 * There is deliberately no score, rank, vote or rating field. FR-018 forbids ordering by any
 * quality signal and FR-019/FR-020 forbid every control that would imply one — so the schema
 * offers nothing to sort by but `created_at`, which is chronology (research D8).
 */
export const responseRowSchema = z.object({
  id: z.uuid(),
  question_id: z.uuid(),
  display_text: z.string().min(1).max(2000),
  created_at: z.coerce.date(),
  has_playback: z.boolean(),
});

export type ResponseRow = z.infer<typeof responseRowSchema>;

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
