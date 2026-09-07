import { describe, expect, it } from 'vitest';
import { copy } from '../../src/copy.js';

/**
 * Obligations a code review cannot reliably enforce.
 *
 * FR-025 and FR-026 fix two strings verbatim. A typo in either is a failing test, not a nit,
 * because the spec quotes them character for character.
 *
 * Principle VII forbids a vocabulary. The forbidden-term sweep runs over every string in the
 * file rather than the ones 002 added, so a later feature cannot reintroduce a banned
 * framing somewhere nobody thought to look.
 */

/**
 * Walks the nested copy object and yields every string it produces — including the ones a
 * template function returns.
 *
 * Function-valued entries used to fall through to `[]`, so `review.rateLimited.heading` was
 * never inspected and a forbidden term inside it would have passed the sweep below. Any
 * copy entry that takes arguments is invoked with a representative value: an uninspected
 * string is exactly the gap this sweep exists to close.
 */
function allStrings(value: unknown, path = 'copy'): Array<{ path: string; text: string }> {
  if (typeof value === 'string') {
    return [{ path, text: value }];
  }
  if (typeof value === 'function') {
    return allStrings((value as (arg: string) => unknown)('4:30 PM'), `${path}()`);
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

  it('maps each content reason to the heading that describes it', () => {
    // Distinctness alone was not enough: swapping the silence and unintelligible strings
    // left the old assertion green, and a silent recording would then read "We couldn't make
    // out the recording." Each is now pinned to its own text.
    const { silence, unintelligible, unpublishable } = copy.review.withheld.content;

    expect(silence).toBe("We couldn't hear anything. Try recording again.");
    expect(unintelligible).toBe("We couldn't make out the recording. Try recording again.");
    expect(unpublishable).toBe("That recording can't be shared here. Try recording again.");
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

  it('routes outward and claims nothing about acting (FR-034)', () => {
    // Greps for phrases that were never going to appear proved nothing: replacing the body
    // with "We've already alerted our team and someone will reach out shortly" passed the
    // previous version of this test. Pinned verbatim instead — this is the one page where a
    // reassuring rewrite is a safety defect rather than a copy change.
    expect(copy.review.crisis.body).toBe(
      "This isn't the right place for that, but these people are, any hour.",
    );
    expect(copy.review.crisis.heading).toBe(
      'It sounds like you might be going through something serious right now.',
    );
  });
});

describe('review copy — processing failure (FR-040)', () => {
  it('is pinned verbatim, because substring checks accept blame', () => {
    // `toContain('on our side')` and `toContain('discarded')` were both satisfied by "Your
    // recording was unusable and was discarded on our side. Try speaking more clearly." —
    // which blames the participant for a failure that was not theirs, exactly what FR-040
    // forbids. Substring assertions cannot express "and nothing else".
    expect(copy.review.failed.helper).toBe(
      "Something on our side didn't finish. Your recording was discarded. You can record again.",
    );
  });

  it('names the contribution the participant actually made', () => {
    expect(copy.review.failed.headingAnswer).toBe("We couldn't check your answer.");
    expect(copy.review.failed.headingQuestion).toBe("We couldn't check your question.");
  });
});

describe('review copy — rate limit (FR-049)', () => {
  it('renders the heading verbatim with the time interpolated', () => {
    // Pinned whole, like every other string in this file. `toContain('4:30 PM')` stayed green
    // while the surrounding sentence drifted or grew, which is the failure this suite exists
    // to catch — FR-049 fixes the wording and leaves only <time> free.
    expect(copy.review.rateLimited.heading('4:30 PM')).toBe(
      "You've sent a lot today. You can record again at 4:30 PM.",
    );
  });

  it('renders the helper verbatim, so nothing can be appended to it', () => {
    // `toContain('Listening is always open')` would pass with policy-violating text bolted on
    // either side of it.
    expect(copy.review.rateLimited.helper).toBe(
      "Everything you've sent today has been handled. Listening is always open.",
    );
  });
});

describe('003 copy is pinned where the spec fixes it verbatim', () => {
  it('renders FR-020 exactly, because FR-020 says it must not be reworded', () => {
    // The most-protected string in the feature had the weakest guard: asserted only in e2e,
    // while 002's FR-025 and FR-026 strings are pinned character-for-character here. An
    // earlier revision replaced it with "Shared. Thank you." and nothing in this file noticed.
    expect(copy.review.published.heading).toBe('Your answer counts. Ask one.');

    // FR-021's two outcomes, pinned separately because they are separately wrong when swapped.
    expect(copy.review.published.granted).toBe(
      "That's one question you can ask, whenever you're ready.",
    );
    // The line that has to carry the rule, since FR-020 fixes the heading as a fresh grant in
    // every state. It previously said only "Your question is still waiting for you." — true, and
    // silent on the fact that this answer earned nothing, which is the part a participant who
    // answered twice and could ask once actually needed.
    expect(copy.review.published.alreadyHeld).toBe(
      "You were already holding an ask, so this answer didn't add a second. It's still waiting, whenever you're ready.",
    );
    // The two must never be the same string: one says an ask was earned and the other says it
    // was not, and rendering either in the other's state tells a participant the opposite of
    // what happened.
    expect(copy.review.published.granted).not.toBe(copy.review.published.alreadyHeld);
  });

  it('renders the ceiling line as something that is not a failure (FR-007)', () => {
    expect(copy.review.recording.reachedLimit).toBe(
      "That's the minute. Share it, or record again.",
    );
  });

  it('gives permission denial its own words, not the processing-failure helper', () => {
    // The defect this pins: denial rendered `failed.helper`, telling someone something on our
    // side did not finish when their browser had refused.
    expect(copy.review.recording.denied.helper).not.toBe(copy.review.failed.helper);
    expect(copy.review.recording.denied.helper).toContain('browser settings');
  });
});

describe('005 copy — Yours and playback, pinned where the spec fixes it verbatim', () => {
  it('renders the section headings exactly, because three requirements quote them', () => {
    // FR-001, FR-004 and FR-010 quote these character for character, capitalization included.
    // The warmer rewrite ("Answers you gave") desynchronizes the copy from all three at once,
    // and nothing but this pin would notice.
    expect(copy.yours.answers.heading).toBe('Your Answers');
    expect(copy.yours.questions.heading).toBe('Your Questions');
  });

  it('labels a listed answer with FR-006, not a status among several', () => {
    expect(copy.yours.answers.published).toBe('Published');
  });

  it('renders the answers empty state verbatim (FR-009)', () => {
    expect(copy.yours.answers.empty.heading).toBe('No answers yet');
    expect(copy.yours.answers.empty.body).toBe(
      'Answer a question and it lands here, next to the question it answered.',
    );
  });

  it('renders the questions empty state verbatim (FR-016)', () => {
    // One string covers both ask states on purpose. Branching would need the page to know
    // whether an ask is held, for a difference the participant reads as identical.
    expect(copy.yours.questions.empty.heading).toBe('No questions yet');
    expect(copy.yours.questions.empty.body).toBe(
      'Answer one to earn an ask. The question you spend it on lands here, with everything that comes back.',
    );
  });

  it('promises no arrival when a published question has nothing back (FR-016)', () => {
    // "Nothing yet — check back soon." was rejected: soon is a promise the system neither
    // keeps nor tracks.
    expect(copy.yours.questions.noResponses).toBe('Nothing has come back yet.');
  });

  it('renders every playback state verbatim (FR-014, FR-032 – FR-034)', () => {
    // The one place the product genuinely calls a model, and every natural way to say so
    // breaks Principle I. Pinned whole so no explanation of the pipeline can be appended.
    expect(copy.yours.playback.listen).toBe('Listen');
    expect(copy.yours.playback.loading).toBe('Getting the audio ready…');
    // FR-032. Without a visible `playing`, that state rendered byte-identically to `idle` and a
    // participant part-way through sixty seconds of speech pressed Listen again and got a second
    // voice over the first.
    expect(copy.yours.playback.playing).toBe('Playing…');
    expect(copy.yours.playback.failed).toBe("That didn't play.");
    expect(copy.yours.playback.unavailable).toBe("Listen isn't available right now.");
  });
});

describe('005 copy — response count (FR-012)', () => {
  it('renders one response in the singular', () => {
    // `1 response(s)` is the shape of a form rather than a sentence.
    expect(copy.yours.questions.responseCount(1)).toBe('1 response');
  });

  it('renders more than one in the plural', () => {
    expect(copy.yours.questions.responseCount(3)).toBe('3 responses');
  });

  it('returns a plural for zero, which the screen never asks it for', () => {
    // Zero never reaches this in the UI: the entry renders `noResponses` instead. `0 responses`
    // is true and still wrong — a tally reads as a score on the one screen whose whole job is
    // to carry none (FR-018, FR-020).
    expect(copy.yours.questions.responseCount(0)).toBe('0 responses');
    expect(copy.yours.questions.noResponses).not.toContain('0');
  });

  it('survives the sweep invoking it with a single string', () => {
    // allStrings() calls every function-valued entry with '4:30 PM'. This must not throw, and
    // whatever lands in the interpolation must not put a banned word beside it.
    expect(() => copy.yours.questions.responseCount('4:30 PM' as never)).not.toThrow();
    expect(copy.yours.questions.responseCount('4:30 PM' as never)).toBe('4:30 PM responses');
    expect(allStrings(copy).map(({ path }) => path)).toContain(
      'copy.yours.questions.responseCount()',
    );
  });
});

describe('005 copy — one Yours, not two', () => {
  it('keeps the page H1 and the header link on the same key', () => {
    // A page heading that duplicates a nav label is the one string guaranteed to drift, so
    // `yours` deliberately holds no heading of its own.
    expect(copy.nav.yours).toBe('Yours');
    expect(Object.keys(copy.yours)).toEqual(['answers', 'questions', 'playback']);
    expect(allStrings(copy.yours).filter(({ text }) => text === 'Yours')).toEqual([]);
  });
});

describe('copy — Principle VII forbidden vocabulary', () => {
  // Matched on word boundaries rather than as substrings, so a term can be listed without
  // regard to what it sits inside: bare `bot` would otherwise fire on "both", and `safe` on
  // "safely". A substring list quietly forces every entry to be long enough to be unique,
  // which is how `assistant` and `therapy` were left out of the previous version.
  const FORBIDDEN = [
    // Marketplace and expert-network framing (constitution VII).
    'who answers',
    'ask someone else',
    'expert',
    'experts',
    'marketplace',
    // Positioning the product as something it is not (constitution VII names all four).
    'therapy',
    'therapist',
    'counseling',
    'counselling',
    'feed',
    // Safety as positioning rather than expected infrastructure. Bare `safe` is listed
    // because the constitution forbids it in routine participant-facing copy, not only in
    // the two phrasings that happened to be thought of first.
    'safe',
    'safe space',
    'we keep you safe',
    // Origin-story context that is never product vocabulary.
    'appalachian',
    'busy bees',
    // The product is not an agent, a bot, or an assistant. Every one of these is a word the
    // previous list gestured at in a comment and then failed to check for.
    'ai',
    'agent',
    'assistant',
    'bot',
    'chatbot',
    'our ai',
    'ai-powered',
  ];

  it('reaches the output of template functions, not only literal strings', () => {
    // Guards the sweep itself. If allStrings stops invoking functions, this goes red rather
    // than the forbidden-term test quietly covering less than it claims.
    const swept = allStrings(copy).map(({ path }) => path);

    expect(swept).toContain('copy.review.rateLimited.heading()');
  });

  it('contains no forbidden term anywhere in the file, not merely in 002 strings', () => {
    // Swept over everything so a later feature cannot reintroduce a banned framing in a
    // section nobody thought to re-check.
    const offenders = allStrings(copy)
      .flatMap(({ path, text }) =>
        FORBIDDEN.filter((term) =>
          new RegExp(
            `(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`,
            'iu',
          ).test(text),
        ).map((term) => `${path}: "${term}"`),
      )
      .sort();

    expect(offenders).toEqual([]);
  });

  it('keeps the question mark in the product name', () => {
    expect(copy.product.name).toBe('Happen to Have?');
  });
});
