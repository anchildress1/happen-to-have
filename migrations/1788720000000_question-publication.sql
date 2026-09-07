-- Up Migration
-- Schema for 004-ask-one. specs/004-ask-one/data-model.md is the authoritative column list.
--
-- Both columns are NULLABLE, with no backfill and no default-then-drop dance. That is the
-- honest shape here, not a convenience: a seeded question was never recorded by anyone, so it
-- has no duration and no submission attempt. 003 had to add `submission_id` as
-- NOT NULL DEFAULT gen_random_uuid() and immediately drop the default, because `answers`
-- already held rows and a generated id would make the retry lookup match nothing. `questions`
-- has the same problem and a better answer: the rows that cannot supply a value are exactly
-- the rows that should not have one.

ALTER TABLE questions
  -- FR-006a. The recorder's ceiling is a product behaviour, not a security boundary — a
  -- crafted request never runs it. smallint with a CHECK rather than an interval: the product
  -- allows one to sixty, and a type that can hold three hours needs the same CHECK anyway.
  ADD COLUMN duration_seconds smallint
    CHECK (duration_seconds IS NULL OR duration_seconds BETWEEN 1 AND 60),
  -- FR-014a. The ask guard alone makes double publication impossible and a lost response
  -- unrecoverable; those are different properties. Without this, a participant whose question
  -- published but whose response was lost is refused on retry — while their question sits in
  -- the pool collecting answers they were never shown.
  ADD COLUMN submission_id uuid;

-- Unique across the table, not per participant: the id names one recording attempt, and a
-- client reusing another's would be claiming their submission. Postgres permits many NULLs
-- under a UNIQUE constraint, which is what lets every seeded question carry none.
ALTER TABLE questions ADD CONSTRAINT questions_submission_id_key UNIQUE (submission_id);

-- Down Migration
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_submission_id_key;
ALTER TABLE questions
  DROP COLUMN IF EXISTS submission_id,
  DROP COLUMN IF EXISTS duration_seconds;
