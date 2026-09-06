-- Up Migration
-- Schema for 002-contribution-review. specs/002-contribution-review/data-model.md is the
-- authoritative column list.
--
-- This is the ONLY row 002 persists, and it sits against Principle V, which says only
-- published questions and answers enter the database. The justification is in plan.md's
-- Complexity Tracking: a limiter must count submissions that leave no row, because the
-- withheld and failed ones are exactly the abuse that costs money. Counting published rows
-- misses the attack entirely, and an in-memory counter resets per Cloud Run instance, so the
-- limit stops existing the moment traffic justifies it.
--
-- What this table is NOT: there is deliberately no contribution_id, outcome, reason,
-- audio_ref or transcript column. The row records THAT something was submitted, never WHAT.
-- Adding any of them makes it attempt history and breaks FR-023.
CREATE TABLE submission_rate_limits (
  -- The participant, not a synthetic key. Exactly one live window exists per participant, so
  -- an upsert on conflict is the whole write path and no second row can race into existence.
  participant_id    uuid        PRIMARY KEY REFERENCES participants (id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  submission_count  integer     NOT NULL DEFAULT 0 CHECK (submission_count >= 0)
);

-- ON DELETE CASCADE matters: `make db-sweep` deletes contribution-less participants, and a
-- limiter row must not be the thing that keeps a swept participant's id alive.

-- Down Migration
DROP TABLE IF EXISTS submission_rate_limits;
