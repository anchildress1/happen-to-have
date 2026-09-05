-- Up Migration
-- Schema for 001-participant-and-pool. specs/001-participant-and-pool/data-model.md is the
-- authoritative column list — only what this feature reads or writes exists here. Specs
-- 002-005 add their own columns in their own migrations.

CREATE TYPE question_status AS ENUM ('open', 'closed');

-- One anonymous, session-scoped person. can_ask is read-only in this feature: 003 grants
-- it, 004 consumes it. No name, username, profile, or credential column exists — the
-- schema itself enforces FR-003.
CREATE TABLE participants (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  can_ask    boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- participant_id is nullable: NULL marks a seeded question (FR-028), not a participant-owned
-- one. status is written only by 004; this feature reads it. There is deliberately no
-- expires_at — unanswered questions never expire (FR-019).
CREATE TABLE questions (
  id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  uuid            REFERENCES participants (id),
  display_text    text            NOT NULL CHECK (char_length(display_text) BETWEEN 1 AND 2000),
  source_language text            NOT NULL DEFAULT 'en',
  status          question_status NOT NULL DEFAULT 'open',
  created_at      timestamptz     NOT NULL DEFAULT now()
);

CREATE INDEX questions_status_idx ON questions (status);

-- Only published answers ever become rows. Withheld, failed, and abandoned attempts leave
-- no row at all (constitution Principle V), which is why there is no status, processing,
-- attempt, or error column: existence of the row IS publication.
CREATE TABLE answers (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id    uuid        NOT NULL REFERENCES questions (id),
  participant_id uuid        NOT NULL REFERENCES participants (id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Prevents two concurrent published answers by one participant to one question, and doubles
-- as the (participant_id, question_id) lookup the selection query's NOT EXISTS needs.
ALTER TABLE answers ADD CONSTRAINT answers_participant_question_key
  UNIQUE (participant_id, question_id);

-- Carries COUNT(*) per question for the fewer-answers bias and 004's three-answer closure
-- rule, so neither ever needs a denormalized, driftable counter.
CREATE INDEX answers_question_id_idx ON answers (question_id);

-- Down Migration
DROP TABLE IF EXISTS answers;
DROP TABLE IF EXISTS questions;
DROP TABLE IF EXISTS participants;
DROP TYPE IF EXISTS question_status;
