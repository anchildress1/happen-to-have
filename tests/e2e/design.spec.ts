import { expect, type Page, test } from '@playwright/test';

/**
 * Design-fidelity checks (Phase 7, T080-T082). Source of truth is
 * contracts/design.md — "Staging is not product" (T080), the Type section
 * (T081/T081b), and the header section's "No eyebrow text anywhere" note
 * (T082).
 *
 * Routes per contracts/design.md's route map: `/`, `/answer`,
 * `/answer/record`, `/yours`. `/answer/record` and `/yours` are still
 * placeholders (003/005 own their real screens), but the staging-chrome,
 * font, and eyebrow bans are product-wide and apply to whatever renders at
 * a route today.
 */

const ROUTES = ['/', '/answer', '/answer/record', '/yours'] as const;

/**
 * `/answer` renders a question only once its client-side POST to
 * `/api/questions/next` resolves (src/ui/QuestionCard.tsx). Intercepting it
 * makes the ready state deterministic here rather than depending on
 * whatever the shared seeded pool happens to hold.
 */
async function mockReadyQuestion(page: Page): Promise<void> {
  const question = {
    id: 'design-fidelity-test-question',
    displayText: 'Design fidelity test question?',
  };
  await page.route('**/api/questions/next', (route) =>
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

test.describe('no staging chrome ships (T080)', () => {
  // The imported design staged every screen inside ios-frame.jsx (bezel, dynamic
  // island, status bar, home indicator) and browser-window.jsx (macOS Chrome traffic
  // lights, tab bar, URL bar). Both carry `data-om-starter` and must never ship
  // (contracts/design.md, "Staging is not product").
  const STAGING_PATTERNS: RegExp[] = [
    /status[-_ ]?bar/i,
    /dynamic[-_ ]?island/i,
    /home[-_ ]?indicator/i,
    /traffic[-_ ]?light/i,
    /tab[-_ ]?bar/i,
    /url[-_ ]?bar/i,
    /ios-frame/i,
    /browser-window/i,
  ];

  for (const route of ROUTES) {
    test(`renders no device or browser frame on ${route}`, async ({ page }) => {
      await gotoRoute(page, route);

      await expect(page.locator('[data-om-starter]')).toHaveCount(0);

      const html = await page.content();
      for (const pattern of STAGING_PATTERNS) {
        expect(html, `found staging marker matching ${pattern} on ${route}`).not.toMatch(pattern);
      }
    });
  }
});

const ALLOWED_FONT_FAMILIES = new Set(['Sour Gummy', 'Source Sans 3']);

/**
 * Maps every font file URL declared in a `@font-face` rule on the page to that
 * rule's `font-family` name, so a captured network request can be attributed to
 * a family without guessing from the URL — self-hosted `next/font` files carry
 * a content hash, not the family name, in their filename.
 */
async function getFontFamilyByUrl(page: Page): Promise<Map<string, string>> {
  const entries = await page.evaluate(() => {
    const map: Array<[string, string]> = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin stylesheet; none expected, but never let it throw
      }
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const family = rule.style.getPropertyValue('font-family').replace(/^["']|["']$/g, '');
        const src = rule.style.getPropertyValue('src');
        for (const match of src.matchAll(/url\(([^)]+)\)/g)) {
          const rawUrl = match[1].replace(/^["']|["']$/g, '');
          try {
            map.push([new URL(rawUrl, sheet.href ?? location.href).href, family]);
          } catch {
            // malformed url() token; nothing to attribute
          }
        }
      }
    }
    return map;
  });
  return new Map(entries);
}

test.describe('only Sour Gummy and Source Sans 3 are requested (T081)', () => {
  for (const route of ROUTES) {
    test(`requests no other font family on ${route}`, async ({ page }) => {
      const fontRequestUrls: string[] = [];
      page.on('request', (request) => {
        const url = request.url();
        if (/\.(woff2?|ttf|otf)(\?|$)/i.test(url)) fontRequestUrls.push(url);
      });

      await gotoRoute(page, route);
      await page.waitForLoadState('networkidle');

      // Belt-and-suspenders: the app self-hosts via next/font, so this should already
      // be zero. Figtree and Space Grotesk both arrived this way in the source design
      // and were never used — this is the assertion that keeps them from creeping back.
      const externalGoogleFontRequests = fontRequestUrls.filter((url) =>
        /fonts\.(googleapis|gstatic)\.com/i.test(url),
      );
      expect(externalGoogleFontRequests).toEqual([]);

      const familyByUrl = await getFontFamilyByUrl(page);
      for (const url of fontRequestUrls) {
        const family = familyByUrl.get(url);
        expect(
          family,
          `no @font-face rule on ${route} accounts for requested font ${url}`,
        ).toBeDefined();
        expect(
          ALLOWED_FONT_FAMILIES.has(family as string),
          `unexpected font family "${family}" requested via ${url} on ${route}`,
        ).toBe(true);
      }
    });
  }
});

test('participant question text on /answer is not set in Sour Gummy (T081b)', async ({ page }) => {
  await mockReadyQuestion(page);
  await page.goto('/answer');

  const question = page.getByRole('heading', { level: 1 });
  await expect(question).toBeVisible();

  // app/layout.tsx loads Sour Gummy with the latin subset alone, while --font-sans
  // carries latin-ext/cyrillic/greek/vietnamese. A translated contribution set in the
  // display face would render as tofu, so participant content resolves through
  // --font-sans instead.
  const fontFamily = await question.evaluate((el) => getComputedStyle(el).fontFamily);
  expect(fontFamily).toMatch(/Source Sans 3/);
  expect(fontFamily).not.toMatch(/Sour Gummy/);
});

test.describe('no uppercase eyebrow label renders anywhere (T082)', () => {
  // The design's eyebrow ("Someone asked", "Recording", "Your question") was a small
  // uppercase label with extra letter-spacing above a heading. It was removed
  // product-wide (contracts/design.md, Header section) — this asserts no element
  // reintroduces that exact shape, without pinning it to a component that no longer
  // exists.
  const EYEBROW_MAX_FONT_SIZE_PX = 16;

  for (const route of ROUTES) {
    test(`no eyebrow-styled element on ${route}`, async ({ page }) => {
      await gotoRoute(page, route);

      const offenders = await page.evaluate((maxFontSize) => {
        const found: string[] = [];
        for (const el of Array.from(document.querySelectorAll('body *'))) {
          const style = getComputedStyle(el);
          if (style.textTransform !== 'uppercase') continue;

          const letterSpacing = Number.parseFloat(style.letterSpacing);
          const hasTracking = Number.isFinite(letterSpacing) && letterSpacing > 0;
          const fontSize = Number.parseFloat(style.fontSize);

          if (hasTracking && fontSize <= maxFontSize) {
            found.push(`<${el.tagName.toLowerCase()}> "${el.textContent?.trim().slice(0, 40)}"`);
          }
        }
        return found;
      }, EYEBROW_MAX_FONT_SIZE_PX);

      expect(offenders, `eyebrow-styled element(s) found on ${route}`).toEqual([]);
    });
  }
});
