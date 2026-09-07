import { Pool } from '@neondatabase/serverless';
import { expect, type Locator, type Page, type Route, test } from '@playwright/test';
import { unsealData } from 'iron-session';
import { copy } from '../../src/copy.js';

/**
 * 005's `/yours`, end to end in a browser (T070 – T078).
 *
 * `POST /api/playback/answer/[id]` is stubbed with `page.route`. Every playback state here is a
 * UI contract on that endpoint's status code — the endpoint's own rules (authorization, the
 * cache, produce-once) are proven at the query and unit layers, which are the only places that
 * can construct the state those rules exist for. Nothing in this file spends a TTS call.
 *
 * **Reached by navigating, never by a hand-built URL.** History is seeded straight into the
 * database, because there is no other way to have three strangers answer a question — but the
 * screen is always opened by clicking the app's own `Yours` link, and every id this file touches
 * is one the app minted (the session cookie) or one the database returned (the seeded rows).
 * Nothing constructs a URL to a resource.
 */

// The four inbound-link tests (T078) walk the real recorder to reach the outcome screens that
// carry those links, and the recorder needs a microphone. Scoped by `test.use` at file level the
// way ask.spec.ts does; the fake device is inert for every other test here.
test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
  permissions: ['microphone'],
});

const SESSION_COOKIE = 'hth_session';
const PLAYBACK_URL = '**/api/playback/**';
const ANSWER_URL = '**/api/answer';
const ASK_URL = '**/api/ask';

/**
 * Reads the participant id out of the session cookie the app just set.
 *
 * The cookie is sealed, so this unseals it with the same secret the app boots with rather than
 * guessing, and rather than taking "the newest participant row" — five viewport projects run in
 * parallel and each mints its own.
 *
 * 001 mints identity on INTERACTION, not on page load: `/answer` renders, its client calls the
 * selection endpoint, and that response sets the cookie. Waiting for the question to appear is
 * waiting for the request that creates the participant.
 */
async function participantIdOf(page: Page): Promise<string> {
  await expect(page.getByRole('link', { name: copy.action.canAnswer })).toBeVisible();
  const cookie = (await page.context().cookies()).find((c) => c.name === SESSION_COOKIE);
  expect(cookie, 'the app should have minted a session at /answer').toBeTruthy();
  const data = await unsealData<{ participantId: string }>(cookie?.value ?? '', {
    password: process.env.SESSION_SECRET ?? '',
  });
  return data.participantId;
}

/**
 * One pool per call, deliberately.
 *
 * `fullyParallel` is on, so each test can land in its own worker and a hoisted module-scope pool
 * is never actually shared — its connection would just sit idle until every test in that worker
 * finished. Opening and closing around one unit of work holds fewer connections. Same reasoning
 * as `grantAsk` in ask.spec.ts.
 */
async function withPool<T>(run: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    return await run(pool);
  } finally {
    await pool.end();
  }
}

/** Grants the ask in the database, because `/ask` re-reads `can_ask` and there is no other way. */
async function grantAsk(participantId: string): Promise<void> {
  await withPool((pool) =>
    pool.query('UPDATE participants SET can_ask = true WHERE id = $1', [participantId]),
  );
}

interface SeededHistory {
  /** The question this participant published. */
  questionText: string;
  /** The responses that came back to it, one per distinct responder. */
  responseTexts: string[];
  /** An answer this participant published, and the question it addressed. */
  answerText: string;
  answeredQuestionText: string;
}

/**
 * Seeds a full history against the participant the browser session already holds.
 *
 * Every string carries a per-call nonce. Five viewport projects run in parallel against one
 * branch, so a fixed string would be present on somebody else's screen too and an assertion on
 * it would pass for the wrong reason.
 *
 * `UNIQUE (participant_id, question_id)` is why the responders are minted here rather than
 * reused: N responses to one question require N distinct participants, and that constraint is
 * what guarantees it.
 */
async function seedHistory(participantId: string, responseCount = 3): Promise<SeededHistory> {
  const nonce = crypto.randomUUID().slice(0, 8);
  const questionText = `How do you tell somebody no without burning the bridge? (${nonce})`;
  const responseTexts = Array.from(
    { length: responseCount },
    (_, i) => `Say it once and do not explain twice — number ${i + 1} (${nonce})`,
  );
  const answeredQuestionText = `What do you do with a garden that got away from you? (${nonce})`;
  const answerText = `Clear one bed and let the rest wait until next weekend (${nonce})`;

  await withPool(async (pool) => {
    const question = await pool.query<{ id: string }>(
      `INSERT INTO questions (participant_id, display_text, duration_seconds, submission_id)
       VALUES ($1, $2, 22, gen_random_uuid()) RETURNING id`,
      [participantId, questionText],
    );

    const responders = await pool.query<{ id: string }>(
      'INSERT INTO participants (can_ask) SELECT false FROM generate_series(1, $1) RETURNING id',
      [responseCount],
    );

    await pool.query(
      `INSERT INTO answers (question_id, participant_id, display_text, duration_seconds,
                            submission_id)
       SELECT $1, z.responder, z.text, 11, gen_random_uuid()
         FROM unnest($2::uuid[], $3::text[]) AS z(responder, text)`,
      [question.rows[0].id, responders.rows.map((row) => row.id), responseTexts],
    );

    // The other half of the screen: an answer of theirs to somebody else's question. A distinct
    // asker, because a participant may not answer their own question.
    const asker = await pool.query<{ id: string }>(
      'INSERT INTO participants (can_ask) VALUES (false) RETURNING id',
    );
    const answered = await pool.query<{ id: string }>(
      `INSERT INTO questions (participant_id, display_text, duration_seconds, submission_id)
       VALUES ($1, $2, 18, gen_random_uuid()) RETURNING id`,
      [asker.rows[0].id, answeredQuestionText],
    );
    await pool.query(
      `INSERT INTO answers (question_id, participant_id, display_text, duration_seconds,
                            submission_id)
       VALUES ($1, $2, $3, 11, gen_random_uuid())`,
      [answered.rows[0].id, participantId, answerText],
    );
  });

  return { questionText, responseTexts, answerText, answeredQuestionText };
}

/** A published question with nothing back yet — the third empty state's only trigger. */
async function seedQuestionWithNoResponses(participantId: string): Promise<string> {
  const questionText = `Is it worth repointing a chimney nobody uses? (${crypto.randomUUID().slice(0, 8)})`;
  await withPool((pool) =>
    pool.query(
      `INSERT INTO questions (participant_id, display_text, duration_seconds, submission_id)
       VALUES ($1, $2, 17, gen_random_uuid())`,
      [participantId, questionText],
    ),
  );
  return questionText;
}

/**
 * Mints a session at `/answer` and opens `/yours` the way a participant does — the header link,
 * never `page.goto('/yours')`. Returns the participant id so the caller can seed against it.
 */
async function openYours(page: Page): Promise<string> {
  await page.goto('/answer');
  const participantId = await participantIdOf(page);
  await page.getByRole('link', { name: copy.nav.yours, exact: true }).click();
  await page.waitForURL(/\/yours$/);
  return participantId;
}

/** Seeds first, then opens — the render is `force-dynamic`, so the rows are there on arrival. */
async function openYoursWithHistory(page: Page, responseCount = 3): Promise<SeededHistory> {
  await page.goto('/answer');
  const seeded = await seedHistory(await participantIdOf(page), responseCount);
  await page.getByRole('link', { name: copy.nav.yours, exact: true }).click();
  await page.waitForURL(/\/yours$/);
  await expect(page.getByRole('heading', { name: copy.yours.questions.heading })).toBeVisible();
  return seeded;
}

/**
 * One `<li>` per response.
 *
 * `ResponseList` renders no role or test id of its own, so this locates by CSS-module class —
 * the same technique `responsive.spec.ts` uses for Screen's content column. The emitted name is
 * `page-module__<hash>__response`, and the leading `__` is what keeps this off `.responses`,
 * which is the `<ul>` rather than an `<li>`.
 */
function responseItems(page: Page): Locator {
  return page.locator('li[class*="__response"]');
}

test.describe('T070 — a seeded history reaches the screen, and only its owner', () => {
  test('the history belongs to the session that published it (FR-002)', async ({
    browser,
    page,
  }) => {
    const seeded = await openYoursWithHistory(page);

    // Both halves of the seed are on the screen, reached from the app's own link. That is what
    // makes every assertion in the rest of this file meaningful.
    await expect(page.getByText(seeded.questionText)).toBeVisible();
    await expect(page.getByText(seeded.answerText)).toBeVisible();

    // A second browser context is a second participant. FR-002 scopes `Yours` to the requesting
    // participant, and the only way to observe that is to look with somebody else's session.
    const other = await browser.newContext();
    try {
      const otherPage = await other.newPage();
      await otherPage.goto('/answer');
      await participantIdOf(otherPage);
      await otherPage.getByRole('link', { name: copy.nav.yours, exact: true }).click();
      await otherPage.waitForURL(/\/yours$/);

      await expect(
        otherPage.getByRole('heading', { name: copy.yours.answers.heading }),
      ).toBeVisible();
      await expect(otherPage.getByText(seeded.questionText)).toHaveCount(0);
      await expect(otherPage.getByText(seeded.answerText)).toHaveCount(0);
      await expect(otherPage.getByText(seeded.responseTexts[0])).toHaveCount(0);
    } finally {
      await other.close();
    }
  });
});

test.describe('T071 — both sections render their content (US1, US2)', () => {
  test('answers carry their original question and the Published label; questions carry every response', async ({
    page,
  }) => {
    const seeded = await openYoursWithHistory(page);

    // FR-001. Exactly two sections, both present, neither behind a tab.
    await expect(page.getByRole('heading', { name: copy.yours.answers.heading })).toBeVisible();
    await expect(page.getByRole('heading', { name: copy.yours.questions.heading })).toBeVisible();

    // FR-005, FR-006, FR-007.
    await expect(page.getByText(seeded.answerText)).toBeVisible();
    await expect(page.getByText(seeded.answeredQuestionText)).toBeVisible();
    await expect(page.getByText(copy.yours.answers.published)).toBeVisible();

    // FR-011, FR-012, FR-013.
    await expect(page.getByText(seeded.questionText)).toBeVisible();
    await expect(
      page.getByText(copy.yours.questions.responseCount(seeded.responseTexts.length)),
    ).toBeVisible();
    for (const text of seeded.responseTexts) {
      await expect(page.getByText(text)).toBeVisible();
    }

    // FR-014. One `Listen` per response, never one per question.
    await expect(page.getByRole('button', { name: copy.yours.playback.listen })).toHaveCount(
      seeded.responseTexts.length,
    );
  });
});

test.describe('T072 — all three empty states render (SC-009)', () => {
  test('a session with no history gets both section empty states, not a blank or errored screen', async ({
    page,
  }) => {
    await openYours(page);

    // The sections do not disappear; their headings render above their own empty states.
    await expect(page.getByRole('heading', { name: copy.yours.answers.heading })).toBeVisible();
    await expect(page.getByRole('heading', { name: copy.yours.questions.heading })).toBeVisible();
    await expect(page.getByText(copy.yours.answers.empty.heading)).toBeVisible();
    await expect(page.getByText(copy.yours.questions.empty.heading)).toBeVisible();

    // "Zero blank or errored screens" is the measurable half of SC-009: the shared failure page
    // must not be what a participant with nothing published sees.
    await expect(page.getByText(copy.failure.heading)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: copy.nav.yours, exact: true })).toBeVisible();
  });

  test('a published question with nothing back gets the per-question empty state (FR-016)', async ({
    page,
  }) => {
    await page.goto('/answer');
    const questionText = await seedQuestionWithNoResponses(await participantIdOf(page));
    await page.getByRole('link', { name: copy.nav.yours, exact: true }).click();
    await page.waitForURL(/\/yours$/);

    await expect(page.getByText(questionText)).toBeVisible();
    await expect(page.getByText(copy.yours.questions.noResponses)).toBeVisible();

    // The question section is populated, so its section empty state must NOT be the thing that
    // rendered — state 3 replaces the response list, not the section.
    await expect(page.getByText(copy.yours.questions.empty.heading)).toHaveCount(0);
    // The answers section is still empty, and unaffected by its sibling.
    await expect(page.getByText(copy.yours.answers.empty.heading)).toBeVisible();

    // FR-012's count is deliberately absent at zero: `0 responses` is a tally, and a tally reads
    // as a score on a screen whose job is to carry none.
    await expect(page.getByText(copy.yours.questions.responseCount(0))).toHaveCount(0);
    await expect(page.getByRole('button', { name: copy.yours.playback.listen })).toHaveCount(0);
  });
});

test.describe('T073 — the loading state is scoped to one response (FR-032)', () => {
  test('Listen on the first response leaves every other response untouched', async ({ page }) => {
    let release: (() => void) | undefined;
    await page.route(PLAYBACK_URL, async (route: Route) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'production-failed' }),
      });
    });

    const seeded = await openYoursWithHistory(page);
    const items = responseItems(page);
    await expect(items).toHaveCount(seeded.responseTexts.length);

    // The first response as the app ordered it, read back from the DOM. The seed inserts three
    // rows in one statement, so they share a `created_at` and the tie breaks on a random uuid —
    // a test that assumed its own insert order would be asserting on a coin flip.
    const firstText = (await items.first().innerText()).trim();
    expect(firstText).not.toBe('');

    await items.first().getByRole('button', { name: copy.yours.playback.listen }).click();

    await expect(items.first().getByText(copy.yours.playback.loading)).toBeVisible();

    // The whole point of the test. There is no page-level spinner, so exactly one response is
    // loading and the other two are still idle, still readable, still pressable.
    await expect(page.getByText(copy.yours.playback.loading)).toHaveCount(1);
    for (let i = 1; i < seeded.responseTexts.length; i++) {
      const sibling = items.nth(i);
      await expect(sibling.getByText(copy.yours.playback.loading)).toHaveCount(0);
      await expect(sibling.getByText(copy.yours.playback.failed)).toHaveCount(0);
      await expect(sibling.getByRole('button', { name: copy.yours.playback.listen })).toBeEnabled();
    }

    // FR-030. The text of the response being produced never waits on the audio either.
    for (const text of seeded.responseTexts) {
      await expect(page.getByText(text)).toBeVisible();
    }

    release?.();
    await expect(page.getByText(copy.yours.playback.loading)).toHaveCount(0);
  });
});

test.describe('T074 — a failed production keeps the text and offers a retry (FR-033)', () => {
  test('502 leaves the response readable and the audio retryable', async ({ page }) => {
    await page.route(PLAYBACK_URL, (route: Route) =>
      route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'production-failed' }),
      }),
    );

    const seeded = await openYoursWithHistory(page);
    const items = responseItems(page);
    const target = items.first();
    const targetText = (await target.innerText()).trim();

    await target.getByRole('button', { name: copy.yours.playback.listen }).click();

    await expect(target.getByText(copy.yours.playback.failed)).toBeVisible();

    // FR-033's first half: the failure is about the audio, and the words are still on screen.
    expect(targetText).not.toBe('');
    const matching = seeded.responseTexts.filter((text) => targetText.includes(text));
    expect(matching, 'the failed response should still render its own text').toHaveLength(1);
    await expect(target.getByText(matching[0])).toBeVisible();

    // FR-033's second half: a retry, offered for the audio alone. The control that was `Listen`
    // now says so.
    await expect(target.getByRole('button', { name: copy.failure.action })).toBeVisible();
    await expect(target.getByRole('button', { name: copy.failure.action })).toBeEnabled();

    // Scoped, like every other playback state — one failure does not fail the page.
    await expect(page.getByText(copy.yours.playback.failed)).toHaveCount(1);
    for (const text of seeded.responseTexts) {
      await expect(page.getByText(text)).toBeVisible();
    }
  });
});

test.describe('T075 — an unavailable producer degrades without a retry (FR-034, SC-011)', () => {
  test('503 leaves the response readable and offers no control that cannot succeed', async ({
    page,
  }) => {
    await page.route(PLAYBACK_URL, (route: Route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'unavailable' }),
      }),
    );

    const seeded = await openYoursWithHistory(page);
    const items = responseItems(page);
    const target = items.first();

    await target.getByRole('button', { name: copy.yours.playback.listen }).click();

    await expect(target.getByText(copy.yours.playback.unavailable)).toBeVisible();

    // FR-034. A retry that can never succeed is worse than no retry — so the control is
    // disabled, and it is emphatically NOT relabelled `Try again` the way the 502 path is.
    //
    // It stays mounted rather than being replaced by the message, and that is an accessibility
    // requirement rather than a styling choice: unmounting the button a keyboard user has just
    // activated drops focus to <body> and loses their place in a list that can be dozens of tab
    // stops long. The degraded state is carried by `disabled` and by the live region instead.
    await expect(target.getByRole('button')).toHaveCount(1);
    await expect(target.getByRole('button')).toBeDisabled();
    await expect(target.getByText(copy.failure.action)).toHaveCount(0);
    await expect(target.getByText(copy.yours.playback.failed)).toHaveCount(0);

    // SC-011. Every word of every response still renders with playback gone.
    for (const text of seeded.responseTexts) {
      await expect(page.getByText(text)).toBeVisible();
    }
    await expect(page.getByText(seeded.answerText)).toBeVisible();

    // And it degrades only where it was pressed — the siblings keep their working control.
    await expect(page.getByText(copy.yours.playback.unavailable)).toHaveCount(1);
    await expect(page.getByRole('button', { name: copy.yours.playback.listen })).toHaveCount(
      seeded.responseTexts.length - 1,
    );
  });
});

test.describe('T076 — ten responses on one question at phone width (SC-010)', () => {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires this literal shape to recognize a fixtures parameter.
  test.beforeEach(({}, testInfo) => {
    // The spec's edge case is phone width specifically, and the assertion is a single-width
    // geometry fact. Running it at all five viewports would multiply a ten-row seed by five
    // without exercising anything new.
    testInfo.skip(testInfo.project.name !== 'mobile-402');
  });

  test('renders all ten in full and never scrolls sideways', async ({ page }) => {
    const seeded = await openYoursWithHistory(page, 10);

    await expect(responseItems(page)).toHaveCount(10);
    // No truncation, no clipping, no fixed-height scroller — every one of the ten is there.
    for (const text of seeded.responseTexts) {
      await expect(page.getByText(text)).toBeVisible();
    }
    await expect(page.getByText(copy.yours.questions.responseCount(10))).toBeVisible();

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    // No tolerance, matching responsive.spec.ts: the "?" watermark is absolutely positioned off
    // the right edge on purpose and relies on Screen's `overflow: hidden` to clip it, and
    // `scrollWidth <= clientWidth` is what proves the clip holds rather than just being declared.
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });
});

/**
 * Every word that would name a control this screen must not have. Applied to what a control
 * *says*, never to what a participant wrote: a response is free to contain "I'd rate that a
 * ten", and a sweep over body text would fail on somebody's sentence rather than on a feature.
 */
const FORBIDDEN_CONTROL_WORD =
  /\b(vote|votes|upvote|downvote|like|likes|liked|dislike|react|reaction|reactions|rate|rating|ratings|star|stars|score|scores|rank|ranked|ranking|best|helpful|reply|replies|comment|comments|favorite|favourite|thumb|thumbs|applaud|endorse|award)\b/i;

/** Roles that only a ranking, rating, or selection control would carry. */
const FORBIDDEN_ROLES = [
  'radio',
  'checkbox',
  'switch',
  'slider',
  'spinbutton',
  'menuitemradio',
  'menuitemcheckbox',
  'listbox',
  'combobox',
  'option',
];

test.describe('T077 — no ranking or feedback control exists anywhere (SC-008)', () => {
  test('the rendered tree holds Listen, the header link, and nothing else interactive', async ({
    page,
  }) => {
    const seeded = await openYoursWithHistory(page);

    const inventory = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll(
          'button, a, input, select, textarea, form, [role], [tabindex], [contenteditable]',
        ),
      ).map((element) => ({
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute('role') ?? '',
        label: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim(),
      })),
    );

    // Nothing that collects input exists on this screen. A vote, a rating, a comment box and a
    // best-answer picker are all one of these five tags or one of the roles below.
    expect(
      inventory.filter((entry) => ['input', 'select', 'textarea', 'form'].includes(entry.tag)),
    ).toEqual([]);
    expect(inventory.filter((entry) => FORBIDDEN_ROLES.includes(entry.role))).toEqual([]);
    expect(inventory.filter((entry) => FORBIDDEN_CONTROL_WORD.test(entry.label))).toEqual([]);

    // The positive form of the same claim, and the stronger one: an exhaustive inventory. Three
    // `Listen` buttons and the header's `Yours` link are the whole interactive surface, so any
    // control added here fails this whether or not its label was on the word list.
    const buttonLabels = inventory
      .filter((entry) => entry.tag === 'button')
      .map((entry) => entry.label);
    expect(buttonLabels).toEqual(seeded.responseTexts.map(() => copy.yours.playback.listen));

    const linkLabels = inventory.filter((entry) => entry.tag === 'a').map((entry) => entry.label);
    expect(linkLabels).toEqual([copy.nav.yours]);

    // Attributes a control announces itself through. `class` is excluded on purpose — CSS-module
    // names carry a random hash, and matching one would fail on a build rather than on a feature.
    const suspiciousAttributes = await page.evaluate((source) => {
      const pattern = new RegExp(source, 'i');
      const named = ['aria-label', 'aria-labelledby', 'title', 'alt', 'placeholder', 'name'];
      return Array.from(
        document.querySelectorAll('button, a, p, span, div, li, ul, section, h1, h2'),
      )
        .filter((element) =>
          named.some((attribute) => pattern.test(element.getAttribute(attribute) ?? '')),
        )
        .map((element) => element.outerHTML.slice(0, 120));
    }, FORBIDDEN_CONTROL_WORD.source);
    expect(suspiciousAttributes).toEqual([]);
  });
});

/** Records at whichever recorder is already on screen and submits it. */
async function recordAndSubmit(page: Page, submitLabel: string): Promise<void> {
  await page.getByRole('button', { name: copy.review.recording.start }).click();
  await expect(page.getByRole('button', { name: copy.review.recording.stop })).toBeVisible();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: copy.review.recording.stop }).click();
  const submit = page.getByRole('button', { name: submitLabel });
  await expect(submit).toBeVisible();
  await submit.click();
}

/** Selection → recorder, the way a participant reaches it. */
async function reachAnswerRecorder(page: Page): Promise<void> {
  await page.goto('/answer');
  await page.getByRole('link', { name: copy.action.canAnswer }).click();
  await page.waitForURL(/\/answer\/record\?questionId=/);
}

/** A granted ask → the question recorder. */
async function reachQuestionRecorder(page: Page): Promise<void> {
  await page.goto('/answer');
  await grantAsk(await participantIdOf(page));
  await page.goto('/ask');
  await expect(page.getByRole('heading', { name: copy.ask.unlocked.heading })).toBeVisible();
  await page.getByRole('button', { name: copy.ask.unlocked.action }).click();
}

/** The real `/yours`, asserted by its two section headings rather than by the route alone. */
async function expectRealYours(page: Page): Promise<void> {
  await page.waitForURL(/\/yours$/);
  await expect(page.getByRole('heading', { name: copy.yours.answers.heading })).toBeVisible();
  await expect(page.getByRole('heading', { name: copy.yours.questions.heading })).toBeVisible();
  // 004 shipped four links into a placeholder. The string is the thing that has to be gone.
  await expect(page.getByText('Yours is on its way')).toHaveCount(0);
}

test.describe('T078 — every inbound link lands on a real screen (plan divergence D-1)', () => {
  test('the header link on every screen reaches the rendered history', async ({ page }) => {
    await openYours(page);
    await expectRealYours(page);
  });

  test('rate_limited offers Yours, and Yours is there', async ({ page }) => {
    await page.route(ANSWER_URL, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'rate_limited',
          retryAt: new Date('2026-09-07T16:30:00Z').toISOString(),
        }),
      }),
    );

    await reachAnswerRecorder(page);
    await recordAndSubmit(page, copy.review.recording.submit);

    await expect(page.getByRole('heading', { name: /You've sent a lot today/ })).toBeVisible();
    await page.getByRole('link', { name: copy.review.rateLimited.action }).click();
    await expectRealYours(page);
  });

  test('lost offers Yours, and Yours is there', async ({ page }) => {
    // The real cause: the response never arrives. `RecordAnswer` catches the rejected fetch and
    // renders `lost` — stubbing a `lost` body would be stubbing a status the server never sends.
    await page.route(ANSWER_URL, (route: Route) => route.abort());

    await reachAnswerRecorder(page);
    await recordAndSubmit(page, copy.review.recording.submit);

    await expect(page.getByText(copy.review.failed.lostResponse)).toBeVisible();
    await page.getByRole('link', { name: copy.review.rateLimited.action }).click();
    await expectRealYours(page);
  });

  test('a published question offers Yours, and Yours is there', async ({ page }) => {
    await page.route(ASK_URL, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'published' }),
      }),
    );

    await reachQuestionRecorder(page);
    await recordAndSubmit(page, copy.ask.recording.submit);

    await expect(
      page.getByRole('heading', { name: copy.review.publishedQuestion.heading }),
    ).toBeVisible();
    // Scoped to the outcome `<section>`: the header carries a link with this exact same word.
    await page
      .locator('section')
      .getByRole('link', { name: copy.review.publishedQuestion.ghost, exact: true })
      .click();
    await expectRealYours(page);
  });

  test('a spent ask offers Yours, and Yours is there', async ({ page }) => {
    await page.route(ASK_URL, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'spent' }),
      }),
    );

    await reachQuestionRecorder(page);
    await recordAndSubmit(page, copy.ask.recording.submit);

    await expect(page.getByRole('heading', { name: copy.review.spent.heading })).toBeVisible();
    await page
      .locator('section')
      .getByRole('link', { name: copy.review.spent.ghost, exact: true })
      .click();
    await expectRealYours(page);
  });
});
