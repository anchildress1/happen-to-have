import { expect, test } from '@playwright/test';
import { copy } from '../../src/copy.js';

/**
 * Microphone permission denied (FR-028, SC-010).
 *
 * Its own file because `launchOptions` cannot be scoped to a describe block — Playwright
 * needs a separate worker for a different browser launch, and every other test in
 * `answer.spec.ts` wants the fake device accepted.
 *
 * No `--use-fake-ui-for-media-stream` here, and no microphone permission granted, so Chromium
 * refuses for real and `getUserMedia` rejects with NotAllowedError. That is the path being
 * asserted; stubbing the rejection would test the stub.
 */
test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream'] },
  permissions: [],
});

test('explains how to grant microphone access, and never blames our side (FR-028)', async ({
  page,
  context,
}) => {
  await context.clearPermissions();

  await page.goto('/answer');
  await page.getByRole('link', { name: copy.action.canAnswer }).click();
  await page.waitForURL(/\/answer\/record\?questionId=/);

  await page.getByRole('button', { name: copy.review.recording.start }).click();

  await expect(
    page.getByRole('heading', { name: copy.review.recording.denied.heading }),
  ).toBeVisible();
  await expect(page.getByText(copy.review.recording.denied.helper)).toBeVisible();

  // The defect this replaces: denial rendered the processing-failure helper, telling someone
  // something on our side did not finish when in fact their browser had refused — wrong
  // fault, and an instruction they cannot act on.
  await expect(page.getByText(copy.review.failed.helper)).toHaveCount(0);
});
