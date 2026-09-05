import { describe, expect, it } from 'vitest';
import {
  contentResultSchema,
  judgmentResultSchemaFor,
  parseResult,
} from '../../src/review/schemas.js';

/**
 * T009 and T011, FR-036/FR-037. Every provider response is parsed before it is used, and a
 * failure here is a fault that retries — never a rejection, and never something that
 * reaches storage or the interface.
 *
 * The cases below are the ones the spike actually produced: `.text` undefined, and output
 * that was schema-shaped but semantically wrong.
 */

const VALID_CONTENT = {
  canPublish: true,
  displayText: 'Feed it, same time every day.',
  sourceLanguage: 'en',
  emotion: null,
  contentReason: null,
};

const answerSchema = judgmentResultSchemaFor('answer');
const questionSchema = judgmentResultSchemaFor('question');

const VALID_JUDGMENT = {
  crisisCanPublish: true,
  illegalCanPublish: true,
  relevanceCanPublish: true,
  audioQuality: 'clear',
  primaryReason: 'none',
  reasonDetail: '',
};

describe('contentResultSchema', () => {
  it('accepts a well-formed result with no emotion detected', () => {
    expect(contentResultSchema.safeParse(VALID_CONTENT).success).toBe(true);
  });

  it('accepts a rejection carrying the reason that selects its heading', () => {
    const rejected = {
      ...VALID_CONTENT,
      canPublish: false,
      contentReason: 'silence',
    };

    expect(contentResultSchema.safeParse(rejected).success).toBe(true);
  });

  it('rejects a missing emotion key — the model must state that it found none', () => {
    // Nullable but never optional. If an omitted key parsed, "no emotion detected" and
    // "the model forgot the field" would be indistinguishable, and FR-017 requires the
    // first to be recorded rather than assumed.
    const { emotion: _emotion, ...withoutEmotion } = VALID_CONTENT;

    expect(contentResultSchema.safeParse(withoutEmotion).success).toBe(false);
  });

  it('rejects displayText past 2000 characters', () => {
    // Matches the questions.display_text CHECK constraint 001 already enforces. Caught here
    // it is a fault that retries; caught later it is a database error after 003 has already
    // granted the ask.
    const tooLong = { ...VALID_CONTENT, displayText: 'x'.repeat(2001) };

    expect(contentResultSchema.safeParse(tooLong).success).toBe(false);
  });

  it('rejects an empty displayText only when the result claims to be publishable', () => {
    const publishableButEmpty = { ...VALID_CONTENT, displayText: '' };

    expect(contentResultSchema.safeParse(publishableButEmpty).success).toBe(false);
  });

  it('accepts an empty displayText on a refusal — silence has nothing to transcribe', () => {
    // The natural, correct output for a silent recording. Rejecting it would turn the exact
    // case FR-021 wants withheld into three faults and a processing failure, and the
    // participant would read "we couldn't check that" instead of "we couldn't hear anything".
    const silent = {
      ...VALID_CONTENT,
      canPublish: false,
      contentReason: 'silence',
      displayText: '',
    };

    expect(contentResultSchema.safeParse(silent).success).toBe(true);
  });

  it('rejects a refusal that does not say which heading to render', () => {
    const noReason = { ...VALID_CONTENT, canPublish: false, contentReason: null };

    expect(contentResultSchema.safeParse(noReason).success).toBe(false);
  });

  it('rejects a contentReason outside the three headings copy.md defines', () => {
    const unknownReason = { ...VALID_CONTENT, contentReason: 'spam' };

    expect(contentResultSchema.safeParse(unknownReason).success).toBe(false);
  });
});

describe('judgmentResultSchema', () => {
  it('accepts three verdicts plus the named reason and audio quality', () => {
    expect(answerSchema.safeParse(VALID_JUDGMENT).success).toBe(true);
  });

  it('accepts a null relevance verdict for a question, where it does not apply', () => {
    const question = { ...VALID_JUDGMENT, relevanceCanPublish: null };

    expect(questionSchema.safeParse(question).success).toBe(true);
  });

  it('rejects a null relevance verdict on an ANSWER — absence is not permission', () => {
    // Null is correct for a question and ABSENT for an answer. One schema accepting both
    // would let a dropped relevance verdict publish an off-topic answer, at the only layer
    // positioned to catch it (FR-019).
    const answer = { ...VALID_JUDGMENT, relevanceCanPublish: null };

    expect(answerSchema.safeParse(answer).success).toBe(false);
  });

  it('rejects a boolean relevance verdict on a QUESTION, which never evaluates it', () => {
    expect(questionSchema.safeParse(VALID_JUDGMENT).success).toBe(false);
  });

  it('rejects a missing crisis verdict — absence is not permission', () => {
    // A dropped field must not read as a pass. Publication requires every applicable signal
    // to explicitly permit (FR-019), so an absent verdict has to fail the parse and retry.
    const { crisisCanPublish: _crisis, ...withoutCrisis } = VALID_JUDGMENT;

    expect(answerSchema.safeParse(withoutCrisis).success).toBe(false);
  });

  it('rejects a primaryReason the gate has no copy for', () => {
    const unknownReason = { ...VALID_JUDGMENT, primaryReason: 'vibes' };

    expect(answerSchema.safeParse(unknownReason).success).toBe(false);
  });

  it('rejects content as a primaryReason — this call never judges content', () => {
    // Accepting it would hand the gate `reason: 'content'` with no contentReason, and
    // WithheldPage branches on that field to pick among three headings.
    const contentReason = { ...VALID_JUDGMENT, primaryReason: 'content' };

    expect(answerSchema.safeParse(contentReason).success).toBe(false);
  });

  it('rejects a refusal that claims no reason', () => {
    // Parses cleanly without the coherence check, and the gate takes withheld.reason
    // straight from primaryReason — leaving it nowhere to go.
    const incoherent = { ...VALID_JUDGMENT, crisisCanPublish: false, primaryReason: 'none' };

    expect(answerSchema.safeParse(incoherent).success).toBe(false);
  });

  it('rejects a reason that names a signal which did not refuse', () => {
    const mismatched = { ...VALID_JUDGMENT, illegalCanPublish: false, primaryReason: 'crisis' };

    expect(answerSchema.safeParse(mismatched).success).toBe(false);
  });

  it('accepts a coherent refusal', () => {
    const refusal = {
      ...VALID_JUDGMENT,
      crisisCanPublish: false,
      primaryReason: 'crisis',
      reasonDetail: 'speaker expresses suicidal ideation',
    };

    expect(answerSchema.safeParse(refusal).success).toBe(true);
  });

  it('rejects an audioQuality outside the three values FR-008h defines', () => {
    const unknownQuality = { ...VALID_JUDGMENT, audioQuality: 'muffled' };

    expect(answerSchema.safeParse(unknownQuality).success).toBe(false);
  });

  it('truncates an over-long reasonDetail instead of discarding the verdict', () => {
    // Rejecting here would throw away a real refusal over a field that renders nowhere and
    // decides nothing: a crisis verdict with a chatty detail would arrive at the participant
    // as a processing failure. Clipping still denies a model somewhere to hide the
    // transcript it was told not to repeat.
    const essay = {
      ...VALID_JUDGMENT,
      crisisCanPublish: false,
      primaryReason: 'crisis',
      reasonDetail: 'x'.repeat(900),
    };

    const parsed = answerSchema.safeParse(essay);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.reasonDetail.length).toBe(500);
  });
});

describe('parseResult — malformed output is a fault, not a verdict', () => {
  it('returns null for undefined text, which the provider really does return', () => {
    // Observed twice in the spike: a 200 response whose `.text` getter yielded undefined.
    expect(parseResult(contentResultSchema, undefined)).toBeNull();
  });

  it('returns null for an empty body', () => {
    expect(parseResult(contentResultSchema, '')).toBeNull();
  });

  it('returns null for text that is not JSON', () => {
    expect(parseResult(contentResultSchema, 'I cannot help with that request.')).toBeNull();
  });

  it('returns null for JSON that parses but fails the schema', () => {
    // Schema-valid generation and semantically valid output are different things. This is
    // the case `responseSchema` alone would let through.
    expect(parseResult(answerSchema, '{"crisisCanPublish":"maybe"}')).toBeNull();
  });

  it('returns the parsed value for a well-formed body', () => {
    const parsed = parseResult(answerSchema, JSON.stringify(VALID_JUDGMENT));

    expect(parsed?.primaryReason).toBe('none');
    expect(parsed?.audioQuality).toBe('clear');
  });

  it('does not distinguish bad JSON from bad schema — both are the same fault', () => {
    // Distinguishing them would invite treating one as a verdict, which is exactly what
    // FR-008b1 forbids for the empty-candidate case.
    expect(parseResult(contentResultSchema, '{oops')).toBeNull();
    expect(parseResult(contentResultSchema, '{"canPublish":true}')).toBeNull();
  });
});
