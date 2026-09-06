import { describe, expect, it } from 'vitest';
import {
  contentResultSchema,
  crisisResultSchema,
  parseResult,
  verdictResultSchema,
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

const VALID_CRISIS = { inTrouble: false, signal: 'none' };

const VALID_VERDICT = { canPublish: true, detail: '' };

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

  it('rejects a missing canPublish — the field the whole decision turns on', () => {
    // Required, and untested until review pointed it out. Without it a response that simply
    // omitted the verdict would parse, and every downstream check reads it as a boolean.
    const { canPublish: _canPublish, ...withoutVerdict } = VALID_CONTENT;

    expect(contentResultSchema.safeParse(withoutVerdict).success).toBe(false);
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

  it('rejects a missing sourceLanguage key — nullable is not optional', () => {
    // Nullable-but-required. If `.optional()` is ever introduced here, an omitted language
    // silently becomes undefined on a publishable result and reaches questions.source_language.
    const { sourceLanguage: _dropped, ...withoutLanguage } = VALID_CONTENT;

    expect(contentResultSchema.safeParse(withoutLanguage).success).toBe(false);
  });

  it('rejects a whitespace-only displayText on a publishable result', () => {
    // The database counts whitespace as characters, so a bare `length >= 1` check passes this
    // and publishes a visually empty question or answer. Nothing downstream is positioned to
    // catch it.
    const blank = { ...VALID_CONTENT, displayText: '   \n  ' };

    expect(contentResultSchema.safeParse(blank).success).toBe(false);
  });

  it('normalizes a blank emotion to null rather than accepting it as a direction', () => {
    // The contract reserves null for "no direction detected". Accepting '' would make an
    // absence indistinguishable from malformed output for 003 and 004.
    const parsed = contentResultSchema.safeParse({ ...VALID_CONTENT, emotion: '   ' });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.emotion).toBeNull();
  });

  it('trims a detected emotion rather than carrying the padding downstream', () => {
    const parsed = contentResultSchema.safeParse({ ...VALID_CONTENT, emotion: '  wistful ' });

    expect(parsed.success && parsed.data.emotion).toBe('wistful');
  });

  it('rejects a whitespace-only sourceLanguage on a publishable result', () => {
    // Untested until review: removing the trim/min left every test green, and an empty
    // language then survives review and dies against questionRowSchema in 003 — after the
    // ask has been granted.
    const blank = { ...VALID_CONTENT, sourceLanguage: '   ' };

    expect(contentResultSchema.safeParse(blank).success).toBe(false);
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

  it('rejects a refusal with no stated reason — there is nothing left to fall back to', () => {
    // This used to parse, on the strength of a cross-call audioQuality fallback that no
    // longer exists: no other call listens to the audio now. Accepting it would leave the
    // gate picking a heading at random, and telling someone their recording was unshareable
    // when it was merely silent is worse than retrying (FR-008h).
    const noReason = { ...VALID_CONTENT, canPublish: false, contentReason: null };

    expect(contentResultSchema.safeParse(noReason).success).toBe(false);
  });

  it('accepts a refusal with no source language, which silence has none of', () => {
    const silent = {
      ...VALID_CONTENT,
      canPublish: false,
      contentReason: 'silence',
      displayText: '',
      sourceLanguage: null,
    };

    expect(contentResultSchema.safeParse(silent).success).toBe(true);
  });

  it('still requires a source language on anything publishable', () => {
    const publishable = { ...VALID_CONTENT, sourceLanguage: null };

    expect(contentResultSchema.safeParse(publishable).success).toBe(false);
  });

  it('rejects a contentReason outside the three headings copy.md defines', () => {
    const unknownReason = { ...VALID_CONTENT, contentReason: 'spam' };

    expect(contentResultSchema.safeParse(unknownReason).success).toBe(false);
  });
});

describe('crisisResultSchema', () => {
  it('accepts a clean verdict', () => {
    expect(crisisResultSchema.safeParse(VALID_CRISIS).success).toBe(true);
  });

  it('accepts a detection naming the category that fired', () => {
    const detected = { inTrouble: true, signal: 'BURDEN' };

    expect(crisisResultSchema.safeParse(detected).success).toBe(true);
  });

  it('rejects a missing inTrouble — absence is not permission', () => {
    const { inTrouble: _dropped, ...withoutVerdict } = VALID_CRISIS;

    expect(crisisResultSchema.safeParse(withoutVerdict).success).toBe(false);
  });

  it('rejects a non-boolean inTrouble rather than coercing it', () => {
    // "maybe" is truthy. Coercing it would publish a hedge as a detection, or worse, read a
    // hedged refusal as a permit.
    expect(crisisResultSchema.safeParse({ ...VALID_CRISIS, inTrouble: 'maybe' }).success).toBe(
      false,
    );
  });

  it('keeps a detection whose signal is explicitly null', () => {
    // A non-gating operator note. Rejecting the response over it would convert the one
    // detection that must never be missed into retries and a processing failure.
    const parsed = crisisResultSchema.safeParse({ inTrouble: true, signal: null });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.inTrouble).toBe(true);
    expect(parsed.success && parsed.data.signal).toBe('');
  });

  it('keeps a detection whose signal is missing entirely', () => {
    // `signal` is a log line. Discarding the one verdict that must never be missed because
    // the model omitted an operator note would be a fault manufactured out of nothing.
    const parsed = crisisResultSchema.safeParse({ inTrouble: true });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.inTrouble).toBe(true);
    expect(parsed.success && parsed.data.signal).toBe('');
  });

  it('truncates an over-long signal instead of discarding the detection', () => {
    const parsed = crisisResultSchema.safeParse({ inTrouble: true, signal: 'x'.repeat(5000) });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.signal.length).toBe(200);
    expect(parsed.success && parsed.data.inTrouble).toBe(true);
  });

  it('has no canPublish field — the polarity inverts in the gate, not the schema', () => {
    // The prompt that scores 10/10 asks whether the person is in trouble. Renaming the field
    // to canPublish here would silently invert every verdict unless the prompt were rewritten
    // too, and rewriting the measured prompt is the thing this shape exists to prevent.
    const parsed = crisisResultSchema.safeParse({ canPublish: true, signal: 'none' });

    expect(parsed.success).toBe(false);
  });
});

describe('verdictResultSchema — illegal and relevance', () => {
  it('accepts a permit', () => {
    expect(verdictResultSchema.safeParse(VALID_VERDICT).success).toBe(true);
  });

  it('accepts a refusal carrying its operator clause', () => {
    const refusal = { canPublish: false, detail: 'instructs evading a background check' };

    expect(verdictResultSchema.safeParse(refusal).success).toBe(true);
  });

  it('rejects a missing canPublish — absence is not permission', () => {
    expect(verdictResultSchema.safeParse({ detail: '' }).success).toBe(false);
  });

  it('rejects a non-boolean canPublish rather than coercing it', () => {
    expect(verdictResultSchema.safeParse({ canPublish: 'yes', detail: '' }).success).toBe(false);
  });

  it('keeps a refusal whose detail is explicitly null', () => {
    const parsed = verdictResultSchema.safeParse({ canPublish: false, detail: null });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.canPublish).toBe(false);
    expect(parsed.success && parsed.data.detail).toBe('');
  });

  it('keeps a refusal whose detail is missing entirely', () => {
    const parsed = verdictResultSchema.safeParse({ canPublish: false });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.canPublish).toBe(false);
    expect(parsed.success && parsed.data.detail).toBe('');
  });

  it('truncates an over-long detail instead of discarding the refusal', () => {
    const parsed = verdictResultSchema.safeParse({ canPublish: false, detail: 'x'.repeat(5000) });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.detail.length).toBe(500);
    expect(parsed.success && parsed.data.canPublish).toBe(false);
  });

  it('carries no field naming the failing signal — the call that refused is the reason', () => {
    // A merged judge needed primaryReason because three verdicts shared one response. With
    // one signal per call there is nothing to name, and a schema that still accepted the
    // field would let the merged shape back in unnoticed (FR-008a, FR-008e).
    const parsed = verdictResultSchema.parse({
      canPublish: false,
      detail: '',
      primaryReason: 'crisis',
    });

    expect(parsed).not.toHaveProperty('primaryReason');
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
    expect(parseResult(crisisResultSchema, '{"inTrouble":"maybe"}')).toBeNull();
  });

  it('returns the parsed value for a well-formed body', () => {
    const parsed = parseResult(
      crisisResultSchema,
      JSON.stringify({ inTrouble: true, signal: 'BURDEN' }),
    );

    expect(parsed?.inTrouble).toBe(true);
    expect(parsed?.signal).toBe('BURDEN');
  });

  it('does not distinguish bad JSON from bad schema — both are the same fault', () => {
    // Distinguishing them would invite treating one as a verdict, which is exactly what
    // FR-008b1 forbids for the empty-candidate case.
    expect(parseResult(contentResultSchema, '{oops')).toBeNull();
    expect(parseResult(contentResultSchema, '{"canPublish":true}')).toBeNull();
  });
});
