import { expect, type Page, test } from '@playwright/test';

/**
 * `/answer` (User Story 2, FR-020 through FR-025, SC-003). Per contracts/routes.md
 * ("Skipping is not an endpoint"), `Try another question` never leaves the tab: it only
 * advances a pointer into the `queue` returned once by `POST /api/questions/next`
 * (src/ui/QuestionCard.tsx `handleTryAnother`). These tests exercise the real button
 * through a real browser against the seeded pool, which is the only way to observe that
 * client-side contract directly rather than by reading the source.
 *
 * The DB-write half of the same guarantee (no `participants`/`answers` row changes) is
 * proven at the data layer in tests/integration/skip-writes-nothing.test.ts — not
 * repeated here, since a browser can't inspect the database directly.
 */

const TRY_ANOTHER = 'Try another question';

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

  test('skipping issues zero network requests (T056b, FR-020, FR-022, FR-023)', async ({
    page,
  }) => {
    await page.goto('/answer');

    const tryAnother = page.getByRole('button', { name: TRY_ANOTHER });
    // Wait for the initial `POST /api/questions/next` (the one, only, non-skip request in
    // this flow) to resolve before watching for traffic, so it is never mistaken for one.
    await expect(tryAnother).toBeVisible();

    const requestUrls: string[] = [];
    page.on('request', (request) => requestUrls.push(request.url()));

    for (let i = 0; i < 20; i++) {
      await tryAnother.click();
    }

    expect(requestUrls).toEqual([]);
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
