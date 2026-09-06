-- Up Migration
-- Schema for 003-answer-and-unlock. The 001 schema created `answers` as existence-only:
-- the row's presence IS publication. Publishing now has to carry the text a reader sees,
-- which 002's review returns and nothing yet stores.
--
-- Same bounds as questions.display_text, and for the same reason — the review's content
-- schema caps at 2000 so an over-long transcript fails validation as a retryable fault
-- rather than reaching here and dying on a constraint after the ask has been granted.

ALTER TABLE answers
  ADD COLUMN display_text    text NOT NULL CHECK (char_length(display_text) BETWEEN 1 AND 2000),
  ADD COLUMN source_language text NOT NULL DEFAULT 'en',
  -- Nullable, never defaulted: FR-017 requires recording that NO direction was detectable,
  -- and a default would make "none found" indistinguishable from "never asked".
  ADD COLUMN emotion         text;

-- Down Migration
ALTER TABLE answers
  DROP COLUMN IF EXISTS emotion,
  DROP COLUMN IF EXISTS source_language,
  DROP COLUMN IF EXISTS display_text;
