import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { editorReady } from '../support/editor.ts';

/**
 * Zotero search, with Zotero mocked: the local API on this computer
 * (localhost:23119) and the zotero.org web API. Zotero's answers are
 * CSL-JSON, as requested with format=csljson.
 */

const ITEMS = {
  items: [
    {
      id: '0/ABCD1234',
      type: 'book',
      title: 'Environmental accounting',
      author: [{ family: 'Odum', given: 'Howard T.' }],
      publisher: 'Wiley',
      issued: { 'date-parts': [['1996']] },
    },
    {
      id: '0/EFGH5678',
      type: 'article-journal',
      title: 'Energy quality, emergy, and transformity',
      author: [
        { family: 'Brown', given: 'Mark T.' },
        { family: 'Ulgiati', given: 'Sergio' },
      ],
      'container-title': 'Ecological Modelling',
      issued: { 'date-parts': [[2004, 10]] },
    },
  ],
};

const library = (page: Page) =>
  page.getByRole('region', { name: 'Bibliography' });

async function openZotero(page: Page) {
  await page.goto('/');
  await editorReady(page);
  await page.getByRole('button', { name: 'Toggle documents' }).click();
  await library(page).getByText('Zotero', { exact: true }).click();
}

const answer =
  (requests: { url: string; key?: string }[]) => (route: Route) => {
    const headers = route.request().headers();
    requests.push({
      url: route.request().url(),
      key: headers['zotero-api-key'],
      // Any custom header forces a CORS preflight, which Zotero's local
      // server doesn't answer: the version must travel in the URL.
      ...(headers['zotero-api-version']
        ? { version: headers['zotero-api-version'] }
        : {}),
    });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(ITEMS),
    });
  };

test.describe('Zotero', () => {
  test('search Zotero on this computer and add a result to a .bib file', async ({
    page,
  }) => {
    const requests: { url: string; key?: string }[] = [];
    await page.route('http://localhost:23119/**', answer(requests));
    await openZotero(page);
    await expect(library(page).getByLabel('Zotero library')).toHaveValue(
      'local'
    );
    await expect(library(page).getByLabel('Zotero API key')).toBeHidden();

    await library(page)
      .getByRole('searchbox', { name: 'Search Zotero' })
      .fill('odum energy');
    await library(page).getByRole('button', { name: 'Search' }).click();
    await expect(library(page).getByRole('status')).toHaveText(
      '2 items in Zotero.'
    );
    expect(requests).toEqual([
      {
        url: 'http://localhost:23119/api/users/0/items/top?v=3&format=csljson&limit=25&q=odum+energy',
        key: undefined,
      },
    ]);
    const results = library(page).getByRole('list', { name: 'Zotero results' });
    await expect(results.getByRole('listitem')).toHaveText([
      /Environmental accounting\s*Odum, 1996/,
      /Energy quality, emergy, and transformity\s*Brown and Ulgiati, 2004/,
    ]);

    // references.bib already has odum_environmental_1996: the key gets an "a".
    await results
      .getByRole('button', {
        name: 'Add “Environmental accounting” to references.bib',
      })
      .click();
    await expect(library(page).getByRole('status')).toHaveText(
      'Added odum_environmental_1996a to references.bib. Cite it with \\citep{odum_environmental_1996a}.'
    );
    await expect(library(page).getByRole('listitem').first()).toContainText(
      '6 entries'
    );
  });

  test('when Zotero is not running, the app says what to check', async ({
    page,
  }) => {
    await page.route('http://localhost:23119/**', (route) => route.abort());
    await openZotero(page);
    await library(page)
      .getByRole('searchbox', { name: 'Search Zotero' })
      .fill('odum');
    await library(page).getByRole('button', { name: 'Search' }).click();
    await expect(library(page).getByRole('status')).toContainText(
      'Start Zotero 7'
    );
    await expect(library(page).getByRole('status')).toContainText(
      'Allow other applications on this computer to communicate with Zotero'
    );
  });

  test('the web library sends the API key, which is never stored', async ({
    page,
  }) => {
    const requests: { url: string; key?: string }[] = [];
    await page.route('https://api.zotero.org/**', answer(requests));
    await openZotero(page);
    await library(page).getByLabel('Zotero library').selectOption('web');
    await library(page).getByLabel('Zotero user ID').fill('123456');
    await library(page).getByLabel('Zotero user ID').press('Tab');
    await library(page).getByLabel('Zotero API key').fill('s3cret');
    await library(page).getByLabel('Zotero API key').press('Tab');
    await library(page)
      .getByRole('searchbox', { name: 'Search Zotero' })
      .fill('brown');
    await library(page).getByRole('button', { name: 'Search' }).click();
    await expect(library(page).getByRole('status')).toHaveText(
      '2 items in Zotero.'
    );
    expect(requests).toEqual([
      {
        url: 'https://api.zotero.org/users/123456/items/top?v=3&format=csljson&limit=25&q=brown',
        key: 's3cret',
      },
    ]);
    const stored = await page.evaluate(() => JSON.stringify(localStorage));
    expect(stored).not.toContain('s3cret');

    // After a reload the library choice and user ID remain; the key does not.
    await page.reload();
    await editorReady(page);
    await library(page).getByText('Zotero', { exact: true }).click();
    await expect(library(page).getByLabel('Zotero library')).toHaveValue('web');
    await expect(library(page).getByLabel('Zotero user ID')).toHaveValue(
      '123456'
    );
    await expect(library(page).getByLabel('Zotero API key')).toHaveValue('');
  });
});
