import { expect, type Route, test } from '@playwright/test';
import { copy } from '../../src/copy.js';

/**
 * `/answer`'s non-happy-path render states (User Story 4, FR-029, T074/T075). These stub
 * `POST /api/question` with `page.route` rather than shaping real database rows: the
 * empty and failure states are a UI contract on whatever JSON that endpoint returns, and
 * `src/ui/QuestionCard.tsx` doesn't care how the response was produced. The zero-eligible
 * database path itself is proven at the query layer in
 * tests/integration/empty-pool.test.ts, which is the only place that can actually empty a
 * pool — a browser has no way to assert on `listEligibleQuestions`.
 */

const NEXT_QUESTION_URL = '**/api/question';

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

test.describe('empty state (T074, FR-029)', () => {
  test('renders the empty-pool copy and no question card when the pool has nothing eligible', async ({
    page,
  }) => {
    await page.route(NEXT_QUESTION_URL, (route) =>
      fulfillJson(route, 200, { question: null, queue: [] }),
    );

    await page.goto('/answer');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(copy.empty.heading);
    await expect(page.getByText(copy.empty.body)).toBeVisible();

    // No question card: neither its primary action nor its skip action is present, and the
    // heading never lands on question display text (there is none to display).
    await expect(page.getByRole('link', { name: copy.action.canAnswer })).toHaveCount(0);
    await expect(page.getByRole('button', { name: copy.action.tryAnother })).toHaveCount(0);
  });
});

test.describe('failure state (T075, FR-029)', () => {
  test('renders the failure copy with no leaked internals, and a retry that actually recovers', async ({
    page,
  }) => {
    const question = {
      id: 'states-spec-recovered-question',
      displayText: 'states.spec.ts recovered question',
    };

    let requestCount = 0;
    await page.route(NEXT_QUESTION_URL, async (route) => {
      requestCount += 1;
      if (requestCount === 1) {
        await fulfillJson(route, 500, { error: 'selection_failed' });
        return;
      }
      await fulfillJson(route, 200, { question, queue: [question] });
    });

    await page.goto('/answer');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(copy.failure.heading);
    await expect(page.getByText(copy.failure.body)).toBeVisible();
    const retry = page.getByRole('button', { name: copy.failure.action });
    await expect(retry).toBeVisible();

    // The route contract is exactly `{ error: "selection_failed" }` — prove the page never
    // shows more than that copy: no raw error code, no "Error", no stack frame.
    const bodyText = (await page.locator('body').innerText()).toLowerCase();
    expect(bodyText).not.toContain('selection_failed');
    expect(bodyText).not.toContain('stack');
    expect(bodyText).not.toContain('error:');
    expect(bodyText).not.toContain('.ts:');

    // Act: the retry must genuinely re-run selection, not just render a button that does
    // nothing — assert the recovered question card, not merely that the failure state left.
    await retry.click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(question.displayText);
    await expect(page.getByRole('link', { name: copy.action.canAnswer })).toBeVisible();
    await expect(page.getByRole('button', { name: copy.action.tryAnother })).toBeVisible();
    expect(requestCount).toBe(2);
  });
});
