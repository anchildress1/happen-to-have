import { describe, expect, it } from 'vitest';
import {
  answerRowSchema,
  participantRowSchema,
  questionRowSchema,
  questionStatusSchema,
} from '../../src/schema/rows.js';

const uuid = '11111111-1111-4111-8111-111111111111';
const otherUuid = '22222222-2222-4222-8222-222222222222';
const now = new Date().toISOString();

describe('participantRowSchema', () => {
  it('accepts a well-formed row', () => {
    expect(
      participantRowSchema.safeParse({ id: uuid, can_ask: false, created_at: now }).success,
    ).toBe(true);
  });

  it('rejects a non-uuid id', () => {
    expect(
      participantRowSchema.safeParse({ id: 'not-a-uuid', can_ask: false, created_at: now }).success,
    ).toBe(false);
  });

  it('rejects a non-boolean can_ask', () => {
    expect(
      participantRowSchema.safeParse({ id: uuid, can_ask: 'false', created_at: now }).success,
    ).toBe(false);
  });

  it('rejects a row missing created_at', () => {
    expect(participantRowSchema.safeParse({ id: uuid, can_ask: false }).success).toBe(false);
  });
});

describe('questionRowSchema', () => {
  const base = {
    id: uuid,
    participant_id: null,
    display_text: 'What is your favorite childhood memory?',
    source_language: 'en',
    status: 'open',
    created_at: now,
  };

  it('accepts a well-formed seeded row (null participant_id)', () => {
    expect(questionRowSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a well-formed authored row', () => {
    expect(questionRowSchema.safeParse({ ...base, participant_id: otherUuid }).success).toBe(true);
  });

  it('rejects empty display_text', () => {
    expect(questionRowSchema.safeParse({ ...base, display_text: '' }).success).toBe(false);
  });

  it('rejects display_text over 2000 characters', () => {
    expect(questionRowSchema.safeParse({ ...base, display_text: 'a'.repeat(2001) }).success).toBe(
      false,
    );
  });

  it('accepts display_text at exactly the 1 and 2000 character bounds', () => {
    expect(questionRowSchema.safeParse({ ...base, display_text: 'a' }).success).toBe(true);
    expect(questionRowSchema.safeParse({ ...base, display_text: 'a'.repeat(2000) }).success).toBe(
      true,
    );
  });

  it('rejects a status outside the enum', () => {
    expect(questionRowSchema.safeParse({ ...base, status: 'pending' }).success).toBe(false);
  });

  it('rejects a non-uuid participant_id', () => {
    expect(questionRowSchema.safeParse({ ...base, participant_id: 'nope' }).success).toBe(false);
  });

  it('rejects a missing display_text', () => {
    const { display_text: _displayText, ...rest } = base;
    expect(questionRowSchema.safeParse(rest).success).toBe(false);
  });
});

describe('answerRowSchema', () => {
  const base = {
    id: uuid,
    question_id: otherUuid,
    participant_id: uuid,
    created_at: now,
  };

  it('accepts a well-formed row', () => {
    expect(answerRowSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a null participant_id — every answer has an author', () => {
    expect(answerRowSchema.safeParse({ ...base, participant_id: null }).success).toBe(false);
  });

  it('rejects a missing question_id', () => {
    const { question_id: _questionId, ...rest } = base;
    expect(answerRowSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a non-uuid id', () => {
    expect(answerRowSchema.safeParse({ ...base, id: 'nope' }).success).toBe(false);
  });
});

describe('questionStatusSchema', () => {
  it('accepts open and closed', () => {
    expect(questionStatusSchema.safeParse('open').success).toBe(true);
    expect(questionStatusSchema.safeParse('closed').success).toBe(true);
  });

  it('rejects any other value', () => {
    expect(questionStatusSchema.safeParse('archived').success).toBe(false);
  });
});
