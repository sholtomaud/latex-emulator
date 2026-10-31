import { test, expect } from '@playwright/test';

/**
 * GitHub Pages deployment checks. Locally these run against the Pages build
 * (`npm run build:pages`) served under /latex-emulator/ with a Pages-style
 * 404.html fallback. After a deploy, CI reruns them against the live site
 * by setting PAGES_URL.
 */
test.describe('github pages', () => {
  test('the app boots under the repo sub-path with no errors', async ({
    page,
  }) => {
    const problems: string[] = [];
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
    });
    page.on('requestfailed', (req) =>
      problems.push(`requestfailed: ${req.url()}`)
    );
    page.on('response', (res) => {
      if (res.status() >= 400 && !res.url().endsWith('/'))
        problems.push(`${res.status()}: ${res.url()}`);
    });

    await page.goto('./');
    await expect(page.locator('app-shell')).toBeVisible();
    await expect(
      page.frameLocator('latex-preview iframe').locator('.latex-page p').first()
    ).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(problems).toEqual([]);
  });

  test('assets are served from the repo sub-path', async ({ page }) => {
    const base = new URL('./', test.info().project.use.baseURL!).pathname;
    const scripts: string[] = [];
    page.on('request', (req) => {
      if (req.resourceType() === 'script')
        scripts.push(new URL(req.url()).pathname);
    });
    await page.goto('./');
    await expect(page.locator('app-shell')).toBeVisible();
    expect(scripts.length).toBeGreaterThan(0);
    for (const path of scripts) expect(path.startsWith(base)).toBe(true);
  });

  test('deep links fall back to the app and show its 404 route', async ({
    page,
  }) => {
    await page.goto('./no/such/page');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      '404 - Page Not Found'
    );
  });
});
