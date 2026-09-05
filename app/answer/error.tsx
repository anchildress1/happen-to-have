'use client';

import { copy } from '@/copy';
import { AppHeader } from '@/ui/AppHeader';
import { Button } from '@/ui/Button';
import { Screen } from '@/ui/Screen';
import { Watermark } from '@/ui/Watermark';

/**
 * Route-level error boundary for `/answer`.
 *
 * QuestionCard already renders a failure state for the case that actually happens — the
 * selection request failing — because that failure is client-side and recoverable in place.
 * This boundary catches the other kind: the Server Component itself throwing during render.
 * Without it that surfaces as Next's default error page, which is the one screen in the
 * product nobody wrote and nobody would want a demo viewer to find.
 *
 * `reset` re-renders the segment, which is the right recovery: the render failed, not the
 * data.
 */
export default function AnswerError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Screen header={<AppHeader />}>
      <Watermark />
      <h1>{copy.failure.heading}</h1>
      <p>{copy.failure.body}</p>
      <Button type="button" variant="primary" onClick={reset}>
        {copy.failure.action}
      </Button>
    </Screen>
  );
}
