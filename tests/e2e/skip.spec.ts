import { expect, type Page, type Route, test } from '@playwright/test';
import { copy } from '../../src/copy';

/**
 * `/answer` (User Story 2, FR-020 through FR-025, SC-003). Per contracts/routes.md
 * ("Skipping is not an endpoint"), `Try another question` advances a pointer into the
 * `queue` returned by `POST /api/questions/next` (src/ui/QuestionCard.tsx
 * `handleTryAnother`). Advancing inside a pass never leaves the tab; running off the end
 * refreshes the eligible list, which FR-025 requires and which is the one request a
 * traversal is allowed to make.
 *
 * The DB-write half of the same guarantee (no `participants`/`answers` row changes) is
 * proven at the data layer in tests/integration/skip-writes-nothing.test.ts — not
 * repeated here, since a browser can't inspect the database directly.
 */

const TRY_ANOTHER = 'Try another question';
const NEXT_QUESTION_URL = '**/api/questions/next';

interface QueuedQuestion {
  id: string;
  displayText: string;
  publishedAnswers: number;
}

function question(n: number): QueuedQuestion {
  return {
    id: `skip-fixture-${n}`,
    displayText: `Skip fixture question ${n}?`,
    publishedAnswers: 0,
  };
}

function threeQuestionQueue(): QueuedQuestion[] {
  return [question(1), question(2), question(3)];
}

/** Fixed queue, so pool size is a property of the test. SC-003 names pools of 1 and 2. */
async function fulfillQueue(route: Route, queue: QueuedQuestion[]): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ question: queue[0] ?? null, queue }),
  });
}

/**
 * FR-021 / SC-005: skipping must never touch the microphone API. Stub
 * `navigator.mediaDevices.getUserMedia` before any page script runs so a call is caught
 * (and made to fail loudly) instead of silently succeeding because no camera exists in
 * this headless environment.
 */
async function stubGetUserMedia(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __getUserMediaCalls: number }).__getUserMediaCalls = 0;
    const nav = window.navigator as Navigator & { mediaDevices?: MediaDevices };
    if (!nav.mediaDevices) {
      Object.defineProperty(nav, 'mediaDevices', { value: {}, configurable: true });
    }
    nav.mediaDevices.getUserMedia = () => {
      (window as unknown as { __getUserMediaCalls: number }).__getUserMediaCalls += 1;
      return Promise.reject(new Error('getUserMedia must never be called by skip (FR-021)'));
    };
  });
}

test.describe('skip (User Story 2, FR-020–FR-025, SC-003)', () => {
  test.beforeEach(async ({ page }) => {
    await stubGetUserMedia(page);
  });

  test('twenty consecutive skips advance and wrap gracefully with no error (T056)', async ({
    page,
  }) => {
    await page.goto('/answer');

    const tryAnother = page.getByRole('button', { name: TRY_ANOTHER });
    await expect(tryAnother).toBeVisible();

    const heading = page.getByRole('heading', { level: 1 });
    const seenTexts: string[] = [(await heading.textContent())?.trim() ?? ''];
    expect(seenTexts[0]).not.toBe('');

    for (let i = 0; i < 20; i++) {
      await tryAnother.click();
      const text = (await heading.textContent())?.trim() ?? '';

      // FR-029: never a false empty state or error mid-traversal.
      expect(text).not.toBe('');
      expect(text).not.toBe('Nothing waiting right now');
      expect(text).not.toBe("That didn't load");
      // FR-024: the question just left is never immediately repeated.
      expect(text).not.toBe(seenTexts[seenTexts.length - 1]);

      seenTexts.push(text);
      // The button must still be there to press again — a real empty/error state removes it.
      await expect(tryAnother).toBeVisible();
    }

    // FR-025: a small seeded pool must wrap within twenty presses rather than growing an
    // unbounded list of "new" questions — a repeat somewhere in the run is the proof of a
    // wrap. This deliberately does not assert an exact seed count (contracts/routes.md
    // notes the pool is expected to hold 6 today, but nothing here should hard-code that).
    const uniqueTexts = new Set(seenTexts);
    expect(uniqueTexts.size).toBeLessThan(seenTexts.length);
  });

  test('skipping within a pass issues zero network requests (T056b, FR-020, FR-022, FR-023)', async ({
    page,
  }) => {
    // Three questions puts the pass boundary at a known press: two advances stay in, the
    // third wraps.
    const queue = threeQuestionQueue();
    await page.route(NEXT_QUESTION_URL, (route) => fulfillQueue(route, queue));
    await page.goto('/answer');

    const tryAnother = page.getByRole('button', { name: TRY_ANOTHER });
    // Wait for the initial `POST /api/questions/next` to resolve before watching for
    // traffic, so it is never mistaken for a skip's request.
    await expect(tryAnother).toBeVisible();

    const requestUrls: string[] = [];
    // Next prefetches the header's `Yours` link on its own schedule, next to a different
    // press per viewport. Not traffic a skip caused; everything else still counts.
    page.on('request', (r) => {
      if (!r.url().includes('_rsc=')) requestUrls.push(r.url());
    });

    // Advances 1 and 2 land on indexes 1 and 2 — inside the pass, so nothing leaves the tab.
    await tryAnother.click();
    await tryAnother.click();
    expect(requestUrls).toEqual([]);

    // Advance 3 wraps: FR-025 refreshes, so exactly one request — a read. The no-write
    // half is proven in tests/integration/skip-writes-nothing.test.ts.
    await tryAnother.click();
    await expect
      .poll(() => requestUrls.filter((url) => url.includes('/api/questions/next')).length)
      .toBe(1);
  });

  test('a two-question pool alternates for twenty presses without a false empty state (T095, SC-003)', async ({
    page,
  }) => {
    const queue = [question(1), question(2)];
    await page.route(NEXT_QUESTION_URL, (route) => fulfillQueue(route, queue));
    await page.goto('/answer');

    const tryAnother = page.getByRole('button', { name: TRY_ANOTHER });
    await expect(tryAnother).toBeVisible();

    const heading = page.getByRole('heading', { level: 1 });
    let previous = (await heading.textContent())?.trim() ?? '';

    for (let i = 0; i < 20; i++) {
      await tryAnother.click();
      // FR-024: with two eligible questions the next one always differs, wrap or not.
      await expect(heading).not.toHaveText(previous);
      previous = (await heading.textContent())?.trim() ?? '';

      // FR-029: a wrap is a new pass, never an empty or failed screen.
      expect([copy.empty.heading, copy.failure.heading]).not.toContain(previous);
      await expect(tryAnother).toBeVisible();
    }

    // Only two distinct questions were ever shown — the queue was traversed, not grown.
    expect([queue[0].displayText, queue[1].displayText]).toContain(previous);

    // FR-024's single-question notice belongs to a pool of one and must not leak into this one.
    await expect(page.getByText(copy.selection.onlyQuestion)).toHaveCount(0);
  });

  test('a one-question pool keeps the question visible and says it is the only one (T095, FR-024, US2/AC6)', async ({
    page,
  }) => {
    const only = question(1);
    await page.route(NEXT_QUESTION_URL, (route) => fulfillQueue(route, [only]));
    await page.goto('/answer');

    const tryAnother = page.getByRole('button', { name: TRY_ANOTHER });
    await expect(tryAnother).toBeVisible();

    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText(only.displayText);
    // The notice is an answer to a press, not standing helper text — absent until asked for.
    await expect(page.getByText(copy.selection.onlyQuestion)).toHaveCount(0);

    for (let i = 0; i < 5; i++) {
      await tryAnother.click();

      // The sole eligible question stays on screen with an explanation. Not the empty
      // state: SC-003 calls a pool of one showing "nothing waiting" a false empty state.
      await expect(heading).toHaveText(only.displayText);
      await expect(page.getByText(copy.selection.onlyQuestion)).toBeVisible();
      await expect(page.getByRole('link', { name: copy.action.canAnswer })).toBeVisible();
      await expect(tryAnother).toBeVisible();
    }

    await expect(page.getByText(copy.empty.heading)).toHaveCount(0);
  });

  test('skipping never calls navigator.mediaDevices.getUserMedia (T056c, FR-021)', async ({
    page,
  }) => {
    await page.goto('/answer');

    const tryAnother = page.getByRole('button', { name: TRY_ANOTHER });
    await expect(tryAnother).toBeVisible();

    for (let i = 0; i < 20; i++) {
      await tryAnother.click();
    }

    const calls = await page.evaluate(
      () => (window as unknown as { __getUserMediaCalls: number }).__getUserMediaCalls,
    );
    expect(calls).toBe(0);
  });
});
