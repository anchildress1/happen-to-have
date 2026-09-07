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
 * **No audio field of any kind, not even a boolean.** An earlier revision selected
 * `generated_audio IS NOT NULL AS has_playback`, and nothing ever read it: `Listen` is offered on
 * every published response regardless (FR-014, FR-031), and whether audio already exists is the
 * route's business, answered on the request. A field carried through a query, a schema and a prop
 * to be read by nobody is what Principle VI means by "it might be useful later".
 *
 * The audio bytes themselves are emphatically not here either. Selecting 3-4 MB per response into
 * a server render would put the whole cache on the critical path SC-001 budgets at two seconds.
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
});

export type ResponseRow = z.infer<typeof responseRowSchema>;

/**
 * What `authorizePlayback` reads: the text about to be voiced, and whether audio already exists.
 *
 * Validated rather than type-asserted like every other row, and this one earns it twice over —
 * `display_text` is sent to a paid provider and the result is cached permanently, so a wrong
 * shape here is billed and then stored.
 */
export const playbackTargetRowSchema = z.object({
  display_text: z.string().min(1).max(2000),
  cached: z.boolean(),
});

export type PlaybackTargetRow = z.infer<typeof playbackTargetRowSchema>;

/**
 * The cached playback bytes, or NULL when none has been produced.
 *
 * `Uint8Array`, not `Buffer`: the Neon driver returns `bytea` as a `Buffer` and PGlite returns a
 * plain `Uint8Array`, and `Buffer` is a subclass — so the wider type accepts both, where the
 * narrower would type-check against production and be a lie under test.
 *
 * The instance check is the point of the schema. A driver returning `bytea` in its hex *text*
 * form (`\x52494646…`) yields a truthy string, and `new Uint8Array(<string>)` coerces to a
 * zero-length array rather than throwing — so the route would answer `200 audio/wav` with
 * `content-length: 0`, the client's `play()` would reject, and FR-033's retry would re-read the
 * same row forever. Neither driver does that today; that is exactly the class of silent failure
 * the constitution's validate-every-row rule exists to make loud.
 */
export const playbackAudioRowSchema = z.object({
  generated_audio: z.instanceof(Uint8Array).nullable(),
});

export type PlaybackAudioRow = z.infer<typeof playbackAudioRowSchema>;

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
