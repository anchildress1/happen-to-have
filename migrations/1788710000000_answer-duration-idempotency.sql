-- Up Migration
-- 003 FR-013 and FR-015/SC-007.
--
-- duration_seconds: the ceiling was enforced only by the recorder, which a crafted request
-- skips entirely. FR-013 says the server MUST reject an answer exceeding sixty seconds, so
-- the bound lives where it cannot be bypassed. smallint with a CHECK rather than an interval:
-- the product allows one to sixty, and a type that can hold three hours needs the same CHECK
-- anyway while inviting a value nothing can render.
--
-- submission_id: the (participant_id, question_id) unique constraint stops a double-tap
-- publishing twice and does nothing for the case that actually loses an answer — the request
-- succeeds, the response is lost, the client retries. Without this the retry is refused as
-- "already answered" and the participant is told they answered a question whose outcome they
-- never saw. Unique across the table, not per participant: it identifies one recording
-- attempt, and reusing another's id would be claiming their submission.

ALTER TABLE answers
  ADD COLUMN duration_seconds smallint NOT NULL CHECK (duration_seconds BETWEEN 1 AND 60),
  ADD COLUMN submission_id    uuid     NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE answers ADD CONSTRAINT answers_submission_id_key UNIQUE (submission_id);

-- The default exists only so the column can be added NOT NULL to a table that may already
-- have rows. Every insert supplies one; a generated id would make the retry non-idempotent,
-- which is the whole point of the column.
ALTER TABLE answers ALTER COLUMN submission_id DROP DEFAULT;

-- Down Migration
ALTER TABLE answers DROP CONSTRAINT IF EXISTS answers_submission_id_key;
ALTER TABLE answers
  DROP COLUMN IF EXISTS submission_id,
  DROP COLUMN IF EXISTS duration_seconds;
