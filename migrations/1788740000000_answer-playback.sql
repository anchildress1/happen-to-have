-- Up Migration
-- Schema for 005-yours-and-playback. specs/005-yours-and-playback/data-model.md is the
-- authoritative column list.
--
-- Both columns are NULLABLE with no default and no backfill, and that is not a convenience —
-- it is the feature's central assertion, stored.
--
-- FR-026 requires playback to be produced lazily, on the first Listen. FR-030 requires the text
-- to be readable before any audio exists. SC-003 requires ZERO audio produced for contributions
-- nobody asked for, "verified by counting productions against Listen requests". A NULL column
-- makes that last one a query rather than an inference:
--
--   SELECT count(*) FROM answers WHERE generated_audio IS NOT NULL;
--
-- Publish ten answers, request playback on two, expect 2. Any design that pre-created a marker
-- row or a zero-length blob at publication time would have to prove the same property by
-- reasoning about what the marker meant. This one cannot be misread.
--
-- It also means publication has no audio write path to exercise, which is FR-029 enforced by the
-- shape of the table rather than by a promise in a route handler.

ALTER TABLE answers
  -- bytea, not a storage key. The handoff's data model names `generated_audio_storage_key`,
  -- which reads as a Cloud Storage object — infrastructure this repository does not have and has
  -- spent four features not needing. Original audio never touches storage at all: it lives in
  -- the browser and in one request body, and 003 and 004 both say so.
  --
  -- Standing up a bucket for GENERATED audio would mean a dependency, a bucket, an IAM binding,
  -- a lifecycle rule and a local credential path, to hold a file a column holds. It would also
  -- create the product's first audio bucket right next to Principle IV, whose entire job is that
  -- audio does not accumulate — and the safest bucket is the one that does not exist.
  --
  -- Size, since that is the real objection: Gemini TTS returns 24 kHz 16-bit mono PCM at 48 kB
  -- per second. The 60-second recording ceiling and the 2000-character display_text bound put
  -- playback around 60-90 seconds and 3-4 MB. Postgres TOASTs that out of line without noticing;
  -- the field limit is 1 GB.
  ADD COLUMN generated_audio bytea,
  -- Which prebuilt voice produced the bytes. NULL exactly when generated_audio is NULL — the two
  -- are written by one statement and never independently.
  --
  -- No CHECK enforcing that pairing: the only writer is claimPlayback in
  -- src/db/queries/answers.ts, which sets both. A constraint here would guard against a second
  -- writer that does not exist and that this design has nowhere to put.
  ADD COLUMN audio_voice_id text;

-- No index. Nothing queries BY audio — every read of these columns is already keyed by
-- answers.id, which is the primary key. An index on a 3-4 MB TOASTed column to serve no query
-- would be pure cost.

-- Down Migration
ALTER TABLE answers
  DROP COLUMN IF EXISTS audio_voice_id,
  DROP COLUMN IF EXISTS generated_audio;
