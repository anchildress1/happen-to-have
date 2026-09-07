import type { Metadata } from 'next';
import { copy } from '@/copy';
import { listPublishedAnswers } from '@/db/queries/answers';
import { listPublishedQuestions, listResponsesForQuestions } from '@/db/queries/questions';
import type { ResponseRow } from '@/schema/rows';
import { readParticipantIdFromCookies } from '@/session/server';
import { AppHeader } from '@/ui/AppHeader';
import { Screen } from '@/ui/Screen';
import { Watermark } from '@/ui/Watermark';
import styles from './page.module.css';
import { ResponseList } from './ResponseList';

/**
 * 005's personal history: two sections, and what became of everything the participant sent.
 *
 * A server component, and it stays one. Only the `Listen` control needs interactivity, so it
 * lives in `ResponseList`; making this a client component to reach one button would ship the
 * whole history render into the browser bundle and re-fetch data already known at request time.
 *
 * **This module imports nothing from `src/playback/`, and that is load-bearing rather than
 * incidental.** SC-011 requires every word of text to render with playback entirely unavailable,
 * and the way that is guaranteed is that nothing on this path can construct a provider client.
 * Only the route handler does.
 */
export const metadata: Metadata = {
  // Composed rather than hardcoded: `nav.yours` is the same string the header link renders, and a
  // second copy of it is the one guaranteed to drift.
  title: `${copy.nav.yours} · ${copy.product.name}`,
};

// The render depends on the session cookie. A cached `/yours` would serve one participant's
// history to another.
export const dynamic = 'force-dynamic';

export default async function YoursPage() {
  const participantId = await readParticipantIdFromCookies();

  // No session and no history are the same screen from where the participant stands — both mean
  // nothing of theirs has been published. So this does not redirect, error, or branch: it reads
  // as zero answers and zero questions, and both empty states render (SC-009).
  //
  // It also must not mint a participant. `readParticipantIdFromCookies` is read-only by design,
  // because a page that created identity would hand an unauthenticated caller a row for the cost
  // of a GET. 001 owns identity creation, at `/answer`.
  const [answers, questions] = participantId
    ? await Promise.all([
        listPublishedAnswers(participantId),
        listPublishedQuestions(participantId),
      ])
    : [[], []];

  // The second of the two statements serving `Your Questions` (research D7). One query over the
  // whole id set, so the round-trip count does not grow with the number of questions.
  const responses = await listResponsesForQuestions(questions.map((question) => question.id));

  // Grouped here rather than by `json_agg`, so every row validated against a flat schema written
  // in `src/schema/rows.ts` instead of one the database invented.
  const byQuestion = new Map<string, ResponseRow[]>();
  for (const response of responses) {
    const existing = byQuestion.get(response.question_id);
    if (existing) {
      existing.push(response);
    } else {
      byQuestion.set(response.question_id, [response]);
    }
  }

  return (
    <Screen header={<AppHeader />} contentClassName={styles.content}>
      <Watermark />
      <h1 className={styles.pageHeading}>{copy.nav.yours}</h1>

      <section className={styles.section} aria-labelledby="your-answers">
        <h2 className={styles.sectionHeading} id="your-answers">
          {copy.yours.answers.heading}
        </h2>

        {answers.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyHeading}>{copy.yours.answers.empty.heading}</p>
            <p className={styles.emptyBody}>{copy.yours.answers.empty.body}</p>
          </div>
        ) : (
          <ul className={styles.list}>
            {answers.map((answer) => (
              <li className={styles.entry} key={answer.id}>
                {/* FR-005. Context for the answer below it, not the entry itself. */}
                <p className={styles.questionContext}>{answer.question_text}</p>
                {/* FR-007. The entry's primary content. */}
                <p className={styles.body}>{answer.display_text}</p>
                {/* FR-006. A label, not a status among several — nothing unpublished is a row. */}
                <p className={styles.published}>{copy.yours.answers.published}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="your-questions">
        <h2 className={styles.sectionHeading} id="your-questions">
          {copy.yours.questions.heading}
        </h2>

        {questions.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyHeading}>{copy.yours.questions.empty.heading}</p>
            <p className={styles.emptyBody}>{copy.yours.questions.empty.body}</p>
          </div>
        ) : (
          <ul className={styles.list}>
            {questions.map((question) => {
              const questionResponses = byQuestion.get(question.id) ?? [];
              return (
                <li className={styles.entry} key={question.id}>
                  <p className={styles.body}>{question.display_text}</p>
                  {questionResponses.length === 0 ? (
                    // FR-016. Per question, not per screen. Siblings are unaffected, and the
                    // count is deliberately absent — `0 responses` is a tally, and a tally reads
                    // as a score on a screen whose job is to carry none.
                    <p className={styles.noResponses}>{copy.yours.questions.noResponses}</p>
                  ) : (
                    <>
                      {/* FR-012. The length of the list below it, which is the one count that
                          cannot drift from what the participant sees. */}
                      <p className={styles.count}>
                        {copy.yours.questions.responseCount(questionResponses.length)}
                      </p>
                      <ResponseList responses={questionResponses} />
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Screen>
  );
}
