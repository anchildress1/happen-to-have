import { z } from 'zod';
import {
  type AnswerHistoryRow,
  answerHistoryRowSchema,
  playbackAudioRowSchema,
  playbackTargetRowSchema,
} from '../../schema/rows';
import { db, type SqlClient } from '../client';

/**
 * Publishing an answer, and the eligibility rules that gate it (FR-015 – FR-019).
 *
 * Every rule here is enforced in SQL rather than in a read-then-write, because all three are
 * races: two tabs, a double-tap, a retried request. A `SELECT` that says "not yet answered"
 * is true until the moment the second insert lands.
 */

/** FR-019. Publication and the ask grant are one statement, or neither happened. */
export const PUBLISH_ANSWER_SQL = `
  WITH eligible AS (
    SELECT q.id
      FROM questions q
     WHERE q.id = $1
       -- FR-016: never your own question. A seeded question has a NULL participant_id, and
       -- an inequality test against NULL yields NULL rather than true, dropping the row and
       -- refusing an answer to every seeded question in the pool. IS DISTINCT FROM keeps it.
       AND (q.participant_id IS DISTINCT FROM $2)
       -- FR-017: one PUBLISHED answer per participant per question. Withheld and failed
       -- attempts left no row, so FR-017a's retry is allowed by the same predicate.
       AND NOT EXISTS (
         SELECT 1 FROM answers a
          WHERE a.question_id = q.id AND a.participant_id = $2
       )
  ),
  published AS (
    INSERT INTO answers (question_id, participant_id, display_text, source_language, emotion,
                         duration_seconds, submission_id)
    SELECT e.id, $2, $3, $4, $5, $6, $7 FROM eligible e
    -- FR-015: exactly one answer per submission. The unique constraint is the backstop for
    -- the race the NOT EXISTS above cannot close on its own.
    ON CONFLICT (participant_id, question_id) DO NOTHING
    RETURNING id
  ),
  granted AS (
    UPDATE participants
       SET can_ask = true
     WHERE id = $2
       AND EXISTS (SELECT 1 FROM published)
       -- Already holding one? Answering again does not stack asks (FR-021). FR-020 is the copy.
       AND can_ask = false
    RETURNING id
  )
  SELECT
    (SELECT id FROM published)                    AS answer_id,
    (SELECT count(*) FROM granted)::int > 0       AS ask_granted
`;

/**
 * FR-015, SC-007. Returns the answer a submission id already produced, if any.
 *
 * This is the retried-upload case: the insert succeeded, the response never arrived, the
 * client sent the same recording again. Without this the retry is refused as "already
 * answered" and the participant is told they answered a question whose outcome they never
 * saw — which is indistinguishable, from their side, from having lost the answer.
 */
export const FIND_BY_SUBMISSION_SQL = `
  SELECT a.id, p.can_ask
    FROM answers a
    JOIN participants p ON p.id = a.participant_id
   WHERE a.submission_id = $1 AND a.participant_id = $2
`;

export async function findBySubmission(
  submissionId: string,
  participantIdValue: string,
  client: SqlClient = db,
): Promise<{ answerId: string; askGranted: boolean } | null> {
  const parsed = z.uuid().safeParse(submissionId);
  if (!parsed.success) {
    return null;
  }

  const { rows } = await client.query<{ id: string; can_ask: boolean }>(FIND_BY_SUBMISSION_SQL, [
    parsed.data,
    participantId.parse(participantIdValue),
  ]);
  // `can_ask` was already selected and thrown away, so a retry after a lost response always
  // reported askGranted:false and rendered "Your question is still waiting for you" — telling
  // someone who had just earned an ask that they had not. The contract says replay the
  // original outcome; this is the outcome.
  return rows[0] ? { answerId: rows[0].id, askGranted: rows[0].can_ask } : null;
}

export type PublishResult =
  | { published: true; answerId: string; askGranted: boolean }
  | { published: false; reason: 'ineligible' };

const participantId = z.uuid();
const questionId = z.uuid();

/**
 * Inserts the published answer and grants an ask, atomically.
 *
 * Returns `ineligible` rather than throwing when a rule refuses: the caller renders a page
 * either way, and the review has already been paid for by this point.
 */
export async function publishAnswer(
  input: {
    questionId: string;
    participantId: string;
    displayText: string;
    sourceLanguage: string;
    emotion: string | null;
    durationSeconds: number;
    submissionId: string;
  },
  client: SqlClient = db,
): Promise<PublishResult> {
  // Validated here rather than trusted: both columns are uuid, so a malformed id surfaces as
  // a driver error rather than a decision the caller can render.
  const question = questionId.parse(input.questionId);
  const participant = participantId.parse(input.participantId);

  const { rows } = await client.query<{ answer_id: string | null; ask_granted: boolean }>(
    PUBLISH_ANSWER_SQL,
    [
      question,
      participant,
      input.displayText,
      input.sourceLanguage,
      input.emotion,
      input.durationSeconds,
      z.uuid().parse(input.submissionId),
    ],
  );

  const row = rows[0];
  if (!row?.answer_id) {
    return { published: false, reason: 'ineligible' };
  }
  return { published: true, answerId: row.answer_id, askGranted: row.ask_granted };
}

/**
 * 005 FR-004 – FR-007. Every answer this participant published, with the question it addressed.
 *
 * No status predicate, because none is possible: only published answers are rows at all, and the
 * row's existence IS publication (001's schema comment, still true). FR-008 forbids pending,
 * withheld, failed and abandoned attempts from appearing here, and they cannot — there is nothing
 * to filter out.
 *
 * `generated_audio` is not selected. FR-014 puts Listen on responses, not on one's own answers,
 * and pulling 3-4 MB per row into a render that shows text would be spending the whole cache to
 * display nothing.
 *
 * Newest first. This is the participant's own history, where recency is the useful order and no
 * ranking question arises — nobody ranks their own contributions against each other. The
 * chronological rule that FR-018 cares about governs *responses*, not this list.
 */
export async function listPublishedAnswers(
  participantIdValue: string,
  client: SqlClient = db,
): Promise<AnswerHistoryRow[]> {
  const parsed = z.uuid().safeParse(participantIdValue);
  if (!parsed.success) {
    // A stale or tampered cookie is a participant with no history, not an error to render.
    return [];
  }

  const { rows } = await client.query<Record<string, unknown>>(
    `SELECT a.id, a.display_text, a.created_at, q.display_text AS question_text
       FROM answers a
       JOIN questions q ON q.id = a.question_id
      WHERE a.participant_id = $1
      ORDER BY a.created_at DESC, a.id DESC`,
    [parsed.data],
  );
  return rows.map((row) => answerHistoryRowSchema.parse(row));
}

/** What `authorizePlayback` found: the text to voice, and whether audio already exists. */
export interface PlaybackTarget {
  displayText: string;
  cached: boolean;
}

/**
 * 005 FR-002, FR-031. The answer's text, if this participant is allowed to hear it.
 *
 * One predicate covers both ways an answer belongs to the requester: they wrote it, or they asked
 * the question it answers. Those are the only two, because `Yours` shows nothing else
 * (research D5).
 *
 * **Null means "not found" and the caller MUST render it as 404, never 403.** A distinct
 * forbidden status confirms the row exists, which hands anyone enumerating uuids a status-code
 * oracle over other people's answers.
 *
 * **`display_text` comes from this row and never from the request body.** A client-supplied text
 * would let anyone have arbitrary text voiced in the product's voice at the product's expense.
 */
export async function authorizePlayback(
  answerIdValue: string,
  participantIdValue: string,
  client: SqlClient = db,
): Promise<PlaybackTarget | null> {
  const answer = z.uuid().safeParse(answerIdValue);
  const participant = z.uuid().safeParse(participantIdValue);
  if (!answer.success || !participant.success) {
    return null;
  }

  const { rows } = await client.query<Record<string, unknown>>(
    `SELECT a.display_text, (a.generated_audio IS NOT NULL) AS cached
       FROM answers a
       JOIN questions q ON q.id = a.question_id
      WHERE a.id = $1
        AND (a.participant_id = $2 OR q.participant_id = $2)`,
    [answer.data, participant.data],
  );

  if (!rows[0]) {
    return null;
  }

  // Parsed, not asserted. A TypeScript type parameter describes the shape the schema promised,
  // never the shape that arrived, and this text is about to be sent to a paid provider and cached
  // permanently — a wrong shape here is billed and then stored.
  const row = playbackTargetRowSchema.parse(rows[0]);
  return { displayText: row.display_text, cached: row.cached };
}

/**
 * 005 FR-027. The cached playback for an answer, or null when none has been produced.
 *
 * Unauthorized on purpose — callers reach this only after `authorizePlayback` has returned a row,
 * and duplicating the join here would mean two places to get the ownership rule wrong.
 */
export async function readPlayback(
  answerIdValue: string,
  client: SqlClient = db,
): Promise<Uint8Array | null> {
  const parsed = z.uuid().safeParse(answerIdValue);
  if (!parsed.success) {
    return null;
  }

  const { rows } = await client.query<Record<string, unknown>>(
    'SELECT generated_audio FROM answers WHERE id = $1',
    [parsed.data],
  );
  if (!rows[0]) {
    return null;
  }
  return playbackAudioRowSchema.parse(rows[0]).generated_audio;
}

/**
 * 005 FR-027, FR-028, SC-004, SC-005. The produce-once storage guarantee.
 *
 * `generated_audio IS NULL` is the whole of it. Zero rows back means another request produced
 * first; the caller re-reads and serves the winner's audio rather than overwriting it, so the
 * bytes a participant hears never change between one Listen and the next.
 *
 * **Why a guard and not a lock** (research D2). An advisory lock held across the TTS call would
 * pin connections from a pool capped at `max: 4` for the several seconds Gemini takes — four
 * concurrent first Listens would stall every other query in the instance. A claim-then-produce
 * pending row is worse: it is processing state in the database, which Principle V forbids in
 * those words, and a crashed producer leaves a claim nobody clears.
 *
 * Exported as a constant so a test can assert the guard is present. PGlite serializes on one
 * connection and cannot construct the real race, so the structural assertion is the proof —
 * the technique `question-publish.test.ts` established for its consume-then-insert ordering.
 */
export const CLAIM_PLAYBACK_SQL = `
  UPDATE answers
     SET generated_audio = $2, audio_voice_id = $3
   WHERE id = $1
     AND generated_audio IS NULL
  RETURNING id
`;

/**
 * True when this call stored the audio.
 *
 * False covers both refusals: another request had already stored some, or the id was malformed.
 * They collapse deliberately — the caller's only decision is whether to re-read and serve the
 * winner's bytes, and it is the same decision either way. Throwing on a bad id would break the
 * `Promise<boolean>` contract and turn a stale link into a 500.
 *
 * `Uint8Array` and not `Buffer`: the Neon driver hands `bytea` back as a `Buffer` and PGlite as a
 * plain `Uint8Array`. `Buffer` is a subclass, so the wider type accepts both and the narrower one
 * is a lie under test.
 */
export async function claimPlayback(
  answerIdValue: string,
  audio: Uint8Array,
  voiceId: string,
  client: SqlClient = db,
): Promise<boolean> {
  const parsed = z.uuid().safeParse(answerIdValue);
  if (!parsed.success) {
    return false;
  }

  const { rows } = await client.query<{ id: string }>(CLAIM_PLAYBACK_SQL, [
    parsed.data,
    audio,
    voiceId,
  ]);
  return rows.length > 0;
}

/**
 * Whether this participant currently holds an unspent ask (FR-024, FR-025).
 *
 * The server's answer, and the only one that counts. 004 gates its route on this rather than
 * on anything the client sends: FR-024 makes client-supplied eligibility advisory, and FR-025
 * requires refusing a direct request that bypasses the interface entirely.
 *
 * Returns false for an unknown participant rather than throwing. A stale session cookie is a
 * caller with no ask, not an error to render.
 */
export async function readAskEligibility(
  participantIdValue: string,
  client: SqlClient = db,
): Promise<boolean> {
  const parsed = z.uuid().safeParse(participantIdValue);
  if (!parsed.success) {
    return false;
  }

  const { rows } = await client.query<{ can_ask: boolean }>(
    'SELECT can_ask FROM participants WHERE id = $1',
    [parsed.data],
  );
  return rows[0]?.can_ask ?? false;
}
