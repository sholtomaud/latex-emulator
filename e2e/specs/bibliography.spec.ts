import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import { editorReady, setSource } from '../support/editor.ts';

const toggle = (page: Page) =>
  page.getByRole('button', { name: 'Toggle documents' });
const library = (page: Page) =>
  page.getByRole('region', { name: 'Bibliography' });
const preview = (page: Page) => page.frameLocator('latex-preview iframe');

async function openExplorer(page: Page) {
  if ((await toggle(page).getAttribute('aria-expanded')) !== 'true')
    await toggle(page).click();
  await expect(library(page)).toBeVisible();
}

const doc = (body: string, bib = 'references') =>
  `\\documentclass{article}\n\\usepackage{natbib}\n\\begin{document}\n${body}\n\\bibliographystyle{plainnat}\n\\bibliography{${bib}}\n\\end{document}`;

test.describe('bibliography', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await editorReady(page);
  });

  test('a first run has references.bib, and citing from it builds the bibliography', async ({
    page,
  }) => {
    await openExplorer(page);
    await expect(library(page).getByRole('listitem')).toHaveText([
      /references\.bib\s*5 entries/,
    ]);
    await setSource(
      page,
      doc(
        'See \\citet{knuth_texbook_1984} and \\citep[p.~5]{lamport_latex_1994}.'
      )
    );
    await expect(preview(page).locator('article p').first()).toHaveText(
      'See Knuth [1984] and [Lamport, 1994, p. 5].'
    );
    await expect(
      preview(page).getByRole('heading', { name: 'References' })
    ).toBeVisible();
    await expect(preview(page).locator('ul.thebibliography > li')).toHaveText([
      /^Donald\sE\. Knuth\./,
      /^Leslie Lamport\./,
    ]);
  });

  test('importing a .bib makes its keys citable; an unknown key is marked', async ({
    page,
  }) => {
    await openExplorer(page);
    await library(page)
      .locator('.import-bib-input')
      .setInputFiles({
        name: 'My Library.bib',
        mimeType: 'application/x-bibtex',
        buffer: Buffer.from(
          '@article{doe_cats_2021, author = {Jane Doe}, title = {Cats}, journal = {J. Cats}, year = 2021}'
        ),
      });
    await expect(library(page).getByRole('status')).toHaveText(
      'Imported My-Library.bib: 1 entry. Use \\bibliography{My-Library}.'
    );
    await setSource(
      page,
      doc(
        'As \\citet{doe_cats_2021} shows, \\citep{nobody_2000}.',
        'My-Library'
      )
    );
    await expect(preview(page).locator('article p').first()).toHaveText(
      'As Doe [2021] shows, [?].'
    );
    await expect(page.locator('latex-editor .squiggly-warning')).toHaveCount(1);
  });

  test('deleting a .bib file asks first; its citations become undefined', async ({
    page,
  }) => {
    await openExplorer(page);
    await setSource(page, doc('\\citet{odum_environmental_1996}'));
    await expect(preview(page).locator('article p').first()).toHaveText(
      'Odum [1996]'
    );
    page.once('dialog', (d) => d.accept());
    await library(page)
      .getByRole('button', { name: 'Delete references.bib' })
      .click({ force: true });
    await expect(library(page).getByRole('listitem')).toHaveCount(0);
    await expect(preview(page).locator('article p').first()).toHaveText('?');
    // Deleting is remembered: the starter file is not added back on reload.
    await page.reload();
    await openExplorer(page);
    await expect(library(page).getByRole('listitem')).toHaveCount(0);
  });

  test('adding a reference by DOI looks it up at doi.org with a fresh key', async ({
    page,
  }) => {
    const requests: string[] = [];
    await page.route('https://doi.org/**', (route) => {
      requests.push(
        `${route.request().url()} ${route.request().headers()['accept']}`
      );
      return route.fulfill({
        status: 200,
        contentType: 'application/vnd.citationstyles.csl+json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: fs.readFileSync(
          'fixtures/references/brown-2004.csl.json',
          'utf8'
        ),
      });
    });
    await openExplorer(page);
    const form = page.getByRole('form', { name: 'Add reference' });
    await form
      .getByLabel('DOI or URL')
      .fill('https://doi.org/10.1016/j.ecolmodel.2003.12.032');
    await form.getByRole('button', { name: 'Add' }).click();
    // references.bib already has brown_energy_2004, so the key gets an "a".
    await expect(library(page).getByRole('status')).toHaveText(
      'Added brown_energy_2004a to references.bib. Cite it with \\citep{brown_energy_2004a}.'
    );
    expect(requests).toEqual([
      'https://doi.org/10.1016/j.ecolmodel.2003.12.032 application/vnd.citationstyles.csl+json',
    ]);
    await expect(form.getByLabel('DOI or URL')).toHaveValue('');
    await expect(library(page).getByRole('listitem')).toHaveText([
      /references\.bib\s*6 entries/,
    ]);
    await setSource(page, doc('\\citet{brown_energy_2004a}'));
    await expect(
      preview(page).locator('ul.thebibliography > li')
    ).toContainText(['Ecological Modelling']);
  });

  test('a web address without a DOI becomes an entry to complete; failures are explained', async ({
    page,
  }) => {
    await page.route('https://doi.org/**', (route) => route.abort());
    await openExplorer(page);
    const form = page.getByRole('form', { name: 'Add reference' });
    const input = form.getByLabel('DOI or URL');
    await input.fill('https://www.example.org/eroi');
    await form.getByRole('button', { name: 'Add' }).click();
    await expect(library(page).getByRole('status')).toContainText(
      'Added example_eroi_'
    );
    await expect(library(page).getByRole('status')).toContainText(
      'Add its author and title'
    );
    await input.fill('10.1016/j.offline.2024.1');
    await form.getByRole('button', { name: 'Add' }).click();
    await expect(library(page).getByRole('status')).toHaveText(
      'Couldn’t reach doi.org. Check your connection and try again.'
    );
    // The text stays, so it can be retried.
    await expect(input).toHaveValue('10.1016/j.offline.2024.1');
  });

  test('cleaning a .bib file fixes it in place and says what changed', async ({
    page,
  }) => {
    await openExplorer(page);
    await library(page)
      .locator('.import-bib-input')
      .setInputFiles({
        name: 'messy.bib',
        mimeType: 'application/x-bibtex',
        buffer: Buffer.from(
          '@ARTICLE{doe_cats_2021, author = {Jane Doe}, title = {Cats}, journal = {J}, year = 2021, pages = {1-9}, doi = {https://doi.org/10.1234/cats}}'
        ),
      });
    await library(page)
      .getByRole('button', { name: 'Clean messy.bib' })
      .click({ force: true });
    await expect(library(page).getByRole('status')).toHaveText(
      'Cleaned messy.bib (2 fixes): doe_cats_2021: pages 1-9 → 1--9; doe_cats_2021: doi without its URL prefix.'
    );
  });
});
