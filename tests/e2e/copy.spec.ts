import { expect, type Page, test } from '@playwright/test';
import { copy } from '../../src/copy.js';

/**
 * Copy-compliance checks (Phase 7, T086/T086b). Source of truth is
 * contracts/copy.md — the Fixed strings table and the Prohibitions table.
 *
 * Routes per contracts/design.md's route map: `/`, `/answer`,
 * `/answer/record`, `/yours`.
 */

const ROUTES = ['/', '/answer', '/answer/record', '/yours'] as const;

/**
 * `/answer` renders a question only once its client-side POST to
 * `/api/question` resolves (src/ui/QuestionCard.tsx). Intercepting it
 * makes the ready state deterministic here rather than depending on
 * whatever the shared seeded pool happens to hold.
 */
async function mockReadyQuestion(page: Page): Promise<void> {
  const question = {
    id: 'copy-compliance-test-question',
    displayText: 'Copy compliance test question?',
  };
  await page.route('**/api/question', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ question, queue: [question] }),
    }),
  );
}

async function gotoRoute(page: Page, route: (typeof ROUTES)[number]): Promise<void> {
  if (route === '/answer') await mockReadyQuestion(page);
  await page.goto(route);
}

async function renderedText(page: Page): Promise<string> {
  // innerText, not innerHTML/content: this must scan what a participant reads,
  // never markup — a CSS class or data attribute containing a forbidden
  // substring is not participant-facing copy.
  return page.evaluate(() => document.body.innerText);
}

/**
 * One entry per row of contracts/copy.md's Prohibitions table. Single words use
 * `\b` boundaries so a forbidden root never flags an unrelated word that merely
 * contains it (e.g. "feed" must not flag "feedback"). Multi-word phrases and the
 * apostrophe-bearing dialect examples match as plain substrings instead, since a
 * word-boundary around `'` behaves inconsistently and the phrases are already
 * specific enough not to need it.
 */
const FORBIDDEN_TERMS: Array<{ pattern: RegExp; requirement: string }> = [
  // FR-009: reframes the product as routing to an expert — wrong shape entirely.
  { pattern: /who answers/i, requirement: 'FR-009' },
  { pattern: /who will answer/i, requirement: 'FR-009' },
  { pattern: /let me ask someone else/i, requirement: 'FR-009' },
  { pattern: /\bmarketplace\b/i, requirement: 'FR-009' },
  { pattern: /\bexpertise\b/i, requirement: 'FR-009' },
  { pattern: /\bexpert\b/i, requirement: 'FR-009' },
  { pattern: /\bprofessional\b/i, requirement: 'FR-009' },
  { pattern: /\btherapy\b/i, requirement: 'FR-009' },
  { pattern: /\bcounseling\b/i, requirement: 'FR-009' },
  { pattern: /community feed/i, requirement: 'FR-009' },
  { pattern: /\bfeed\b/i, requirement: 'FR-009' },
  // FR-010: the pipeline is not an agent and must never be described as one.
  { pattern: /\bagent\b/i, requirement: 'FR-010' },
  { pattern: /\bassistant\b/i, requirement: 'FR-010' },
  { pattern: /\bbot\b/i, requirement: 'FR-010' },
  { pattern: /ai-powered/i, requirement: 'FR-010' },
  { pattern: /\bour ai\b/i, requirement: 'FR-010' },
  // FR-011: Appalachia is the origin story, never a performance. "Happen to have"
  // (the product name) is stripped from the text before these run — see below.
  { pattern: /y'?all/i, requirement: 'FR-011' },
  { pattern: /\breckon\b/i, requirement: 'FR-011' },
  { pattern: /fixin['’]? ?to/i, requirement: 'FR-011' },
  { pattern: /\bholler\b/i, requirement: 'FR-011' },
  // No trailing \b here: an apostrophe and the space/punctuation after it are both
  // non-word characters, so \b never forms a boundary between them and a trailing
  // \b would silently never match "goin'", "walkin'", etc.
  { pattern: /\b[a-z]+in['’]/i, requirement: "FR-011 (dropped g's)" },
  // FR-012: safety is expected infrastructure, not positioning.
  { pattern: /keeping you safe/i, requirement: 'FR-012' },
  { pattern: /safe space/i, requirement: 'FR-012' },
  { pattern: /\bsafely\b/i, requirement: 'FR-012' },
  { pattern: /\bsafe\b/i, requirement: 'FR-012' },
];

test.describe('no forbidden term renders on any route (T086)', () => {
  for (const route of ROUTES) {
    test(`rendered text on ${route} contains no prohibited copy`, async ({ page }) => {
      await gotoRoute(page, route);

      const title = await page.title();
      const body = await renderedText(page);

      // Carve-out per contracts/copy.md: "Happen to have" is the product name, not
      // dialect performance. Strip it before scanning so it can never trip a rule
      // aimed at other copy (e.g. a future dropped-g check).
      const text = `${title}\n${body}`.replace(/happen to have/gi, '');

      for (const { pattern, requirement } of FORBIDDEN_TERMS) {
        expect(text, `${requirement}: matched ${pattern} on ${route}`).not.toMatch(pattern);
      }
    });
  }
});

test.describe('handoff-fixed strings render verbatim (T086b)', () => {
  test('Arrival (/) renders the product name, tagline, and primary action', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(copy.product.name);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(copy.product.name);
    await expect(page.getByText(copy.product.tagline, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: copy.action.findQuestion })).toBeVisible();
    await expect(page.getByText(copy.arrival.helper, { exact: true })).toBeVisible();
  });

  test('Selection (/answer) renders the answer and skip actions verbatim', async ({ page }) => {
    await mockReadyQuestion(page);
    await page.goto('/answer');

    await expect(page.getByRole('link', { name: copy.action.canAnswer })).toBeVisible();
    await expect(page.getByRole('button', { name: copy.action.tryAnother })).toBeVisible();
  });

  test('/answer/record offers a recording control, not the retired placeholder', async ({
    page,
  }) => {
    // 003 replaced the placeholder. The route now records, so the assertion that pinned
    // "Try another question" was pinning a page that no longer exists — it went red the
    // moment the real one landed, which is the correct behaviour for a placeholder test.
    await page.goto('/answer/record');

    await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible();
  });
});
