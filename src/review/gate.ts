import type { CheckResult, ContentReason, ReviewOutcome, WithheldReason } from './types';

/**
 * Combines settled checks into the one decision `reviewContribution` returns.
 *
 * Three rules, in force order (contracts/review.md):
 *
 * 1. **Fail fast.** The first validated refusal resolves Withheld. Later results cannot
 *    publish anything and cannot change the resolved outcome.
 * 2. **Unanimity to publish.** Every dispatched call must permit. A missing result is not a
 *    permit — a lost transcript can never publish, whatever the judgments returned.
 * 3. **Precedence is for copy only.** Among refusals already known, the order is
 *    crisis → illegal → relevance → content. It never waits for an unfinished check to
 *    discover a better reason.
 */
const PRECEDENCE = ['crisis', 'illegal', 'relevance', 'content'] as const;

/** Presentation order, not decision logic: all four refusals publish nothing. */
export function withheldReason(results: readonly CheckResult[]): WithheldReason | null {
  for (const reason of PRECEDENCE) {
    if (results.some((r) => r.call === reason && r.outcome === 'refuse')) {
      return reason;
    }
  }
  return null;
}

export function resolve(
  results: readonly CheckResult[],
  dispatched: readonly CheckResult['call'][],
  cause: 'exhausted' | 'deadline' = 'exhausted',
): ReviewOutcome {
  const reason = withheldReason(results);

  if (reason === 'content') {
    const content = results.find((r) => r.call === 'content' && r.outcome === 'refuse');
    // Unreachable through validation — a content refusal without a reason fails the schema and
    // retries as a fault (FR-008h). Narrowing rather than asserting, so a future schema change
    // that loosens that constraint surfaces here as a failure instead of a rendered guess.
    const contentReason =
      content?.payload && 'contentReason' in content.payload
        ? (content.payload.contentReason as ContentReason | null)
        : null;
    return contentReason
      ? { status: 'withheld', reason: 'content', contentReason }
      : { status: 'failed', cause };
  }

  if (reason) {
    return { status: 'withheld', reason };
  }

  // Rule 2. Absence is not permission, so every dispatched call must have come back permitting.
  const permitted = dispatched.every((call) =>
    results.some((r) => r.call === call && r.outcome === 'permit'),
  );
  if (!permitted) {
    return { status: 'failed', cause };
  }

  const content = results.find((r) => r.call === 'content');
  if (!content?.payload || !('displayText' in content.payload)) {
    return { status: 'failed', cause };
  }

  return {
    status: 'publish',
    displayText: content.payload.displayText,
    // Non-null by the schema's own refine: a publishable result must name its source language.
    sourceLanguage: content.payload.sourceLanguage as string,
    emotion: content.payload.emotion,
  };
}
