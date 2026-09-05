'use client';

import { copy } from '@/copy';
import { AppHeader } from '@/ui/AppHeader';
import { Button } from '@/ui/Button';
import { Screen } from '@/ui/Screen';
import { Watermark } from '@/ui/Watermark';

/**
 * Route-level error boundary for `/answer`: catches the Server Component throwing during
 * render, which QuestionCard's own failure state cannot reach.
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
