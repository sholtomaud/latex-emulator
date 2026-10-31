import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { editorReady } from '../support/editor.ts';

/**
 * Visual regression snapshots. Baselines live in e2e/visual/__screenshots__/
 * and must be generated in the pinned Playwright container:
 *   npm run e2e:visual:update
 */

async function openApp(page: Page, width = 1280, height = 800) {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await expect(
    page.frameLocator('latex-preview iframe').locator('.latex-page p').first()
  ).toBeVisible();
  await editorReady(page);
  // Monaco tokenizes after first paint; wait for highlighted tokens.
  await expect(
    page
      .locator('latex-editor .view-lines span', { hasText: /^\\section$/ })
      .first()
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test.describe('visual', () => {
  test('app shell, desktop', async ({ page }) => {
    await openApp(page);
    await expect(page).toHaveScreenshot('app-shell-desktop.png');
  });

  test('app shell, mobile', async ({ page }) => {
    await openApp(page, 390, 844);
    await expect(page).toHaveScreenshot('app-shell-mobile.png');
  });

  test('preview page', async ({ page }) => {
    await openApp(page);
    const sheet = page
      .frameLocator('latex-preview iframe')
      .locator('.latex-page');
    await expect(sheet).toHaveScreenshot('preview-page.png');
  });

  test('preview page in print media', async ({ page }) => {
    await openApp(page);
    await page.emulateMedia({ media: 'print' });
    const sheet = page
      .frameLocator('latex-preview iframe')
      .locator('.latex-page');
    await expect(sheet).toHaveScreenshot('preview-page-print.png');
  });
});
