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
   * 004. Every string at `/ask`, from specs/004-ask-one/contracts/copy.md.
   *
   * The unlocked and recording screens come from the design contract, which files them under a
   * `003 —` heading its own route map contradicts; the route map is right and `/ask` is 004's.
   */
  ask: {
    unlocked: {
      /** Two lines on mobile, one on desktop. Rendered as one string either way. */
      heading: 'Your answer counts. Ask one.',
      helper: "Your answer is published. You have one question to ask, whenever you're ready.",
      action: 'Ask a question',
      /**
       * Principle II in the participant's language, and its destination is what makes it
       * true: the ask is held, not spent, until a question is created. This must lead
       * somewhere that does not consume it.
       */
      ghost: "Not now — it'll keep",
    },
    recording: {
      heading: 'What do you happen to need?',
      helper:
        "Say it plainly, the way you'd ask a neighbor. Up to 60 seconds. People will answer in their own voices.",
      /** The participant-facing form of FR-016, and it is true — nothing is consumed until
       *  the insert. It is what makes abandoning the flow feel safe. */
      footnote: 'Your ask is used only once the question is published.',
      /** The only new recording string. Start, Stop, `Record again`, the timer, the ceiling
       *  line and all three microphone-failure states are 003's, reused verbatim. */
      submit: 'Share this question',
    },
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

    /**
     * 003. The only outcome that is good news, and the one place the ask is named.
     *
     * `granted` and `alreadyHeld` are separate because answering while already holding an ask
     * does not bank a second one — the ask is a permission, not a currency — and telling
     * someone they earned one when nothing changed is the kind of small lie that makes the
     * whole reciprocity claim untrustworthy.
     */
    published: {
      /**
       * Fixed verbatim by 003 FR-020. Not to be reworded.
       *
       * This is the one screen that states the product's rule back to the participant, and
       * the sentence the whole feature exists to earn. An earlier revision of this block
       * invented "Shared. Thank you." — which is friendlier, says nothing about the rule,
       * and is exactly the substitution FR-027 exists to prevent.
       */
      heading: 'Your answer counts. Ask one.',
      /** Separate helpers because the outcomes are separate: FR-021 grants nothing to
       * someone already holding an ask, and the granted line would claim otherwise. */
      granted: "That's one question you can ask, whenever you're ready.",
      alreadyHeld: 'Your question is still waiting for you.',
      action: 'Ask your question',
      ghost: 'Answer another',
    },

    /**
     * 004 FR-015a. The terminal state of the ask flow, and the only screen in the feature the
     * design contract does not cover — it carries `/ask` unlocked, `/ask` recording, Withheld,
     * crisis, processing failure and the rate limit, and no published-question state at all.
     *
     * The heading states what happened rather than how it felt. `Shared. Thank you.` is the
     * substitution 003 caught itself making: friendlier, and silent about the rule the screen
     * exists to close.
     *
     * The helper names the spend before the next step. A participant who does not learn the
     * ask is gone here learns it at `/ask` two minutes later, from a redirect with no
     * explanation.
     */
    publishedQuestion: {
      heading: 'Your question is out there.',
      helper: "That's your ask spent. Answer another question to earn the next one.",
      /** The loop is the product: you spent it, go earn another. `/yours` is the ghost. */
      ghost: 'Yours',
    },

    /**
     * 004, research D6. The two-tab case: one tab published, the other recorded afterwards
     * and submitted.
     *
     * MUST NOT reuse the processing-failure copy. That helper says "Something on our side
     * didn't finish. Your recording was discarded. You can record again." — wrong fault, and
     * then an instruction the server will refuse.
     *
     * It does not apologise and offers no retry. Nothing went wrong; the ask bought a
     * question and this recording arrived after it.
     */
    spent: {
      heading: 'Your ask is already spent.',
      helper: 'A question from you is already out there. Answer another one to earn your next ask.',
      ghost: 'Yours',
    },

    /**
     * 003 FR-028, FR-029. Three states, not one: they have three causes and three different
     * next actions. Reusing the processing-failure helper here told someone that something
     * on our side didn't finish when their browser had refused the microphone — wrong fault,
     * and an instruction they cannot act on.
     */
    recording: {
      start: 'Start recording',
      stop: 'Stop',
      again: 'Record again',
      submit: 'Share this answer',
      /** A function so the vocabulary sweep reaches it — allStrings() invokes function-valued
       *  entries. It lived inline in JSX before, which meant contracts/copy.md fixed a string
       *  that no test had ever read. */
      timer: (elapsed: number, limit: number) => `${elapsed}s of ${limit}s`,
      /** FR-007: reaching the ceiling is not a failure, and must not read as one. */
      reachedLimit: "That's the minute. Share it, or record again.",
      denied: {
        heading: 'We need your microphone to hear you.',
        helper: 'Allow microphone access for this site in your browser settings, then try again.',
      },
      noDevice: {
        heading: "We can't find a microphone.",
        helper: 'Connect one, or try a different device.',
      },
      unsupported: {
        heading: "This browser can't record audio.",
        helper: 'Try Safari on iPhone, or Chrome on Android or desktop.',
      },
    },

    /** FR-049. The heading names a time, which is why the outcome carries `retryAt`. */
    rateLimited: {
      heading: (time: string) => `You've sent a lot today. You can record again at ${time}.`,
      // "handled" rather than naming an outcome: the limiter counts withheld, failed and
      // invalid-audio submissions too, and those are gone. Telling someone who hit the limit
      // that way that everything is still in flight is false, and points them at Yours to
      // look for contributions that cannot exist.
      helper: "Everything you've sent today has been handled. Listening is always open.",
      action: 'Go to Yours',
    },
  },
} as const;
