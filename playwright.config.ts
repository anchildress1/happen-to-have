import { defineConfig, devices } from '@playwright/test';

// A dedicated port, not 3000. Developers here run several Next apps at once, and
// port 3000 is the default every one of them claims — a suite pointed at it will
// happily test whichever app answered first. Override with PLAYWRIGHT_PORT.
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3210);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'mobile-402',
      use: { ...devices['Desktop Chrome'], viewport: { width: 402, height: 874 } },
    },
    {
      name: 'edge-767',
      use: { ...devices['Desktop Chrome'], viewport: { width: 767, height: 1024 } },
    },
    {
      name: 'desktop-768',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'desktop-1100',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1100, height: 900 } },
    },
    {
      name: 'desktop-1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    // Build first: `next start` needs .next, and on a clean checkout (or the pre-push
    // hook) nothing has produced it yet.
    command: `pnpm run build && pnpm exec next start -p ${port}`,
    url: baseURL,
    // Never reuse. A server left running from an earlier session serves the build
    // it started with, so a green suite could be reporting on stale code.
    reuseExistingServer: false,
  },
});
