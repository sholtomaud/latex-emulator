import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { editorReady, setSource } from '../support/editor.ts';
import { openView } from '../support/views.ts';

/**
 * The Explorer as documents-as-folders (ADR 0022 phase 2): the open
 * document shows the files of its project folder — its .tex, the .bib
 * files its \bibliography lists (generated subsets, ADR 0020) and its
 * images — so what you see is what a save writes.
 */

const docs = (page: Page) =>
  page.getByRole('navigation', { name: 'Documents' });
const files = (page: Page, doc: string) =>
  docs(page).getByRole('list', { name: `Files in ${doc}` });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await editorReady(page);
  await openView(page, 'Explorer');
});

test('the open document lists its .tex and the .bib files it uses, with what is cited', async ({
  page,
}) => {
  await expect(files(page, 'A Short Example')).toContainText(
    'a-short-example.tex'
  );
  await setSource(
    page,
    [
      '\\documentclass{article}',
      '\\usepackage{natbib}',
      '\\begin{document}',
      'See \\citet{odum_environmental_1996}.',
      '\\bibliographystyle{plainnat}',
      '\\bibliography{references,elsewhere}',
      '\\end{document}',
    ].join('\n')
  );
  const list = files(page, 'A Short Example');
  await expect(list).toContainText('references.bib');
  await expect(list).toContainText('1 cited of 5 in the library');
  await expect(list).toContainText('elsewhere.bib');
  await expect(list).toContainText('not in your library');

  // The .bib is generated from the library: its row leads there.
  await list
    .getByRole('button', { name: 'Show references.bib in References' })
    .click();
  await expect(
    page.getByRole('region', { name: 'Bibliography' })
  ).toBeVisible();
});

test('images are listed among the open document’s files; other documents are closed', async ({
  page,
}) => {
  await page
    .locator('image-panel .add-image-input')
    .setInputFiles('fixtures/figure-basic/images/plot.png');
  await expect(
    files(page, 'A Short Example').getByRole('list', {
      name: 'This document’s images',
    })
  ).toContainText('plot.png');

  await docs(page).getByRole('button', { name: 'New document' }).click();
  await expect(files(page, 'Untitled')).toContainText('untitled.tex');
  // Only the open document is expanded.
  await expect(files(page, 'A Short Example')).toHaveCount(0);
  await expect(
    files(page, 'Untitled').getByRole('list', {
      name: 'This document’s images',
    })
  ).toBeVisible();
});
