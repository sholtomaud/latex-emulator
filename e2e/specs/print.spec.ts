import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Replace the preview iframe's print() with a recorder. */
async function recordPrints(page: Page) {
  await page.waitForFunction(() =>
    document.querySelector('latex-preview iframe')
  );
  await page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>(
      'latex-preview iframe'
    )!;
    const w = window as unknown as { prints: string[] };
    w.prints = [];
    frame.contentWindow!.print = () => {
      w.prints.push(frame.contentDocument!.title);
    };
  });
}

const prints = (page: Page) =>
  page.evaluate(() => (window as unknown as { prints: string[] }).prints);

test.describe('PDF download', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(
      page.frameLocator('latex-preview iframe').locator('header.maketitle')
    ).toBeVisible();
    await recordPrints(page);
  });

  test('the Download PDF button prints only the preview, named after the title', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Download PDF' }).click();
    await expect.poll(() => prints(page)).toEqual(['A Short Example']);
  });

  test('Cmd/Ctrl+P prints the preview instead of the app', async ({ page }) => {
    await page.getByRole('textbox', { name: 'LaTeX source' }).focus();
    await page.keyboard.press('ControlOrMeta+p');
    await expect.poll(() => prints(page)).toEqual(['A Short Example']);
  });

  test('a document without a title prints as "document"', async ({ page }) => {
    await page
      .getByRole('textbox', { name: 'LaTeX source' })
      .fill('Just text.');
    await expect(
      page.frameLocator('latex-preview iframe').locator('article')
    ).toHaveText('Just text.');
    await page.getByRole('button', { name: 'Download PDF' }).click();
    await expect.poll(() => prints(page)).toEqual(['document']);
  });
});
