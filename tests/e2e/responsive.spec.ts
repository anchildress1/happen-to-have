import { expect, test } from '@playwright/test';
import { copy } from '../../src/copy.js';

/**
 * Responsive layout (T085, T085b, T085c). contracts/design.md's Layout section is the
 * source of truth: breakpoint 768px, default column 560px, no horizontal scroll ever.
 *
 * T085 needs exactly the widths 402/767/768/1100/1440 — which are precisely the five
 * projects playwright.config.ts already declares — so it asserts once and lets the
 * config's `projects` array supply the width dimension; it loops only over routes itself.
 * T085b and T085c each need to compare two specific widths (or a specific single width)
 * within one test run, which the project mechanism can't do, so both manually set the
 * viewport and are guarded to a single project to avoid five identical repeats.
 */

const ROUTES = ['/', '/answer', '/answer/record', '/yours'] as const;

test.describe('no horizontal scroll at any configured width (T085)', () => {
  for (const route of ROUTES) {
    test(`${route} never scrolls horizontally`, async ({ page }) => {
      await page.goto(route);

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      // The "?" watermark is absolutely positioned off the right edge on purpose
      // (design.md: `right: -30px`/`right: -70px`) and relies on Screen's
      // `overflow: hidden` to clip it. scrollWidth <= clientWidth is what proves that
      // clip actually holds rather than just being declared.
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    });
  }
});

test.describe('desktop grid engages at exactly 768px, not 767 (T085b)', () => {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires this literal shape to recognize a fixtures parameter.
  test.beforeEach(({}, testInfo) => {
    // Geometry doesn't depend on which project runs it — pin to one to avoid five
    // identical repeats of a viewport override this test sets manually anyway.
    testInfo.skip(testInfo.project.name !== 'desktop-768');
  });

  test('Arrival (/) switches from stacked to side-by-side at 768', async ({ page }) => {
    await page.goto('/');
    const heading = page.getByRole('heading', { name: 'Happen to Have?' });
    const action = page.getByRole('link', { name: 'Find me a question' });

    await page.setViewportSize({ width: 767, height: 1024 });
    const mobileHeading = await heading.boundingBox();
    const mobileAction = await action.boundingBox();
    if (!mobileHeading || !mobileAction) throw new Error('missing bounding box at 767');
    // Mobile: `.hero { display: contents }` merges into Screen's flex column, so the
    // action block sits fully below the heading.
    expect(mobileAction.y).toBeGreaterThanOrEqual(mobileHeading.y + mobileHeading.height);

    await page.setViewportSize({ width: 768, height: 1024 });
    const desktopHeading = await heading.boundingBox();
    const desktopAction = await action.boundingBox();
    if (!desktopHeading || !desktopAction) throw new Error('missing bounding box at 768');
    // Desktop: `.hero { display: grid; grid-template-columns: 1fr 1fr }` — the action
    // column sits beside the copy column, not below it.
    expect(desktopAction.x).toBeGreaterThanOrEqual(desktopHeading.x + desktopHeading.width);
    expect(desktopAction.y).toBeLessThan(desktopHeading.y + desktopHeading.height);
  });

  test('Selection (/answer) switches from stacked to side-by-side at 768', async ({ page }) => {
    await page.goto('/answer');
    const question = page.getByRole('heading', { level: 1 });
    await expect(question).toBeVisible();
    const tryAnother = page.getByRole('button', { name: 'Try another question' });

    await page.setViewportSize({ width: 767, height: 1024 });
    const mobileQuestion = await question.boundingBox();
    const mobileButton = await tryAnother.boundingBox();
    if (!mobileQuestion || !mobileButton) throw new Error('missing bounding box at 767');
    // Mobile: `.card` is a flex column — the panel (helper + actions) sits below the
    // question.
    expect(mobileButton.y).toBeGreaterThanOrEqual(mobileQuestion.y + mobileQuestion.height);

    await page.setViewportSize({ width: 768, height: 1024 });
    const desktopQuestion = await question.boundingBox();
    const desktopButton = await tryAnother.boundingBox();
    if (!desktopQuestion || !desktopButton) throw new Error('missing bounding box at 768');
    // Desktop: `.card` becomes `minmax(0,1.4fr) minmax(0,1fr)` — the panel sits beside
    // the question, not below it.
    expect(desktopButton.x).toBeGreaterThanOrEqual(desktopQuestion.x + desktopQuestion.width);
  });
});

test.describe('/yours centres its own column (T085c)', () => {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires this literal shape to recognize a fixtures parameter.
  test.beforeEach(({}, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'desktop-1440');
  });

  /**
   * Rewritten by 005. Both of this test's premises expired when the real screen shipped.
   *
   * It asserted `/yours` used `Screen`'s default 560px column, which was true only because the
   * route was a placeholder with no CSS of its own — 005 sets `--content-max: 720px` for a
   * two-section history. And it located the element by the placeholder's body copy,
   * `'Yours is on its way'`, a string that no longer exists anywhere.
   *
   * The centring assertion is the part worth keeping, so it stays and is measured against the
   * column this screen actually declares. What it guards is unchanged and is the same failure
   * T085d exists for: `--content-max` and a re-declared `max-width` target `.content` at equal
   * specificity, so a duplicate resolves by stylesheet order, and dev and production disagreed on
   * that order once already.
   *
   * The section heading is the locator rather than a body string: it comes from `copy` and is
   * fixed verbatim by FR-001, so it cannot drift out from under this test the way the
   * placeholder's prose did.
   */
  test('/yours centres its widened column at desktop width', async ({ page }) => {
    await page.goto('/yours');

    const heading = page.getByRole('heading', { name: copy.yours.answers.heading, exact: true });
    const box = await heading.boundingBox();
    if (!box) throw new Error('missing bounding box for the Your Answers heading');

    // A block-level heading fills its container exactly, so its measured width is the column's
    // real width rather than the declared max-width. 720px is `--content-max` in
    // app/yours/page.module.css; the +1 absorbs subpixel rounding.
    expect(box.width).toBeLessThanOrEqual(721);
    // Guards the regression in the other direction: a collapse back to Screen's 560px default is
    // exactly what a stylesheet-order bug looks like, and an upper bound alone would pass.
    expect(box.width).toBeGreaterThan(561);

    const viewportWidth = page.viewportSize()?.width ?? 1440;
    const leftMargin = box.x;
    const rightMargin = viewportWidth - (box.x + box.width);
    // Centered means symmetric margins either side, within a few px of rounding/scrollbar.
    expect(Math.abs(leftMargin - rightMargin)).toBeLessThanOrEqual(4);
  });
});

test.describe('a bespoke desktop grid survives back-navigation (T085d)', () => {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires this literal shape to recognize a fixtures parameter.
  test.beforeEach(({}, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'desktop-1440');
  });

  /**
   * Regression guard. `/answer` raises Screen's width cap for its bespoke grid. That
   * override used to re-declare `max-width` on `.content` — the same property, at the same
   * specificity, as Screen's own rule — so which one won came down to the order the
   * bundler happened to emit two CSS modules in. Nothing guarantees that order: dev
   * injected an extra stylesheet on back-navigation, the cascade flipped, and the screen
   * silently collapsed to the 560px default while every class name still looked right.
   *
   * The fix makes the two rules set different properties (Screen reads `--content-max`),
   * so order cannot decide it. This asserts the user-visible half of that: the grid is the
   * same width whether you arrive directly or come back to it.
   */
  test('/answer keeps its 1100px column when reached via browser Back', async ({ page }) => {
    const columnWidth = () =>
      page
        .locator('[class*="Screen-module"][class*="content"]')
        .evaluate((el) => Math.round(el.getBoundingClientRect().width));

    await page.goto('/answer');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const direct = await columnWidth();
    expect(direct).toBeGreaterThan(561);

    await page.getByRole('link', { name: 'I can answer this' }).click();
    await expect(page).toHaveURL(/\/answer\/record/);

    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await columnWidth()).toBe(direct);
  });
});
