import { test, expect } from '@playwright/test';
import { setSource } from '../support/editor.ts';

test.describe('app shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows the editor and preview side by side', async ({ page }) => {
    await expect(page).toHaveTitle('LaTeX Emulator');
    const editor = page.locator('latex-editor');
    const preview = page.locator('latex-preview iframe');
    await expect(editor).toBeVisible();
    await expect(preview).toBeVisible();

    const editorBox = await editor.boundingBox();
    const previewBox = await preview.boundingBox();
    expect(editorBox && previewBox).toBeTruthy();
    expect(previewBox!.x).toBeGreaterThan(editorBox!.x);
  });

  test('editor and preview share the width, with or without the explorer', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const width = async (selector: string) =>
      (await page.locator(selector).boundingBox())!.width;
    await expect(page.locator('latex-editor .monaco-editor')).toBeVisible();
    // Explorer closed: two equal halves.
    expect(
      Math.abs((await width('latex-editor')) - (await width('latex-preview')))
    ).toBeLessThan(4);
    expect(await width('latex-editor')).toBeGreaterThan(600);
    // Explorer open: it takes a sidebar; the halves stay equal and usable.
    await page.getByRole('button', { name: 'Toggle documents' }).click();
    await expect(
      page.getByRole('navigation', { name: 'Documents' })
    ).toBeVisible();
    expect(await width('document-explorer')).toBeGreaterThan(200);
    expect(
      Math.abs((await width('latex-editor')) - (await width('latex-preview')))
    ).toBeLessThan(4);
    expect(await width('latex-editor')).toBeGreaterThan(450);
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
    await setSource(
      page,
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

  test('every toolbar button fits on a phone screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const name of [
      'Toggle documents',
      'Download .tex',
      'Download Preprint',
      'Download PDF',
    ]) {
      const box = (await page.getByRole('button', { name }).boundingBox())!;
      expect(box.x, name).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, name).toBeLessThanOrEqual(390);
    }
  });

  test('stacks the panes on narrow screens', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    const editorBox = await page.locator('latex-editor').boundingBox();
    const previewBox = await page.locator('latex-preview iframe').boundingBox();
    expect(previewBox!.y).toBeGreaterThan(editorBox!.y);
  });
});
