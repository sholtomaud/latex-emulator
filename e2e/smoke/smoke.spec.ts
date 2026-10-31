import { test, expect } from '@playwright/test';
import { setSource } from '../support/editor.ts';

/**
 * Smoke tests: the minimum that must hold for a build to be shippable. They
 * run against the production build and must stay fast (< 10 s total).
 */
test.describe('smoke', () => {
  test('the app boots with no errors or failed requests', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
    });
    page.on('requestfailed', (req) =>
      problems.push(`requestfailed: ${req.url()}`)
    );
    page.on('response', (res) => {
      if (res.status() >= 400) problems.push(`${res.status()}: ${res.url()}`);
    });

    await page.goto('/');
    await expect(page.locator('app-shell')).toBeVisible();
    await expect(
      page.frameLocator('latex-preview iframe').locator('.latex-page p').first()
    ).toBeVisible();
    await page.waitForLoadState('networkidle');

    expect(problems).toEqual([]);
  });

  test('editing reaches the preview', async ({ page }) => {
    await page.goto('/');
    await setSource(page, 'Smoke check.');
    await expect(
      page.frameLocator('latex-preview iframe').locator('.latex-page')
    ).toHaveText('Smoke check.');
  });

  test('unknown routes show the 404 page', async ({ page }) => {
    await page.goto('/does-not-exist');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      '404 - Page Not Found'
    );
  });
});
