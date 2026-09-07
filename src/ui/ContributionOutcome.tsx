import Link from 'next/link';
import { copy } from '@/copy';

/** Mirrors either route's JSON. Kept structural so an unknown status renders the failure page. */
export type ContributionOutcome =
  | { status: 'published'; askGranted: boolean }
  // crisis is its own member so narrowing works: a single arm with a union `reason` cannot be
  // narrowed by checking `reason`, and the crisis page is the one that must not fall through.
  | { status: 'withheld'; reason: 'crisis' }
  | { status: 'withheld'; reason: 'illegal' | 'relevance' }
  | {
      status: 'withheld';
      reason: 'content';
      contentReason: keyof typeof copy.review.withheld.content;
    }
  | { status: 'rate_limited'; retryAt: string }
  // `lost` is the dropped-connection case: FR-014 forbids describing it as proof that
  // publication failed, because it is not — the answer may well have published.
  | { status: 'failed' | 'ineligible' | 'lost' }
  /** 004, research D6. The ask was already spent — by an earlier tab, or by nobody. */
  | { status: 'spent' };

/**
 * Every terminal state a submission can render (FR-024 – FR-027, FR-040, FR-049).
 *
 * Nothing here explains, justifies or debates a decision, and no model-generated string
 * reaches this file. The crisis page is the one that must not be softened: FR-034 forbids
 * generated counseling or any claim that someone has been alerted.
 */
export function ContributionOutcomeView({
  outcome,
  kind,
  questionId,
  onRetry,
}: {
  outcome: ContributionOutcome;
  /**
   * Which flow this outcome belongs to. 002 wrote the copy object with `*Answer`/`*Question`
   * pairs for both flows and only the answer half was ever built; this is the prop that
   * finally reads the other half.
   */
  kind: 'answer' | 'question';
  /** The question being answered. Empty for the ask flow, which creates one instead. */
  questionId: string;
  /**
   * Clears the outcome so the recorder comes back.
   *
   * The retry link points at the same URL the participant is already on — FR-027a's whole
   * content is "the same question" — and a Next `<Link>` to the current route does not
   * remount, so the outcome state survived and the Withheld page just sat there. The href
   * stays for middle-click and for anyone landing on it cold; this is what makes the click
   * work.
   */
  onRetry: () => void;
}) {
  // FR-027a: every Withheld, crisis included, offers a fresh recording FOR THE SAME QUESTION.
  // Without the parameter the retry lands on an empty recorder, which is not the retry the
  // requirement guarantees.
  const isAnswer = kind === 'answer';
  // FR-021: every question retry lands on `/ask` with a fresh recorder and the ask intact.
  // No question id travels — there is no prior question to return to, which is the whole
  // difference between the flows.
  const retry = isAnswer ? `/answer/record?questionId=${encodeURIComponent(questionId)}` : '/ask';
  const retryLabel = isAnswer
    ? copy.review.withheld.actionAnswer
    : copy.review.withheld.actionQuestion;
  const withheldGhost = isAnswer
    ? copy.review.withheld.ghostAnswer
    : copy.review.withheld.ghostQuestion;
  const crisisGhost = isAnswer ? copy.review.crisis.ghostAnswer : copy.review.crisis.ghostQuestion;
  const failedHeading = isAnswer
    ? copy.review.failed.headingAnswer
    : copy.review.failed.headingQuestion;
  // The ghost destination for a question is the unlocked ask state, which is the same route.
  const ghostHref = isAnswer ? '/answer' : '/ask';
  /**
   * On the question flow every ghost points at `/ask` — the route the participant is already
   * on — so a Next `<Link>` there does not remount and the outcome state survives, leaving
   * them staring at the refusal screen they just tried to leave. The primary retry already
   * carries `onRetry` for exactly this reason; the ghost needs it too.
   *
   * On the answer flow the ghosts genuinely navigate elsewhere, so they must NOT clear state.
   */
  const ghostClear = isAnswer ? undefined : onRetry;
  if (outcome.status === 'withheld' && outcome.reason === 'crisis') {
    return (
      <section>
        <h1>{copy.review.crisis.heading}</h1>
        <p>{copy.review.crisis.body}</p>
        <ul>
          {copy.review.crisis.resources.map((resource) => (
            <li key={resource.name}>
              <strong>{resource.name}</strong>
              <span>{resource.qualifier}</span>
              <span>{resource.value}</span>
            </li>
          ))}
        </ul>
        {/* Alongside the resources, never behind them: the classification can be wrong
            (FR-027c), and the participant must not dismiss one to reach the other. */}
        <Link href={retry} onClick={onRetry}>
          {retryLabel}
        </Link>
        <Link href={ghostHref} onClick={ghostClear}>
          {crisisGhost}
        </Link>
      </section>
    );
  }

  if (outcome.status === 'withheld') {
    const heading =
      outcome.reason === 'content'
        ? copy.review.withheld.content[outcome.contentReason]
        : copy.review.withheld[outcome.reason];

    return (
      <section>
        <h1>{heading}</h1>
        <p>{copy.review.withheld.sub}</p>
        <Link href={retry} onClick={onRetry}>
          {retryLabel}
        </Link>
        <Link href={ghostHref} onClick={ghostClear}>
          {withheldGhost}
        </Link>
      </section>
    );
  }

  if (outcome.status === 'rate_limited') {
    const time = new Date(outcome.retryAt).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    return (
      <section>
        <h1>{copy.review.rateLimited.heading(time)}</h1>
        <p>{copy.review.rateLimited.helper}</p>
        <Link href="/yours">{copy.review.rateLimited.action}</Link>
      </section>
    );
  }

  if (outcome.status === 'published') {
    // FR-015a. A published question has no `askGranted` to report — the ask was spent, not
    // granted, and that is the only thing that can have happened.
    if (!isAnswer) {
      return (
        <section>
          <h1>{copy.review.publishedQuestion.heading}</h1>
          <p>{copy.review.publishedQuestion.helper}</p>
          {/* The loop is the product: you spent it, go earn another. */}
          <Link href="/answer">{copy.action.findQuestion}</Link>
          <Link href="/yours">{copy.review.publishedQuestion.ghost}</Link>
        </section>
      );
    }

    return (
      <section>
        <h1>{copy.review.published.heading}</h1>
        <p>
          {outcome.askGranted ? copy.review.published.granted : copy.review.published.alreadyHeld}
        </p>
        <Link href="/ask">{copy.review.published.action}</Link>
        <Link href="/answer">{copy.review.published.ghost}</Link>
      </section>
    );
  }

  // research D6. Not a processing failure: nothing went wrong, and that page would tell the
  // participant to record again — which the server will refuse, because the ask is gone.
  if (outcome.status === 'spent') {
    return (
      <section>
        <h1>{copy.review.spent.heading}</h1>
        <p>{copy.review.spent.helper}</p>
        <Link href="/answer">{copy.action.findQuestion}</Link>
        <Link href="/yours">{copy.review.spent.ghost}</Link>
      </section>
    );
  }

  // `ineligible` renders here too. It is this system's problem, not something the
  // participant did to their recording, so it must not borrow the Withheld copy.
  //
  // `lost` takes a different helper. FR-014: a dropped connection is not proof that
  // publication failed, and `failed.helper` says the recording was discarded — a claim we
  // cannot make about a response we never saw. Sends them to Yours to check instead.
  return (
    <section>
      <h1>{failedHeading}</h1>
      <p>
        {outcome.status === 'lost' ? copy.review.failed.lostResponse : copy.review.failed.helper}
      </p>
      {/* Back to selection, not to the same question. `ineligible` means a rule refused it —
          own question, or already answered — so retrying it is guaranteed to be refused again,
          and the spec's deleted-question edge case says return to selection with no penalty.
          `lost` goes to Yours instead: the answer may well have published, and the one thing
          that resolves it is looking. */}
      {outcome.status === 'lost' ? (
        <Link href="/yours">{copy.review.rateLimited.action}</Link>
      ) : outcome.status === 'ineligible' ? (
        <Link href={ghostHref} onClick={ghostClear}>
          {withheldGhost}
        </Link>
      ) : (
        <Link href={retry} onClick={onRetry}>
          {retryLabel}
        </Link>
      )}
    </section>
  );
}
