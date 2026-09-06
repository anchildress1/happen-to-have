/**
 * Every participant-facing string in one place, so Principle VII is verifiable by reading
 * one file rather than grepping components. The strings under `product` and `action` are
 * fixed by the handoff and asserted verbatim — a typo in the tagline is a failing test, not
 * a nit.
 *
 * See specs/001-participant-and-pool/contracts/copy.md, which also carries the forbidden
 * terms: no "who answers" framing, no marketplace or expert language, nothing describing
 * the pipeline as an agent, no generated dialect, and no positioning on "safe".
 */
export const copy = {
  product: {
    /** The question mark is part of the name. It stays in every occurrence. */
    name: 'Happen to Have?',
    tagline: 'Answer one. Ask one.',
    description: 'A human advice exchange. Answer one question, then ask one of your own.',
  },

  action: {
    findQuestion: 'Find me a question',
    canAnswer: 'I can answer this',
    tryAnother: 'Try another question',
  },

  nav: {
    yours: 'Yours',
  },

  arrival: {
    helper: 'Sixty seconds, in your own voice. Once your answer counts, you can ask.',
    /** Desktop only. The clearest statement of Principle I anywhere in the product. */
    footer: 'Every question and every answer comes from a person.',
  },

  selection: {
    helperMobile: 'Answer in your own voice. Up to 60 seconds.',
    helperDesktop:
      'Answer in your own voice. Up to 60 seconds. Once your answer counts, you can ask one of your own.',
    /** FR-024. Shown when a skip cannot advance because the pool holds exactly one. */
    onlyQuestion: 'This is the only question waiting right now.',
  },

  /**
   * Authored, not designed. The imported design covers no empty, loading, or failure state
   * (contracts/design.md, "Gaps"). Flagged there for a design pass; the empty state is what
   * a judge hits by clicking once more than expected.
   */
  empty: {
    heading: 'Nothing waiting right now',
    body: "Every question out there is either yours or one you've already answered. Check back in a bit — new ones show up as people ask them.",
  },

  loading: 'Finding you a question…',

  /** Placeholder route until 003 delivers recording. */
  recordPlaceholder: {
    heading: 'Recording isn\u2019t built yet',
    body: 'This is where you\u2019d record your answer. It lands with the next slice of work.',
  },

  failure: {
    heading: "That didn't load",
    body: 'Something on our end went wrong. Try again.',
    action: 'Try again',
  },

  /**
   * The states the review renders, from
   * specs/002-contribution-review/contracts/copy.md.
   *
   * Every string here is fixed. FR-027 forbids explaining, justifying or debating a
   * decision, and nothing model-generated may reach a participant — `reasonDetail` from the
   * judgment call is a log field and must never appear on a page.
   */
  review: {
    /** FR-029. Blocking, no header, no actions; announced via aria-live. */
    checking: {
      headingAnswer: 'Checking your answer\u2026',
      headingQuestion: 'Checking your question\u2026',
      helper: 'This usually takes a few seconds. Keep this page open.',
    },

    /**
     * One page for every rejection reason (FR-024). One shared sub-line; only the heading
     * changes, whichever reason fired.
     */
    withheld: {
      sub: "It wasn't shared. Nothing else changes.",
      /** Fixed verbatim by FR-025. Not to be reworded. */
      relevance: "That response doesn't appear to answer this question. Try another.",
      /** Fixed verbatim by FR-026. Not to be reworded. */
      illegal: "That response can't be shared here. Try another.",
      /**
       * Selected by the content call's `contentReason`, which is the only thing that can
       * select it. A refusal arriving without one never reaches here: validation rejects it
       * as a fault and the call retries (FR-008h). Nothing else listens to the audio, so
       * there is no second opinion to guess a heading from.
       */
      content: {
        silence: "We couldn't hear anything. Try recording again.",
        unintelligible: "We couldn't make out the recording. Try recording again.",
        unpublishable: "That recording can't be shared here. Try recording again.",
      },
      actionAnswer: 'Record another answer',
      actionQuestion: 'Record another question',
      ghostAnswer: 'Try another question',
      ghostQuestion: 'Back',
    },

    /**
     * FR-032 – FR-035. Human-authored and static: FR-034 forbids generating counseling text
     * or claiming intervention, and the resources stay reachable without an earned ask.
     *
     * The fresh-recording action stays alongside them because the classification can be
     * wrong (FR-027c). The participant does not dismiss one to reach the other.
     */
    crisis: {
      heading: 'It sounds like you might be going through something serious right now.',
      body: "This isn't the right place for that, but these people are, any hour.",
      ghostAnswer: 'Back to questions',
      ghostQuestion: 'Back',
      resources: [
        {
          name: '988 Suicide & Crisis Lifeline',
          qualifier: 'United States \u00b7 call or text',
          value: '988',
        },
        {
          name: 'Crisis Text Line',
          qualifier: 'United States \u00b7 text',
          value: 'HOME to 741741',
        },
        {
          name: 'Find a Helpline',
          qualifier: 'International directory',
          value: 'findahelpline.com',
        },
        {
          name: 'Emergency',
          qualifier: 'If someone is in immediate danger',
          value: 'Local number',
        },
      ],
    },

    /**
     * FR-040. Only after retry exhaustion or deadline expiry — never for a Withheld outcome.
     * The helper puts the fault on this system's side and states plainly that the recording
     * is gone, because FR-040 forbids both blaming the participant and promising recovery.
     */
    failed: {
      headingAnswer: "We couldn't check your answer.",
      headingQuestion: "We couldn't check your question.",
      helper:
        "Something on our side didn't finish. Your recording was discarded. You can record again.",
      lostResponse: "We couldn't confirm what happened. Check Yours before recording again.",
    },

    /** FR-049. The heading names a time, which is why the outcome carries `retryAt`. */
    rateLimited: {
      heading: (time: string) => `You've sent a lot today. You can record again at ${time}.`,
      helper:
        "Everything you've already sent is still being checked or is published. Listening is always open.",
      action: 'Go to Yours',
    },
  },
} as const;
