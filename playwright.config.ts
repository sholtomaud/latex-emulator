import fs from 'node:fs';
import path from 'node:path';
import { chromium, defineConfig, devices } from '@playwright/test';

/**
 * Test suites (see AGENTS.md §10):
 *   functional-dev   e2e/specs   against the Vite dev server
 *   functional-prod  e2e/specs   against the production build
 *   smoke            e2e/smoke   fast "is the build alive?" checks (prod build)
 *   visual           e2e/visual  toHaveScreenshot snapshots (prod build)
 *   pages            e2e/pages   GitHub Pages build served under /latex-emulator/;
 *                                with PAGES_URL set, runs against the live site
 *
 * Visual baselines are only valid when generated inside the pinned Playwright
 * container (fonts and Chromium build must match CI). Use
 * `npm run e2e:visual` / `npm run e2e:visual:update`, which run in Docker.
 */

// Playwright expects the exact Chromium build it pins. Where that build isn't
// installed (e.g. a sandbox with browsers for another Playwright release),
// fall back to the newest Chromium in the browsers directory. CI runs in the
// pinned Playwright container image, so it always uses the pinned build.
function fallbackChromium(): string | undefined {
  const expected = chromium.executablePath();
  if (fs.existsSync(expected)) return undefined;

  const parts = expected.split(path.sep);
  const buildIndex = parts.findIndex((part) => /^chromium-\d+$/.test(part));
  if (buildIndex === -1) return undefined;
  const browsersDir = parts.slice(0, buildIndex).join(path.sep);
  const relativePath = parts.slice(buildIndex + 1);
  if (!fs.existsSync(browsersDir)) return undefined;

  return fs
    .readdirSync(browsersDir)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .map((name) => path.join(browsersDir, name, ...relativePath))
    .find((file) => fs.existsSync(file));
}

const executablePath = fallbackChromium();
const chrome = {
  ...devices['Desktop Chrome'],
  launchOptions: executablePath ? { executablePath } : {},
};

const DEV_URL = 'http://localhost:5173';
const PROD_URL = 'http://localhost:3000';
const PAGES_PORT = 3001;
// Set PAGES_URL (e.g. https://sholtomaud.github.io/latex-emulator/) to run the
// pages suite against a live deployment instead of a local Pages build.
const LIVE_PAGES_URL = process.env.PAGES_URL;
const PAGES_URL =
  LIVE_PAGES_URL ?? `http://localhost:${PAGES_PORT}/latex-emulator/`;

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'on-first-retry',
    screenshot: 'on',
  },
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.002,
    },
  },
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  projects: [
    {
      name: 'functional-dev',
      testDir: './e2e/specs',
      use: { ...chrome, baseURL: DEV_URL },
    },
    {
      name: 'functional-prod',
      testDir: './e2e/specs',
      use: { ...chrome, baseURL: PROD_URL },
    },
    {
      name: 'smoke',
      testDir: './e2e/smoke',
      use: { ...chrome, baseURL: PROD_URL },
    },
    {
      name: 'pages',
      testDir: './e2e/pages',
      use: { ...chrome, baseURL: PAGES_URL },
    },
    {
      name: 'visual',
      testDir: './e2e/visual',
      use: { ...chrome, baseURL: PROD_URL },
    },
  ],
  webServer: LIVE_PAGES_URL
    ? undefined
    : [
        {
          command: 'npx vite --port 5173 --strictPort',
          url: DEV_URL,
          reuseExistingServer: !process.env.CI,
        },
        {
          command: 'npm run build && npx serve -p 3000 -s dist',
          url: PROD_URL,
          reuseExistingServer: !process.env.CI,
        },
        {
          // No -s: like GitHub Pages, unknown paths get the root 404.html.
          command: `npm run build:pages && npx serve -p ${PAGES_PORT} .pages`,
          url: `http://localhost:${PAGES_PORT}/latex-emulator/`,
          reuseExistingServer: !process.env.CI,
        },
      ],
});
