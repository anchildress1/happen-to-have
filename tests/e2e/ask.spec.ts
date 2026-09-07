import { Pool } from '@neondatabase/serverless';
import { expect, type Page, type Route, test } from '@playwright/test';
import { unsealData } from 'iron-session';
import { copy } from '../../src/copy.js';

/**
 * The 004 ask flow, end to end in a browser (US1 – US3).
 *
 * `POST /api/ask` is stubbed with `page.route`. Every outcome here is a UI contract on the
 * JSON that endpoint returns; the endpoint's own rules — the ask guard, consumption,
 * idempotency, closure — are proven at the query layer in
 * `tests/integration/question-publish.test.ts` and `closure.test.ts`, which are the only
 * places that can construct the state those rules exist for.
 *
 * **Reached by navigating, never by a hand-built URL.** 003 shipped eleven green e2e tests
 * over a recorder no real participant could reach, because the suite built its own entry
 * point with a query parameter the app never emits. Every test below arrives at `/ask` the
 * way a participant does: answer a question, then follow the link on the published screen.
 *
 * ⚠️ The microphone is faked by Chromium's `--use-fake-device-for-media-stream`. This proves
 * the flow, not that a real microphone works.
 */

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
  permissions: ['microphone'],
});

const ASK_URL = '**/api/ask';
const ANSWER_URL = '**/api/answer';
const SESSION_COOKIE = 'hth_session';

async function stubAsk(page: Page, body: unknown): Promise<void> {
  await page.route(ASK_URL, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

/**
 * Reads the participant id out of the session cookie the app just set.
 *
 * The cookie is sealed, so this unseals it with the same secret the app boots with rather
 * than guessing. Taking "the newest participant row" instead would race: five viewport
 * projects run in parallel and each mints its own.
 */
async function participantIdOf(page: Page): Promise<string> {
  // 001 mints identity on INTERACTION, not on page load: `/answer` renders, then the client
  // calls the selection endpoint, and that response is what sets the cookie. Reading cookies
  // straight after `goto` finds none — waiting for the question to appear is waiting for the
  // request that creates the participant.
  await expect(page.getByRole('link', { name: copy.action.canAnswer })).toBeVisible();
  const cookie = (await page.context().cookies()).find((c) => c.name === SESSION_COOKIE);
  expect(cookie, 'the app should have minted a session at /answer').toBeTruthy();
  const data = await unsealData<{ participantId: string }>(cookie?.value ?? '', {
    password: process.env.SESSION_SECRET ?? '',
  });
  return data.participantId;
}

/**
 * Grants the ask in the DATABASE, because there is no other way to grant one.
 *
 * **This is the shape of the feature showing through the test.** Stubbing `/api/answer` to
 * return `askGranted: true` does not work and must not: `/ask` re-reads
 * `participants.can_ask` on the server (FR-004), so a client that merely believes it earned
 * an ask is redirected straight back to `/answer`. The first version of this suite stubbed
 * the response and every test failed at the unlocked screen — which is Principle II working,
 * not a broken test.
 *
 * So the test does what quickstart tells a developer to do by hand: flip the flag in the
 * database. It never touches the application, and no dev-only bypass route exists to help it.
 */
let pool: Pool | undefined;

function db(): Pool {
  // One pool for the file, not one per call. A pool per `grantAsk` churned a Neon connection
  // for every test in every viewport project, which is avoidable load and an avoidable source
  // of flakiness.
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

test.afterAll(async () => {
  await pool?.end();
  pool = undefined;
});

async function grantAsk(participantId: string): Promise<void> {
  await db().query('UPDATE participants SET can_ask = true WHERE id = $1', [participantId]);
}

/** Mints a session at `/answer`, grants its ask, and lands on the unlocked ask screen. */
async function openAskFlow(page: Page): Promise<string> {
  await page.goto('/answer');
  const participantId = await participantIdOf(page);
  await grantAsk(participantId);
  await page.goto('/ask');
  await expect(page.getByRole('heading', { name: copy.ask.unlocked.heading })).toBeVisible();
  return participantId;
}

/** From the unlocked state into a recorded, submittable question. */
async function recordQuestion(page: Page, ms = 400): Promise<void> {
  await page.getByRole('button', { name: copy.ask.unlocked.action }).click();
  await page.getByRole('button', { name: copy.review.recording.start }).click();
  await expect(page.getByRole('button', { name: copy.review.recording.stop })).toBeVisible();
  await page.waitForTimeout(ms);
  await page.getByRole('button', { name: copy.review.recording.stop }).click();
  await expect(page.getByRole('button', { name: copy.ask.recording.submit })).toBeVisible();
}

test.describe('User Story 2 — the gate on /ask (FR-003)', () => {
  test('redirects a participant holding no ask to the answer flow', async ({ page }) => {
    // A fresh session has never answered anything, so it holds no ask. This is the case that
    // 404'd before 004 existed.
    await page.goto('/ask');

    await expect(page).toHaveURL(/\/answer$/);
  });
});

test.describe('User Story 2 — the server refuses what the interface never offered', () => {
  /**
   * These two hit `/api/ask` directly rather than driving the UI, which is the point: FR-002
   * and FR-006a are about a request that bypasses the interface entirely, and a test that
   * clicks buttons can only prove the interface hides a control.
   */
  test('refuses a submission carrying no session, and mints no participant (FR-002a)', async ({
    request,
  }) => {
    const body = new FormData();
    body.set('audio', new Blob([new Uint8Array(2048)], { type: 'audio/webm' }));
    body.set('submissionId', crypto.randomUUID());
    body.set('durationSeconds', '12');

    // A fresh APIRequestContext carries no cookies at all.
    const response = await request.post('/api/ask', { multipart: body as never });

    expect(response.status()).toBe(401);
    // The body matters: the client calls `response.json()` unconditionally, so a bodiless
    // 401 throws on parse. 003 shipped that bug.
    expect(await response.json()).toEqual({ status: 'failed', cause: 'no-session' });
  });

  test('refuses a declared duration over the ceiling before any review runs (FR-006a, SC-007)', async ({
    page,
  }) => {
    await openAskFlow(page);

    // Submitted from the page so the session cookie travels, but built by hand so the
    // recorder's ceiling — a product behaviour, not a security boundary — is skipped
    // entirely, which is the only way to ask whether the server enforces it.
    const result = await page.evaluate(async () => {
      const body = new FormData();
      body.set('audio', new Blob([new Uint8Array(2048)], { type: 'audio/webm' }));
      body.set('submissionId', crypto.randomUUID());
      body.set('durationSeconds', '61');
      const response = await fetch('/api/ask', { method: 'POST', body });
      return { status: response.status, text: await response.text() };
    });

    expect(result.status).toBe(200);
    expect(JSON.parse(result.text)).toEqual({
      status: 'withheld',
      reason: 'content',
      contentReason: 'unpublishable',
    });

    // And the ask survived, so `/ask` still opens rather than redirecting.
    await page.goto('/ask');
    await expect(page.getByRole('heading', { name: copy.ask.unlocked.heading })).toBeVisible();
  });
});

test.describe('User Story 1 — spend the ask', () => {
  test('the published-answer screen leads somewhere (plan divergence D-1)', async ({ page }) => {
    // The one test that follows 003's `Ask your question` link rather than navigating to
    // `/ask`. That link shipped pointing at a 404, and this is what proves it lands.
    await page.route(ANSWER_URL, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'published', askGranted: true }),
      }),
    );

    await page.goto('/answer');
    // Granted for real, because the destination re-reads it. The stub above only gets the
    // participant to the screen that carries the link.
    await grantAsk(await participantIdOf(page));

    await page.getByRole('link', { name: copy.action.canAnswer }).click();
    await page.waitForURL(/\/answer\/record\?questionId=/);
    await page.getByRole('button', { name: copy.review.recording.start }).click();
    await expect(page.getByRole('button', { name: copy.review.recording.stop })).toBeVisible();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: copy.review.recording.stop }).click();
    const submit = page.getByRole('button', { name: copy.review.recording.submit });
    await expect(submit).toBeVisible();
    await submit.click();

    await page.getByRole('link', { name: copy.review.published.action }).click();
    await page.waitForURL(/\/ask$/);

    await expect(page.getByRole('heading', { name: copy.ask.unlocked.heading })).toBeVisible();
    await expect(page.getByText(copy.ask.unlocked.helper)).toBeVisible();
  });

  test('declining keeps the ask and returns to answering (FR-004a)', async ({ page }) => {
    await openAskFlow(page);

    await page.getByRole('link', { name: copy.ask.unlocked.ghost }).click();
    await expect(page).toHaveURL(/\/answer$/);

    // The ask is held, not spent — so /ask still opens rather than redirecting.
    await page.goto('/ask');
    await expect(page.getByRole('heading', { name: copy.ask.unlocked.heading })).toBeVisible();
  });

  test('the recorder shows the prompt and the consumption footnote', async ({ page }) => {
    await openAskFlow(page);
    await page.getByRole('button', { name: copy.ask.unlocked.action }).click();

    await expect(page.getByRole('heading', { name: copy.ask.recording.heading })).toBeVisible();
    await expect(page.getByText(copy.ask.recording.footnote)).toBeVisible();
  });

  test('a published question renders the confirmation and routes back to answering (FR-015a, SC-011)', async ({
    page,
  }) => {
    await stubAsk(page, { status: 'published' });
    await openAskFlow(page);
    await recordQuestion(page);

    await page.getByRole('button', { name: copy.ask.recording.submit }).click();

    // The screen the design contract does not cover, so this assertion is its only guard.
    await expect(
      page.getByRole('heading', { name: copy.review.publishedQuestion.heading }),
    ).toBeVisible();
    await expect(page.getByText(copy.review.publishedQuestion.helper)).toBeVisible();

    // The loop is the product: you spent it, go earn another.
    await page.getByRole('link', { name: copy.action.findQuestion }).click();
    await expect(page).toHaveURL(/\/answer$/);
  });

  test('publication is never silent — no outcome resolves to a bare redirect (SC-011)', async ({
    page,
  }) => {
    await stubAsk(page, { status: 'published' });
    await openAskFlow(page);
    await recordQuestion(page);
    await page.getByRole('button', { name: copy.ask.recording.submit }).click();

    await expect(page).toHaveURL(/\/ask$/);
    await expect(
      page.getByRole('heading', { name: copy.review.publishedQuestion.heading }),
    ).toBeVisible();
  });
});

test.describe('User Story 3 — the ask survives a bad outcome', () => {
  test('a withheld question offers a fresh recording at /ask (FR-021)', async ({ page }) => {
    await stubAsk(page, { status: 'withheld', reason: 'content', contentReason: 'silence' });
    await openAskFlow(page);
    await recordQuestion(page);
    await page.getByRole('button', { name: copy.ask.recording.submit }).click();

    await expect(
      page.getByRole('heading', { name: copy.review.withheld.content.silence }),
    ).toBeVisible();

    // The retry targets the route the participant is already on, and a Next <Link> to the
    // current route does not remount — 003 shipped exactly that and the Withheld page sat
    // there. Asserting the recorder actually comes back is what catches it.
    await page.getByRole('link', { name: copy.review.withheld.actionQuestion }).click();
    await expect(page.getByRole('heading', { name: copy.ask.unlocked.heading })).toBeVisible();
  });

  test('the Back link leaves the refusal screen (Codex, #34)', async ({ page }) => {
    await stubAsk(page, { status: 'withheld', reason: 'content', contentReason: 'silence' });
    await openAskFlow(page);
    await recordQuestion(page);
    await page.getByRole('button', { name: copy.ask.recording.submit }).click();
    await expect(
      page.getByRole('heading', { name: copy.review.withheld.content.silence }),
    ).toBeVisible();

    // Every ghost on the question flow points at `/ask` — the route already loaded — so a
    // Next <Link> there does not remount and the outcome state survives. The primary retry
    // carried a handler for that; the ghost did not, and clicking it left the participant on
    // the refusal screen. Shipped in #34, caught in review.
    await page.getByRole('link', { name: copy.review.withheld.ghostQuestion }).click();
    await expect(page.getByRole('heading', { name: copy.ask.unlocked.heading })).toBeVisible();
  });

  test('crisis keeps the resources and the retry side by side', async ({ page }) => {
    await stubAsk(page, { status: 'withheld', reason: 'crisis' });
    await openAskFlow(page);
    await recordQuestion(page);
    await page.getByRole('button', { name: copy.ask.recording.submit }).click();

    await expect(page.getByRole('heading', { name: copy.review.crisis.heading })).toBeVisible();
    // Nobody should have to dismiss an offer of help to reach the control that lets them
    // try again. Both visible at once, or this fails.
    await expect(page.getByText(copy.review.crisis.resources[0].name)).toBeVisible();
    await expect(
      page.getByRole('link', { name: copy.review.withheld.actionQuestion }),
    ).toBeVisible();
  });

  test('a processing failure names the question, not the answer', async ({ page }) => {
    await stubAsk(page, { status: 'failed', cause: 'exhausted' });
    await openAskFlow(page);
    await recordQuestion(page);
    await page.getByRole('button', { name: copy.ask.recording.submit }).click();

    await expect(
      page.getByRole('heading', { name: copy.review.failed.headingQuestion }),
    ).toBeVisible();
  });

  test('a spent ask does not offer a retry it cannot honour (research D6)', async ({ page }) => {
    await stubAsk(page, { status: 'spent' });
    await openAskFlow(page);
    await recordQuestion(page);
    await page.getByRole('button', { name: copy.ask.recording.submit }).click();

    await expect(page.getByRole('heading', { name: copy.review.spent.heading })).toBeVisible();
    // The processing-failure page would say "You can record again", which the server will
    // refuse. This state must not borrow it.
    await expect(page.getByText(copy.review.failed.helper)).toHaveCount(0);
    await expect(page.getByRole('link', { name: copy.review.withheld.actionQuestion })).toHaveCount(
      0,
    );
  });
});
