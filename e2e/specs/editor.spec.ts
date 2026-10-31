import { test, expect } from '@playwright/test';
import { editorReady, setSource } from '../support/editor.ts';

test.describe('Monaco editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await editorReady(page);
  });

  test('loads the document with LaTeX syntax highlighting', async ({
    page,
  }) => {
    const lines = page.locator('latex-editor .view-lines');
    await expect(lines).toContainText('\\documentclass[11pt,a4paper]{article}');
    const command = lines.locator('span', { hasText: /^\\section$/ }).first();
    // Monaco renders spaces as no-break spaces and only draws visible lines.
    const prose = lines
      .locator('span', { hasText: /This\sdocument\sis/ })
      .first();
    await expect(command).toBeVisible();
    const color = (l: typeof command) =>
      l.evaluate((el) => getComputedStyle(el).color);
    expect(await color(command)).not.toBe(await color(prose));
  });

  test('an unclosed environment is marked as an error with the parser message', async ({
    page,
  }) => {
    await setSource(page, 'Intro\n\\begin{center}\ntext');
    const squiggle = page.locator('latex-editor .squiggly-error');
    await expect(squiggle).toHaveCount(1);
    await squiggle.hover({ force: true });
    await expect(
      page.locator('.monaco-hover', {
        hasText: '\\begin{center} is never closed.',
      })
    ).toBeVisible();
  });

  test('unknown commands are marked as warnings', async ({ page }) => {
    await setSource(page, 'A \\frobnicate{x} b');
    await expect(page.locator('latex-editor .squiggly-warning')).toHaveCount(1);
  });

  test('fixing the error clears the marker', async ({ page }) => {
    await setSource(page, '\\begin{center}\ntext');
    await expect(page.locator('latex-editor .squiggly-error')).toHaveCount(1);
    await setSource(page, '\\begin{center}\ntext\n\\end{center}');
    await expect(page.locator('latex-editor .squiggly-error')).toHaveCount(0);
  });

  test('edits reach the preview', async ({ page }) => {
    await setSource(page, '\\section{Typed}\nHello.');
    const headings = page
      .frameLocator('latex-preview iframe')
      .getByRole('heading', { level: 2 });
    await expect(headings).toHaveCount(1);
    await expect(headings).toHaveText('1Typed');
  });
});
