import { describe, expect, it } from 'vitest';
import { resolve, withheldReason } from '../../src/review/gate.js';
import type { CheckResult } from '../../src/review/types.js';

/**
 * The gate, in isolation from the fan-out. FR-019, FR-022, FR-040.
 *
 * The cases that matter here are the ones where a wrong answer is invisible: a missing result
 * read as a permit, and a refusal that picks the wrong reason and so renders the wrong page.
 */

const ANSWER: CheckResult['call'][] = ['content', 'crisis', 'illegal', 'relevance'];
const QUESTION: CheckResult['call'][] = ['content', 'crisis', 'illegal'];

const content = (outcome: 'permit' | 'refuse' | 'fault', contentReason: string | null = null) =>
  ({
    call: 'content',
    outcome,
    payload:
      outcome === 'fault'
        ? null
        : {
            canPublish: outcome === 'permit',
            displayText: outcome === 'permit' ? 'Feed it at the same time daily.' : '',
            sourceLanguage: outcome === 'permit' ? 'en' : null,
            emotion: null,
            contentReason,
          },
    attempts: 1,
  }) as CheckResult;

const crisis = (outcome: 'permit' | 'refuse' | 'fault') =>
  ({
    call: 'crisis',
    outcome,
    payload: outcome === 'fault' ? null : { inTrouble: outcome === 'refuse', signal: 'BURDEN' },
    attempts: 1,
  }) as CheckResult;

const verdict = (call: 'illegal' | 'relevance', outcome: 'permit' | 'refuse' | 'fault') =>
  ({
    call,
    outcome,
    payload: outcome === 'fault' ? null : { canPublish: outcome === 'permit', detail: '' },
    attempts: 1,
  }) as CheckResult;

const allPermit = () => [
  content('permit'),
  crisis('permit'),
  verdict('illegal', 'permit'),
  verdict('relevance', 'permit'),
];

describe('gate — unanimity to publish (FR-019)', () => {
  it('publishes when every dispatched call permits', () => {
    const outcome = resolve(allPermit(), ANSWER);

    expect(outcome).toEqual({
      status: 'publish',
      displayText: 'Feed it at the same time daily.',
      sourceLanguage: 'en',
      emotion: null,
    });
  });

  it('publishes a question on three permits, without waiting for relevance', () => {
    const outcome = resolve(
      [content('permit'), crisis('permit'), verdict('illegal', 'permit')],
      QUESTION,
    );

    expect(outcome.status).toBe('publish');
  });

  it('does NOT publish when a dispatched call never returned — absence is not permission', () => {
    // The whole point of FR-019. Three permits and a missing fourth is a processing failure,
    // not a publication: nothing refused, and the system does not know what the fourth said.
    const outcome = resolve(
      [content('permit'), crisis('permit'), verdict('illegal', 'permit')],
      ANSWER,
    );

    expect(outcome).toEqual({ status: 'failed', cause: 'exhausted' });
  });

  it('does NOT publish when a dispatched call faulted', () => {
    const results = [...allPermit().slice(0, 3), verdict('relevance', 'fault')];

    expect(resolve(results, ANSWER).status).toBe('failed');
  });

  it('does NOT publish a lost transcript even when every judgment permitted', () => {
    // FR-040. Nothing refused, so this is a failure on our side, not a Withheld the
    // participant did something to earn.
    const results = [
      content('fault'),
      crisis('permit'),
      verdict('illegal', 'permit'),
      verdict('relevance', 'permit'),
    ];

    expect(resolve(results, ANSWER)).toEqual({ status: 'failed', cause: 'exhausted' });
  });
});

describe('gate — the refusing call is the reason (FR-008e)', () => {
  it('withholds on crisis and names it', () => {
    const results = [
      content('permit'),
      crisis('refuse'),
      verdict('illegal', 'permit'),
      verdict('relevance', 'permit'),
    ];

    expect(resolve(results, ANSWER)).toEqual({ status: 'withheld', reason: 'crisis' });
  });

  it('withholds on illegal and names it', () => {
    const results = [
      content('permit'),
      crisis('permit'),
      verdict('illegal', 'refuse'),
      verdict('relevance', 'permit'),
    ];

    expect(resolve(results, ANSWER)).toEqual({ status: 'withheld', reason: 'illegal' });
  });

  it('withholds on relevance and names it', () => {
    const results = [
      content('permit'),
      crisis('permit'),
      verdict('illegal', 'permit'),
      verdict('relevance', 'refuse'),
    ];

    expect(resolve(results, ANSWER)).toEqual({ status: 'withheld', reason: 'relevance' });
  });

  it('carries the contentReason through, because copy is keyed by it', () => {
    const results = [
      content('refuse', 'silence'),
      crisis('permit'),
      verdict('illegal', 'permit'),
      verdict('relevance', 'permit'),
    ];

    expect(resolve(results, ANSWER)).toEqual({
      status: 'withheld',
      reason: 'content',
      contentReason: 'silence',
    });
  });
});

describe('gate — precedence is presentation only (FR-022)', () => {
  it('prefers crisis over illegal when both refuse', () => {
    // Both withhold, so the decision is identical either way. What changes is whether the
    // participant reaches the crisis resources page — which is the entire reason this order
    // exists, and why getting it wrong is invisible in a status-only assertion.
    const results = [
      content('permit'),
      crisis('refuse'),
      verdict('illegal', 'refuse'),
      verdict('relevance', 'permit'),
    ];

    expect(withheldReason(results)).toBe('crisis');
  });

  it('prefers illegal over relevance when both refuse', () => {
    const results = [
      content('permit'),
      crisis('permit'),
      verdict('illegal', 'refuse'),
      verdict('relevance', 'refuse'),
    ];

    expect(withheldReason(results)).toBe('illegal');
  });

  it('prefers crisis over content when both refuse', () => {
    const results = [
      content('refuse', 'unpublishable'),
      crisis('refuse'),
      verdict('illegal', 'permit'),
    ];

    expect(resolve(results, QUESTION)).toEqual({ status: 'withheld', reason: 'crisis' });
  });

  it('resolves a refusal without waiting for the unfinished checks', () => {
    // One refusal and nothing else back at all. FR-022 forbids delaying Withheld to see
    // whether a higher-precedence reason turns up.
    expect(resolve([crisis('refuse')], ANSWER)).toEqual({ status: 'withheld', reason: 'crisis' });
  });

  it('returns null when nothing refused', () => {
    expect(withheldReason(allPermit())).toBeNull();
  });
});

describe('gate — a content refusal with no reason is a failure, never a guess (FR-008h)', () => {
  it('does not invent a heading when contentReason is absent', () => {
    // Unreachable through validation, which is the point: if a schema change ever lets one
    // through, the participant gets "we couldn't check that" rather than being told their
    // recording was unshareable when it may only have been silent.
    const results = [content('refuse', null), crisis('permit'), verdict('illegal', 'permit')];

    expect(resolve(results, QUESTION)).toEqual({ status: 'failed', cause: 'exhausted' });
  });
});

describe('gate — deadline is reported as its own cause (FR-040)', () => {
  it('reports deadline rather than exhaustion when the clock ran out', () => {
    expect(resolve([content('fault')], QUESTION, 'deadline')).toEqual({
      status: 'failed',
      cause: 'deadline',
    });
  });
});
