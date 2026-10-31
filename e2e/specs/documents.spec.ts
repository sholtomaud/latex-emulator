import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import { editorReady, setSource } from '../support/editor.ts';

const explorer = (page: Page) =>
  page.getByRole('navigation', { name: 'Documents' });
const toggle = (page: Page) =>
  page.getByRole('button', { name: 'Toggle documents' });
const docButton = (page: Page, name: string) =>
  explorer(page).getByRole('button', { name, exact: true });
const editorValue = (page: Page) =>
  page.evaluate(
    () =>
      (document.querySelector('latex-editor') as unknown as { value: string })
        .value
  );
const previewTitle = (page: Page) =>
  page.frameLocator('latex-preview iframe').locator('header.maketitle .title');
const sample = fs.readFileSync('fixtures/article-basic/input.tex', 'utf8');

async function openExplorer(page: Page) {
  if ((await toggle(page).getAttribute('aria-expanded')) !== 'true')
    await toggle(page).click();
  await expect(explorer(page)).toBeVisible();
}

test.describe('documents', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await editorReady(page);
  });

  test('the explorer toggles with its button and Ctrl/⌘+B, and remembers its state', async ({
    page,
  }) => {
    await expect(explorer(page)).toBeHidden();
    await toggle(page).click();
    await expect(explorer(page)).toBeVisible();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(docButton(page, 'A Short Example')).toHaveAttribute(
      'aria-current',
      'true'
    );

    await page.keyboard.press('ControlOrMeta+b');
    await expect(explorer(page)).toBeHidden();
    await page.keyboard.press('ControlOrMeta+b');
    await expect(explorer(page)).toBeVisible();

    await page.reload();
    await expect(explorer(page)).toBeVisible();
  });

  test('a new document opens with the article template', async ({ page }) => {
    await openExplorer(page);
    await explorer(page).getByRole('button', { name: 'New document' }).click();
    await expect(docButton(page, 'Untitled')).toHaveAttribute(
      'aria-current',
      'true'
    );
    await expect.poll(() => editorValue(page)).toContain('\\title{Untitled}');
    await expect(previewTitle(page)).toHaveText('Untitled');
  });

  test('switching documents swaps the editor and preview', async ({ page }) => {
    await openExplorer(page);
    await explorer(page).getByRole('button', { name: 'New document' }).click();
    await expect(previewTitle(page)).toHaveText('Untitled');
    await docButton(page, 'A Short Example').click();
    await expect(previewTitle(page)).toHaveText('A Short Example');
    await expect.poll(() => editorValue(page)).toBe(sample);
  });

  test('edits are saved automatically and survive a reload', async ({
    page,
  }) => {
    await setSource(
      page,
      '\\title{Saved}\\begin{document}\\maketitle\\end{document}'
    );
    await expect(previewTitle(page)).toHaveText('Saved');
    await page.waitForTimeout(800); // autosave debounce
    await page.reload();
    await editorReady(page);
    await expect.poll(() => editorValue(page)).toContain('\\title{Saved}');
    await expect(previewTitle(page)).toHaveText('Saved');
  });

  test('documents can be renamed in place', async ({ page }) => {
    await openExplorer(page);
    await explorer(page)
      .getByRole('button', { name: 'Rename A Short Example' })
      .click();
    const input = explorer(page).getByRole('textbox', {
      name: 'Document name',
    });
    await input.fill('Energy Systems');
    await input.press('Enter');
    await expect(docButton(page, 'Energy Systems')).toBeVisible();
    await page.reload();
    await openExplorer(page);
    await expect(docButton(page, 'Energy Systems')).toBeVisible();
  });

  test('Escape cancels a rename', async ({ page }) => {
    await openExplorer(page);
    await explorer(page)
      .getByRole('button', { name: 'Rename A Short Example' })
      .click();
    const input = explorer(page).getByRole('textbox', {
      name: 'Document name',
    });
    await input.fill('Nope');
    await input.press('Escape');
    await expect(docButton(page, 'A Short Example')).toBeVisible();
  });

  test('deleting a document asks first, then opens another', async ({
    page,
  }) => {
    await openExplorer(page);
    await explorer(page).getByRole('button', { name: 'New document' }).click();
    await expect(docButton(page, 'Untitled')).toBeVisible();
    page.once('dialog', (d) => d.accept());
    await explorer(page)
      .getByRole('button', { name: 'Delete Untitled' })
      .click();
    await expect(docButton(page, 'Untitled')).toHaveCount(0);
    await expect(docButton(page, 'A Short Example')).toHaveAttribute(
      'aria-current',
      'true'
    );
  });

  test('dismissing the delete confirmation keeps the document', async ({
    page,
  }) => {
    await openExplorer(page);
    page.once('dialog', (d) => d.dismiss());
    await explorer(page)
      .getByRole('button', { name: 'Delete A Short Example' })
      .click();
    await expect(docButton(page, 'A Short Example')).toBeVisible();
  });

  test('Download .tex saves the open document with its exact source', async ({
    page,
  }) => {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .tex' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('a-short-example.tex');
    const text = fs.readFileSync((await download.path())!, 'utf8');
    expect(text).toBe(sample);
  });

  test('importing a .tex file creates and opens a document', async ({
    page,
  }) => {
    await openExplorer(page);
    await explorer(page)
      .locator('input[type=file]')
      .setInputFiles({
        name: 'odum_energy.tex',
        mimeType: 'text/x-tex',
        buffer: Buffer.from(
          '\\title{Imported}\\begin{document}\\maketitle\\end{document}'
        ),
      });
    await expect(docButton(page, 'odum energy')).toHaveAttribute(
      'aria-current',
      'true'
    );
    await expect(previewTitle(page)).toHaveText('Imported');
  });
});
