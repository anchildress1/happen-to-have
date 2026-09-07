-- Up Migration
-- 004 FR-023a: closure is derived from published answers at selection time, never stored.
--
-- 001 created this column with the comment "status is written only by 004; this feature reads
-- it." 004 is here, and it will never write it. A column whose sole stated purpose is a write
-- that will not happen is worse than absent: the comment reads as a promise, and the next
-- person to touch the selection query finds a `status` field and an index inviting them to use
-- it.
--
-- The count is already indexed. `answers_question_id_idx` was created in 001 with the comment
-- that it carries "COUNT(*) per question for the fewer-answers bias and 004's three-answer
-- closure rule, so neither ever needs a denormalized, driftable counter." This migration is
-- that sentence being kept.
--
-- Nothing is deployed anywhere, so a branch database that disagrees is rebuilt with
-- `make db-up && make migrate && make seed` rather than repaired. That recovery only works
-- because `seed/seed.ts` stopped writing `status` in the same change as this migration —
-- dropping the column without that edit breaks the seed step the recovery depends on.

DROP INDEX IF EXISTS questions_status_idx;

ALTER TABLE questions DROP COLUMN IF EXISTS status;

-- Dropped last: the type cannot go while a column still uses it.
DROP TYPE IF EXISTS question_status;

-- Down Migration
CREATE TYPE question_status AS ENUM ('open', 'closed');

ALTER TABLE questions
  ADD COLUMN status question_status NOT NULL DEFAULT 'open';

CREATE INDEX questions_status_idx ON questions (status);
