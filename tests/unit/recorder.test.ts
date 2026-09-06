import { describe, expect, it } from 'vitest';
import { MAX_SECONDS, pickMimeType } from '../../src/ui/useRecorder.js';

/**
 * FR-006 and the format choice. The hook's timing and media handling belong to e2e; what is
 * worth pinning here is the decision that silently records nothing when it is wrong.
 */

describe('recording format (FR-001)', () => {
  it('prefers WebM/Opus where it is supported', () => {
    expect(pickMimeType(() => true)).toBe('audio/webm;codecs=opus');
  });

  it('falls back to MP4 on Safari, which supports no WebM at all', () => {
    // Not hypothetical: mobile Safari has never supported WebM recording. A hard-coded
    // 'audio/webm' constructs a MediaRecorder that produces an empty blob, and the failure
    // surfaces as "we couldn't hear anything" — blaming the participant for a format bug.
    expect(pickMimeType((type) => type.startsWith('audio/mp4'))).toBe('audio/mp4;codecs=mp4a.40.2');
  });

  it('returns null when nothing is supported, so the browser picks its own default', () => {
    expect(pickMimeType(() => false)).toBeNull();
  });

  it('offers codec-qualified types, which is what the server allowlist is built for', () => {
    // The server matches on the base type precisely so these are accepted. If this ever
    // returned bare types, that leniency would go untested.
    expect(pickMimeType(() => true)).toContain(';codecs=');
  });
});

describe('the minute (FR-006)', () => {
  it('stops at sixty seconds', () => {
    expect(MAX_SECONDS).toBe(60);
  });
});
