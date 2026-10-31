import { test, expect } from '@playwright/test';

test.describe('app shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows the editor and preview side by side', async ({ page }) => {
    await expect(page).toHaveTitle('LaTeX Emulator');
    const editor = page.getByRole('textbox', { name: 'LaTeX source' });
    const preview = page.locator('latex-preview iframe');
    await expect(editor).toBeVisible();
    await expect(preview).toBeVisible();

    const editorBox = await editor.boundingBox();
    const previewBox = await preview.boundingBox();
    expect(editorBox && previewBox).toBeTruthy();
    expect(previewBox!.x).toBeGreaterThan(editorBox!.x);
  });

  test('renders the sample document body, not the preamble', async ({
    page,
  }) => {
    const doc = page.frameLocator('latex-preview iframe');
    await expect(doc.locator('.latex-page')).toContainText(
      'This document is written in the LaTeX Emulator'
    );
    await expect(doc.locator('.latex-page')).not.toContainText('documentclass');
  });

  test('updates the preview as the user types', async ({ page }) => {
    const editor = page.getByRole('textbox', { name: 'LaTeX source' });
    await editor.fill(
      '\\begin{document}\nFirst paragraph.\n\nSecond <b>paragraph</b>.\n\\end{document}'
    );

    const paragraphs = page
      .frameLocator('latex-preview iframe')
      .locator('.latex-page p');
    await expect(paragraphs).toHaveText([
      'First paragraph.',
      'Second <b>paragraph</b>.',
    ]);
    // User text is rendered as text, never parsed as HTML.
    await expect(
      page.frameLocator('latex-preview iframe').locator('.latex-page b')
    ).toHaveCount(0);
  });

  test('scales the page to fit the preview pane', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const frame = page.locator('latex-preview iframe');
    const frameWidth = (await frame.boundingBox())!.width;
    const pageRight = await page
      .frameLocator('latex-preview iframe')
      .locator('.latex-page')
      .evaluate((el) => el.getBoundingClientRect().right);
    expect(pageRight).toBeLessThanOrEqual(frameWidth);
  });

  test('stacks the panes on narrow screens', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    const editorBox = await page
      .getByRole('textbox', { name: 'LaTeX source' })
      .boundingBox();
    const previewBox = await page.locator('latex-preview iframe').boundingBox();
    expect(previewBox!.y).toBeGreaterThan(editorBox!.y);
  });
});
