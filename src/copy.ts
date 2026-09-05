/**
 * Every participant-facing string in one place, so Principle VII is verifiable by reading
 * one file rather than grepping components. The five strings under `product` and `action`
 * are fixed by the handoff and asserted verbatim in E2E tests — a typo in the tagline is a
 * failing test, not a nit.
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
    /**
     * FR-024. Shown after `Try another question` when the pool holds exactly one eligible
     * question, so a press that cannot advance reads as an explanation rather than a
     * broken button. Not an empty state — the question stays on screen.
     */
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

  failure: {
    heading: "That didn't load",
    body: 'Something on our end went wrong. Try again.',
    action: 'Try again',
  },
} as const;
