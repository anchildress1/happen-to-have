import Link from 'next/link';
import { copy } from '@/copy';

/** Mirrors the route's JSON. Kept structural so an unknown status renders the failure page. */
export type AnswerOutcome =
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
  | { status: 'failed' | 'ineligible' | 'lost' };

/**
 * Every terminal state a submission can render (FR-024 – FR-027, FR-040, FR-049).
 *
 * Nothing here explains, justifies or debates a decision, and no model-generated string
 * reaches this file. The crisis page is the one that must not be softened: FR-034 forbids
 * generated counseling or any claim that someone has been alerted.
 */
export function AnswerOutcomeView({
  outcome,
  questionId,
}: {
  outcome: AnswerOutcome;
  questionId: string;
}) {
  // FR-027a: every Withheld, crisis included, offers a fresh recording FOR THE SAME QUESTION.
  // Without the parameter the retry lands on an empty recorder, which is not the retry the
  // requirement guarantees.
  const retry = `/answer/record?questionId=${encodeURIComponent(questionId)}`;
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
        <Link href={retry}>{copy.review.withheld.actionAnswer}</Link>
        <Link href="/answer">{copy.review.crisis.ghostAnswer}</Link>
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
        <Link href={retry}>{copy.review.withheld.actionAnswer}</Link>
        <Link href="/answer">{copy.review.withheld.ghostAnswer}</Link>
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

  // `ineligible` renders here too. It is this system's problem, not something the
  // participant did to their recording, so it must not borrow the Withheld copy.
  //
  // `lost` takes a different helper. FR-014: a dropped connection is not proof that
  // publication failed, and `failed.helper` says the recording was discarded — a claim we
  // cannot make about a response we never saw. Sends them to Yours to check instead.
  return (
    <section>
      <h1>{copy.review.failed.headingAnswer}</h1>
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
        <Link href="/answer">{copy.review.withheld.ghostAnswer}</Link>
      ) : (
        <Link href={retry}>{copy.review.withheld.actionAnswer}</Link>
      )}
    </section>
  );
}
