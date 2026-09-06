-- Up Migration
-- Schema for 003-answer-and-unlock. The 001 schema created `answers` as existence-only:
-- the row's presence IS publication. Publishing now has to carry the text a reader sees,
-- which 002's review returns and nothing yet stores.
--
-- Same bounds as questions.display_text, and for the same reason — the review's content
-- schema caps at 2000 so an over-long transcript fails validation as a retryable fault
-- rather than reaching here and dying on a constraint after the ask has been granted.

-- Added nullable, backfilled, then constrained. A bare NOT NULL with no default fails outright
-- on a table that already has rows, and `answers` has been deployed since 001 — every row
-- there predates this column and has no text to put in it.
--
-- The backfill value is a marker, not copy: those rows were published before the review
-- returned text, and inventing something a participant did not say would be worse than
-- admitting the gap. 005 can filter on it.
ALTER TABLE answers
  ADD COLUMN display_text    text,
  ADD COLUMN source_language text NOT NULL DEFAULT 'en',
  -- Nullable, never defaulted: FR-017 requires recording that NO direction was detectable,
  -- and a default would make "none found" indistinguishable from "never asked".
  ADD COLUMN emotion         text;

UPDATE answers SET display_text = '(recorded before answer text was stored)'
 WHERE display_text IS NULL;

ALTER TABLE answers
  ALTER COLUMN display_text SET NOT NULL,
  ADD CONSTRAINT answers_display_text_length
    CHECK (char_length(display_text) BETWEEN 1 AND 2000);

-- Down Migration
ALTER TABLE answers DROP CONSTRAINT IF EXISTS answers_display_text_length;
ALTER TABLE answers
  DROP COLUMN IF EXISTS emotion,
  DROP COLUMN IF EXISTS source_language,
  DROP COLUMN IF EXISTS display_text;
