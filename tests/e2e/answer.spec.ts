import { expect, type Page, type Route, test } from '@playwright/test';
import { copy } from '../../src/copy.js';

/**
 * The 003 recording flow, end to end in a browser (US1 – US4).
 *
 * `POST /api/answer` is stubbed with `page.route`, not exercised for real. Every outcome here
 * is a UI contract on whatever JSON that endpoint returns, and the endpoint's own behaviour —
 * eligibility, the ask grant, idempotency — is proven at the query layer in
 * tests/integration/answer-publish.test.ts, which is the only place that can actually create
 * the races those rules exist for.
 *
 * ⚠️ The microphone is faked by Chromium's `--use-fake-device-for-media-stream`. This suite
 * proves the flow, not that a real microphone works — SC-009 and T046 remain open, and no
 * amount of Playwright closes them.
 */

// Scoped to this spec rather than added to playwright.config.ts: only the recording flow
// needs a microphone, and a global fake device would silently apply to every other suite.
// The fake stream is Chromium's own; it produces real audio frames, so MediaRecorder yields a
// non-empty blob and the flow is genuinely exercised rather than mocked out.
test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
  permissions: ['microphone'],
});

const ANSWER_URL = '**/api/answer';
const QUESTION = 'How do you get through a hard week?';
const RECORD_URL = `/answer/record?questionId=11111111-1111-4111-8111-111111111111&text=${encodeURIComponent(QUESTION)}`;

async function stubOutcome(page: Page, body: unknown): Promise<void> {
  await page.route(ANSWER_URL, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

/** Records for `ms`, stops, and waits for the submit control to appear. */
async function recordFor(page: Page, ms: number): Promise<void> {
  await page.getByRole('button', { name: copy.review.recording.start }).click();
  await expect(page.getByRole('button', { name: copy.review.recording.stop })).toBeVisible();
  await page.waitForTimeout(ms);
  await page.getByRole('button', { name: copy.review.recording.stop }).click();
  await expect(page.getByRole('button', { name: copy.review.recording.submit })).toBeVisible();
}

test.describe('User Story 1 — record an answer and earn an ask', () => {
  test('the question stays visible while recording (FR-002)', async ({ page }) => {
    await page.goto(RECORD_URL);

    await expect(page.getByRole('heading', { name: QUESTION })).toBeVisible();
    await page.getByRole('button', { name: copy.review.recording.start }).click();

    // Still visible mid-recording, not just before it. Someone answering a question they can
    // no longer see is the failure FR-002 exists to prevent.
    await expect(page.getByRole('heading', { name: QUESTION })).toBeVisible();
  });

  test('a passing answer renders FR-020 verbatim and offers the ask', async ({ page }) => {
    await stubOutcome(page, { status: 'published', askGranted: true });
    await page.goto(RECORD_URL);
    await recordFor(page, 400);

    await page.getByRole('button', { name: copy.review.recording.submit }).click();

    // Verbatim. This is the one screen that states the product's rule back to the participant,
    // and an earlier revision quietly replaced it with something friendlier that said nothing.
    await expect(page.getByRole('heading', { name: 'Your answer counts. Ask one.' })).toBeVisible();
    await expect(page.getByText(copy.review.published.granted)).toBeVisible();
  });

  test('a passing answer from someone already holding an ask claims no new one (FR-021)', async ({
    page,
  }) => {
    await stubOutcome(page, { status: 'published', askGranted: false });
    await page.goto(RECORD_URL);
    await recordFor(page, 400);

    await page.getByRole('button', { name: copy.review.recording.submit }).click();

    await expect(page.getByText(copy.review.published.alreadyHeld)).toBeVisible();
    await expect(page.getByText(copy.review.published.granted)).toHaveCount(0);
  });
});

test.describe('User Story 2 — the minute', () => {
  test('shows elapsed and remaining while recording (FR-005)', async ({ page }) => {
    await page.goto(RECORD_URL);
    await page.getByRole('button', { name: copy.review.recording.start }).click();

    // "of 60s" rather than a bare number: FR-005 wants both halves, and a count with no
    // ceiling tells someone how long they have talked but not how long they have left.
    await expect(page.getByText(/\d+s of 60s/)).toBeVisible();
  });

  test('a short answer is submittable — there is no minimum (FR-008, SC-008)', async ({ page }) => {
    await page.goto(RECORD_URL);
    await recordFor(page, 300);

    await expect(page.getByRole('button', { name: copy.review.recording.submit })).toBeEnabled();
  });
});

test.describe('User Story 3 — waiting for the verdict', () => {
  test('checking blocks, offers no action, and is announced (FR-012)', async ({ page }) => {
    let release: (() => void) | undefined;
    await page.route(ANSWER_URL, async (route: Route) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'published', askGranted: true }),
      });
    });

    await page.goto(RECORD_URL);
    await recordFor(page, 300);
    await page.getByRole('button', { name: copy.review.recording.submit }).click();

    const status = page.getByRole('status');
    await expect(status).toContainText(copy.review.checking.headingAnswer);
    // No action at all while the decision is unknown. Offering one here invites abandoning a
    // submission that has already been paid for and cannot be undone.
    await expect(page.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('link')).toHaveCount(0);

    release?.();
    await expect(page.getByRole('heading', { name: 'Your answer counts. Ask one.' })).toBeVisible();
  });
});

test.describe('User Story 4 — when recording will not work', () => {
  test('a withheld answer offers a retry carrying the same question (FR-027a)', async ({
    page,
  }) => {
    await stubOutcome(page, { status: 'withheld', reason: 'relevance' });
    await page.goto(RECORD_URL);
    await recordFor(page, 300);
    await page.getByRole('button', { name: copy.review.recording.submit }).click();

    // The parameter is the whole requirement. Without it the retry lands on an empty recorder,
    // which is not a retry — it is a dead end wearing a button.
    const retry = page.getByRole('link', { name: copy.review.withheld.actionAnswer });
    await expect(retry).toHaveAttribute(
      'href',
      /\/answer\/record\?questionId=11111111-1111-4111-8111-111111111111/,
    );
  });

  test('the crisis page offers the same retry alongside its resources, not behind them', async ({
    page,
  }) => {
    await stubOutcome(page, { status: 'withheld', reason: 'crisis' });
    await page.goto(RECORD_URL);
    await recordFor(page, 300);
    await page.getByRole('button', { name: copy.review.recording.submit }).click();

    await expect(page.getByRole('heading', { name: copy.review.crisis.heading })).toBeVisible();
    // Both present at once. The classification can be wrong, and nobody should have to dismiss
    // an offer of help to reach the control that lets them try again.
    // `.first()` because '988' appears in both the Lifeline's name and its number — asserting
    // the resource is reachable, not how many times the string occurs.
    await expect(page.getByText(copy.review.crisis.resources[0].value).first()).toBeVisible();
    await expect(page.getByRole('link', { name: copy.review.withheld.actionAnswer })).toBeVisible();
  });

  test('a processing failure never blames the participant (FR-040)', async ({ page }) => {
    await stubOutcome(page, { status: 'failed', cause: 'exhausted' });
    await page.goto(RECORD_URL);
    await recordFor(page, 300);
    await page.getByRole('button', { name: copy.review.recording.submit }).click();

    await expect(
      page.getByRole('heading', { name: copy.review.failed.headingAnswer }),
    ).toBeVisible();
    await expect(page.getByText(copy.review.failed.helper)).toBeVisible();
  });

  test('an ineligible result renders the failure page, not the withheld one', async ({ page }) => {
    // It means a second answer arrived while the first was in review — this system's race, not
    // something the participant did to their recording. Borrowing the Withheld copy would tell
    // them their answer was rejected on its merits.
    await stubOutcome(page, { status: 'ineligible' });
    await page.goto(RECORD_URL);
    await recordFor(page, 300);
    await page.getByRole('button', { name: copy.review.recording.submit }).click();

    await expect(
      page.getByRole('heading', { name: copy.review.failed.headingAnswer }),
    ).toBeVisible();
    await expect(page.getByText(copy.review.withheld.sub)).toHaveCount(0);
  });

  test('a rate-limited submission names the time it can be retried (FR-049)', async ({ page }) => {
    await stubOutcome(page, {
      status: 'rate_limited',
      retryAt: new Date('2026-09-06T16:30:00Z').toISOString(),
    });
    await page.goto(RECORD_URL);
    await recordFor(page, 300);
    await page.getByRole('button', { name: copy.review.recording.submit }).click();

    await expect(page.getByRole('heading', { name: /You've sent a lot today/ })).toBeVisible();
    await expect(page.getByText(copy.review.rateLimited.helper)).toBeVisible();
  });
});
