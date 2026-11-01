import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { editorInput, editorReady, setSource } from '../support/editor.ts';

/**
 * Citation keys in the editor: typeahead from the references library (and
 * optionally Zotero), hovers, and the quick fix for a missing
 * \bibliography. The starter library has five entries (references.bib).
 */

const editorValue = (page: Page) =>
  page.evaluate(
    () =>
      (document.querySelector('latex-editor') as unknown as { value: string })
        .value
  );
const suggestions = (page: Page) =>
  page.locator('latex-editor .suggest-widget .monaco-list-row');

/** Put `text` in the editor with the cursor at the end, then type `typed`. */
async function typeAtEnd(page: Page, text: string, typed: string) {
  await setSource(page, text);
  await editorInput(page).focus();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(typed);
}

test.describe('citation typeahead', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await editorReady(page);
  });

  test('inside \\citep{…} the library’s keys are offered and Enter inserts one', async ({
    page,
  }) => {
    await typeAtEnd(page, 'See ', '\\citep{knu');
    await expect(suggestions(page).first()).toContainText('knuth_texbook_1984');
    await expect(suggestions(page).first()).toContainText('Knuth 1984');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => editorValue(page))
      .toBe('See \\citep{knuth_texbook_1984}'); // Monaco closed the brace
  });

  test('typing an author finds the key; the second key after a comma works too', async ({
    page,
  }) => {
    await typeAtEnd(page, '\\citet{knuth_texbook_1984, ', 'Ulgiati');
    await expect(suggestions(page)).toHaveCount(1);
    await expect(suggestions(page).first()).toContainText('brown_energy_2004');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => editorValue(page))
      .toBe('\\citet{knuth_texbook_1984, brown_energy_2004');
  });

  test('hovering a key shows its reference', async ({ page }) => {
    await setSource(page, 'See \\citep{lamport_latex_1994}.');
    await page
      .locator('latex-editor .view-lines span', {
        hasText: 'lamport_latex_1994',
      })
      .first()
      .hover();
    await expect(page.locator('.monaco-hover:visible')).toContainText(
      'Lamport (1994). LaTeX: A Document Preparation System. references.bib'
    );
  });

  test('a citation with no \\bibliography gets a quick fix that adds one', async ({
    page,
  }) => {
    await setSource(
      page,
      '\\documentclass{article}\n\\usepackage{natbib}\n\\begin{document}\nSee \\citep{knuth_texbook_1984}.\n\\end{document}\n'
    );
    const preview = page.frameLocator('latex-preview iframe');
    await expect(preview.locator('article p').first()).toHaveText('See (?).'); // no style yet: natbib's round default
    await page
      .locator('latex-editor .view-lines span', {
        hasText: 'knuth_texbook_1984',
      })
      .first()
      .click();
    await page.keyboard.press('ControlOrMeta+.');
    await page
      .locator('.action-widget, .context-view')
      .getByText('Add \\bibliography{references}')
      .click();
    await expect
      .poll(() => editorValue(page))
      .toContain(
        '\\bibliographystyle{plainnat}\n\\bibliography{references}\n\\end{document}'
      );
    await expect(preview.locator('article p').first()).toHaveText(
      'See [Knuth, 1984].'
    );
  });

  test('with Zotero typeahead on, Zotero items are offered and added when chosen', async ({
    page,
  }) => {
    await page.route('http://localhost:23119/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          items: [
            {
              type: 'book',
              title: 'Systems ecology',
              author: [{ family: 'Odum', given: 'Howard T.' }],
              issued: { 'date-parts': [[1983]] },
            },
          ],
        }),
      })
    );
    await page.getByRole('button', { name: 'Toggle documents' }).click();
    const library = page.getByRole('region', { name: 'Bibliography' });
    await library.getByText('Zotero', { exact: true }).click();
    await library
      .getByLabel('Suggest from Zotero while typing citations')
      .check();

    await typeAtEnd(page, '', '\\citep{systems');
    const row = suggestions(page).filter({ hasText: 'odum_systems_1983' });
    await expect(row).toContainText('Zotero');
    await row.click();
    await expect
      .poll(() => editorValue(page))
      .toBe('\\citep{odum_systems_1983}');
    await expect(library.getByRole('listitem').first()).toContainText(
      '6 entries'
    );
    await expect(library.getByRole('status')).toHaveText(
      'Added odum_systems_1983 from Zotero to references.bib.'
    );
  });
});
