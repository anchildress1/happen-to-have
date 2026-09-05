import { describe, expect, it } from 'vitest';
import { copy } from '../../src/copy.js';

/**
 * T022. Two obligations that a code review cannot reliably enforce.
 *
 * FR-025 and FR-026 fix two strings verbatim. A typo in either is a failing test, not a nit,
 * because the spec quotes them character for character.
 *
 * Principle VII forbids a vocabulary. The forbidden-term sweep runs over every string in the
 * file rather than the ones 002 added, so a later feature cannot reintroduce a banned
 * framing somewhere nobody thought to look.
 */

/** Walks the nested copy object and yields every string it contains. */
function allStrings(value: unknown, path = 'copy'): Array<{ path: string; text: string }> {
  if (typeof value === 'string') {
    return [{ path, text: value }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => allStrings(item, `${path}[${index}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => allStrings(child, `${path}.${key}`));
  }
  return [];
}

describe('review copy — the strings the spec fixes verbatim', () => {
  it('matches FR-025 character for character', () => {
    expect(copy.review.withheld.relevance).toBe(
      "That response doesn't appear to answer this question. Try another.",
    );
  });

  it('matches FR-026 character for character', () => {
    expect(copy.review.withheld.illegal).toBe("That response can't be shared here. Try another.");
  });

  it('uses one shared sub-line across every rejection reason', () => {
    // FR-024: one page for all reasons. A second sub-line would be a second page wearing
    // the first one's layout.
    expect(copy.review.withheld.sub).toBe("It wasn't shared. Nothing else changes.");
  });

  it('carries a distinct heading for each of the three content reasons', () => {
    // Without three distinct strings the contentReason field has nothing to select between,
    // and FR-021's required distinctions collapse into one message.
    const { silence, unintelligible, unpublishable } = copy.review.withheld.content;

    expect(new Set([silence, unintelligible, unpublishable]).size).toBe(3);
  });
});

describe('review copy — crisis routing (FR-032 – FR-034)', () => {
  it('lists all four resources, US and international', () => {
    // FR-033 requires both. Three rows would satisfy "some resources" and fail the
    // requirement that actually matters to someone outside the US.
    expect(copy.review.crisis.resources).toHaveLength(4);
    expect(copy.review.crisis.resources.map((resource) => resource.name)).toEqual([
      '988 Suicide & Crisis Lifeline',
      'Crisis Text Line',
      'Find a Helpline',
      'Emergency',
    ]);
  });

  it('gives every resource a qualifier and a value', () => {
    // A row with a name and no number is decoration on the one page where decoration is
    // the wrong thing to render.
    for (const resource of copy.review.crisis.resources) {
      expect(resource.qualifier.length).toBeGreaterThan(0);
      expect(resource.value.length).toBeGreaterThan(0);
    }
  });

  it('names an international route, not only US numbers', () => {
    const qualifiers = copy.review.crisis.resources.map((resource) => resource.qualifier);

    expect(qualifiers.some((qualifier) => qualifier.includes('International'))).toBe(true);
  });

  it('claims no intervention and offers no counseling', () => {
    // FR-034. The body routes outward; it must not imply this product will act.
    const body = copy.review.crisis.body.toLowerCase();

    expect(body).not.toContain('we will');
    expect(body).not.toContain('help is on the way');
    expect(body).not.toContain('contacted');
  });
});

describe('review copy — processing failure (FR-040)', () => {
  it('puts the fault on this system rather than the participant', () => {
    expect(copy.review.failed.helper).toContain('on our side');
  });

  it('says the recording is gone rather than promising to recover it', () => {
    // FR-040 forbids promising recovery of the previous audio. "Try again" without this
    // sentence would imply the recording is still somewhere.
    expect(copy.review.failed.helper).toContain('discarded');
  });
});

describe('review copy — rate limit (FR-049)', () => {
  it('interpolates the time into the heading rather than stating a bare refusal', () => {
    const heading = copy.review.rateLimited.heading('4:30 PM');

    expect(heading).toContain('4:30 PM');
  });

  it('says listening stays open, so the limit reads as covering submission only', () => {
    expect(copy.review.rateLimited.helper).toContain('Listening is always open');
  });
});

describe('copy — Principle VII forbidden vocabulary', () => {
  const FORBIDDEN = [
    // Marketplace and expert-network framing.
    'who answers',
    'ask someone else',
    'expert',
    'marketplace',
    // Safety as positioning rather than expected infrastructure.
    'safe space',
    'we keep you safe',
    // Origin-story context that is never product vocabulary.
    'appalachian',
    'busy bees',
    // The product is not an agent, a bot, or an assistant.
    'our ai',
    'chatbot',
  ];

  it('contains no forbidden term anywhere in the file, not merely in 002 strings', () => {
    // Swept over everything so a later feature cannot reintroduce a banned framing in a
    // section nobody thought to re-check.
    const offenders = allStrings(copy)
      .flatMap(({ path, text }) =>
        FORBIDDEN.filter((term) => text.toLowerCase().includes(term)).map(
          (term) => `${path}: "${term}"`,
        ),
      )
      .sort();

    expect(offenders).toEqual([]);
  });

  it('keeps the question mark in the product name', () => {
    expect(copy.product.name).toBe('Happen to Have?');
  });
});
