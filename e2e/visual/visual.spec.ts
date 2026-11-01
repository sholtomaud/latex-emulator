import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import { editorReady, setSource } from '../support/editor.ts';

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

  test('app shell with the document explorer open', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Toggle documents' }).click();
    await expect(
      page.getByRole('navigation', { name: 'Documents' })
    ).toBeVisible();
    await page.mouse.move(0, 0); // no hover state
    await expect(page).toHaveScreenshot('app-shell-explorer.png');
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

  test('preview page with citations and a bibliography', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Toggle documents' }).click();
    await page
      .getByRole('region', { name: 'Bibliography' })
      .locator('.import-bib-input')
      .setInputFiles('fixtures/natbib-basic/refs.bib');
    await expect(page.getByRole('status')).toContainText('Imported refs.bib');
    await page.getByRole('button', { name: 'Toggle documents' }).click();
    await setSource(
      page,
      fs.readFileSync('fixtures/natbib-basic/input.tex', 'utf8')
    );
    const sheet = page
      .frameLocator('latex-preview iframe')
      .locator('.latex-page');
    await expect(sheet.locator('ul.thebibliography > li')).toHaveCount(3);
    await page.evaluate(() => document.fonts.ready);
    await expect(sheet).toHaveScreenshot('preview-bibliography.png');
  });

  test('preview page with math', async ({ page }) => {
    await openApp(page);
    await setSource(
      page,
      fs.readFileSync('fixtures/math-basic/input.tex', 'utf8')
    );
    const sheet = page
      .frameLocator('latex-preview iframe')
      .locator('.latex-page');
    await expect(sheet.locator('.eqno')).toHaveText(['(1)', '(2)', '(3)']);
    await page.evaluate(() => document.fonts.ready);
    await expect(sheet).toHaveScreenshot('preview-math.png');
  });

  test('preview page with tables', async ({ page }) => {
    await openApp(page);
    await setSource(
      page,
      fs.readFileSync('fixtures/table-basic/input.tex', 'utf8')
    );
    const sheet = page
      .frameLocator('latex-preview iframe')
      .locator('.latex-page');
    await expect(sheet.locator('.caption-label')).toHaveText([
      'Table\u00a01: ',
      'Table\u00a02: ',
    ]);
    await page.evaluate(() => document.fonts.ready);
    await expect(sheet).toHaveScreenshot('preview-tables.png');
  });
});
