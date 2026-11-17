import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { editorReady, setSource } from '../support/editor.ts';
import { openView } from '../support/views.ts';
import {
  credentialReads,
  fakePasswordManager,
  noPasswordManager,
  savedPassword,
} from '../support/credentials.ts';

/**
 * The Zotero plugin from the app's side (ADR 0024 phase 1): get it,
 * connect (pair) with a code Zotero also shows, remember the connection
 * only if asked, and say plainly what went wrong. The plugin is mocked
 * with page.route; the real plugin is tested against a real Zotero in
 * zotero-plugin/integration.
 */

const MCP = 'http://127.0.0.1:23119/latex-emulator/mcp';
const TOKEN = 'T'.repeat(43);

const panel = (page: Page) =>
  page.getByRole('region', { name: 'Zotero plugin' });

async function openPanel(page: Page) {
  await openView(page, 'References');
  const summary = page.getByText('Zotero plugin', { exact: true });
  if (!(await panel(page).isVisible())) await summary.click();
  await expect(panel(page)).toBeVisible();
}

interface Call {
  method: string;
  params: Record<string, unknown>;
  headers: Record<string, string>;
}

/** A plugin that pairs (or not) and knows one token. */
async function fakePlugin(
  page: Page,
  answer: (
    call: Call
  ) => { status?: number; result?: unknown; error?: unknown } | 'abort'
) {
  const calls: Call[] = [];
  await page.route(MCP, async (route: Route) => {
    const req = route.request();
    const body = req.postDataJSON();
    const call = {
      method: body.method,
      params: body.params ?? {},
      headers: req.headers(),
    };
    calls.push(call);
    const a = answer(call);
    if (a === 'abort') return route.abort('connectionrefused');
    await route.fulfill({
      status: a.status ?? 200,
      headers: { 'Access-Control-Allow-Origin': req.headers().origin ?? '*' },
      contentType: 'application/json',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        ...(a.error ? { error: a.error } : { result: a.result }),
      }),
    });
  });
  return calls;
}

const working = (call: Call) =>
  call.method === 'pair/request'
    ? { result: { token: TOKEN, scopes: ['read'] } }
    : call.method === 'initialize'
      ? (call.params._meta as Record<string, string>)[
          'latex-emulator/token'
        ] === TOKEN
        ? {
            result: {
              serverInfo: { name: 'latex-emulator-zotero', version: '0.1.0' },
              _meta: { 'latex-emulator/zotero-version': '10.0.8' },
            },
          }
        : { status: 401, error: { code: -32001, message: 'Pair first.' } }
      : { error: { code: -32601, message: 'no' } };

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await editorReady(page);
});

test('Get the plugin downloads the .xpi, with the steps to install it', async ({
  page,
}) => {
  await openPanel(page);
  await expect(panel(page)).toContainText('Install Plugin From File');
  const downloadPromise = page.waitForEvent('download');
  await panel(page)
    .getByRole('link', { name: 'Get the Zotero plugin' })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('latex-emulator-zotero.xpi');
  const bytes = (await import('node:fs')).readFileSync(
    (await download.path())!
  );
  expect(bytes.subarray(0, 2).toString()).toBe('PK'); // a zip
});

test('Connect pairs with a code shown here and in Zotero; nothing is sent before the click', async ({
  page,
}) => {
  let release: () => void = () => {};
  const asked = new Promise<void>((r) => (release = r));
  const calls = await fakePlugin(page, working);
  await page.route(MCP, async (route) => {
    // Hold the pairing until the test has read the code, as a person would.
    if (route.request().postDataJSON().method === 'pair/request') await asked;
    await route.fallback();
  });
  await openPanel(page);
  await expect(panel(page)).toContainText('Not connected.');
  expect(calls).toHaveLength(0);

  await panel(page).getByRole('button', { name: 'Connect' }).click();
  await expect(panel(page)).toContainText(
    /In Zotero, check that the code is \d \d \d \d/
  );
  const shown = (await panel(page).textContent())!
    .match(/code is (\d) (\d) (\d) (\d)/)!
    .slice(1)
    .join('');
  release();
  await expect(panel(page)).toContainText(
    'Connected to Zotero 10.0.8 (plugin 0.1.0).'
  );

  const pair = calls.find((c) => c.method === 'pair/request')!;
  expect(pair.params).toEqual({
    name: 'LaTeX Emulator',
    code: shown,
    scopes: ['read', 'write-notes'],
  });
  // A CORS simple request: text/plain, and no Authorization header.
  expect(pair.headers['content-type']).toMatch(/^text\/plain/);
  expect(pair.headers.authorization).toBeUndefined();
  await expect(
    panel(page).getByRole('button', { name: 'Disconnect' })
  ).toBeVisible();
});

for (const mode of ['password manager', 'no password manager'] as const)
  test(`with ${mode}: the connection lasts the session unless Remember is ticked`, async ({
    page,
  }) => {
    if (mode === 'password manager') await fakePasswordManager(page);
    else await noPasswordManager(page);
    await page.reload();
    await editorReady(page);
    await fakePlugin(page, working);
    await openPanel(page);
    const remember = panel(page).getByRole('checkbox', {
      name:
        mode === 'password manager'
          ? 'Remember this connection in this browser’s password manager'
          : 'Remember this connection on this device (stored encrypted)',
    });
    await panel(page).getByRole('button', { name: 'Connect' }).click();
    await expect(panel(page)).toContainText('Connected to Zotero');
    await page.reload();
    await editorReady(page);
    await openPanel(page);
    await expect(panel(page)).toContainText('Not connected.');

    await remember.check();
    await panel(page).getByRole('button', { name: 'Connect' }).click();
    await expect(panel(page)).toContainText('Connected to Zotero');
    if (mode === 'password manager')
      // One saved password holds the app's secrets, as JSON.
      expect(JSON.parse((await savedPassword(page))!)).toEqual({
        'zotero-plugin-token': TOKEN,
      });
    await page.reload();
    await editorReady(page);
    await openPanel(page);
    await expect(panel(page)).toContainText('Connected to Zotero 10.0.8');
    await expect(remember).toBeChecked();
    // Never in localStorage, in any form.
    const stored = await page.evaluate(() =>
      JSON.stringify({ ...localStorage })
    );
    expect(stored).not.toContain(TOKEN);

    await panel(page).getByRole('button', { name: 'Disconnect' }).click();
    await expect(panel(page)).toContainText('Not connected.');
    if (mode === 'password manager')
      expect(JSON.parse((await savedPassword(page))!)).toEqual({});
    await page.reload();
    await editorReady(page);
    await openPanel(page);
    await expect(panel(page)).toContainText('Not connected.');
  });

test('failures say what to do', async ({ page }) => {
  await fakePlugin(page, () => 'abort');
  await openPanel(page);
  await panel(page).getByRole('button', { name: 'Connect' }).click();
  await expect(panel(page)).toContainText('Zotero didn’t answer.');

  await page.unrouteAll({ behavior: 'wait' });
  await fakePlugin(page, (c) =>
    c.method === 'pair/request'
      ? { error: { code: -32004, message: 'no' } }
      : { result: {} }
  );
  await panel(page).getByRole('button', { name: 'Connect' }).click();
  await expect(panel(page)).toContainText(
    'The connection was declined in Zotero.'
  );
});

test('a remembered connection removed in Zotero is dropped', async ({
  page,
}) => {
  await fakePasswordManager(page);
  await page.reload();
  await editorReady(page);
  let removed = false;
  await fakePlugin(page, (c) =>
    removed && c.method === 'initialize'
      ? { status: 401, error: { code: -32001, message: 'x' } }
      : working(c)
  );
  await openPanel(page);
  await panel(page)
    .getByRole('checkbox', { name: /Remember this connection/ })
    .check();
  await panel(page).getByRole('button', { name: 'Connect' }).click();
  await expect(panel(page)).toContainText('Connected to Zotero');
  removed = true;
  await page.reload();
  await editorReady(page);
  await openPanel(page);
  await expect(panel(page)).toContainText(
    'This connection was removed in Zotero.'
  );
  await page.reload();
  await editorReady(page);
  await openPanel(page);
  await expect(panel(page)).toContainText('Not connected.');
});

/** The working plugin, plus search_items (plugin 0.2.0, with include_csl). */
const searching = (call: Call) =>
  call.method === 'tools/call'
    ? (call.params._meta as Record<string, string>)['latex-emulator/token'] ===
      TOKEN
      ? {
          result: {
            content: [{ type: 'text', text: '…' }],
            structuredContent: {
              items: [
                {
                  key: 'ABCD2345',
                  title: 'Systems ecology',
                  csl: {
                    type: 'book',
                    title: 'Systems ecology',
                    author: [{ family: 'Odum', given: 'Howard T.' }],
                    issued: { 'date-parts': [[1983]] },
                  },
                },
              ],
            },
          },
        }
      : { status: 401, error: { code: -32001, message: 'Pair first.' } }
    : working(call);

test('once connected, Zotero searches and suggestions go through the plugin, not Zotero’s local API', async ({
  page,
}) => {
  const calls = await fakePlugin(page, searching);
  let localApi = 0;
  await page.route('http://localhost:23119/api/**', (route) => {
    localApi++;
    return route.abort('failed');
  });
  await openPanel(page);
  await panel(page).getByRole('button', { name: 'Connect' }).click();
  await expect(panel(page)).toContainText('Connected to Zotero');

  // The References search box.
  const library = page.getByRole('region', { name: 'Bibliography' });
  await library.getByText('Zotero', { exact: true }).click();
  await expect(library.getByLabel('Zotero library')).toHaveValue('local');
  await library.getByRole('searchbox', { name: 'Search Zotero' }).fill('odum');
  await library.getByRole('button', { name: 'Search' }).click();
  // The library's status line (the plugin panel above has its own).
  const status = library.locator('.bib-status');
  await expect(status).toHaveText('1 item in Zotero.');
  const search = calls.find((c) => c.method === 'tools/call')!;
  expect(search.params.name).toBe('search_items');
  expect(search.params.arguments).toEqual({
    query: 'odum',
    limit: 25,
    include_csl: true,
  });
  await expect(
    library.getByRole('list', { name: 'Zotero results' }).getByRole('listitem')
  ).toHaveText([/Systems ecology\s*Odum, 1983/]);

  // The citation typeahead.
  await library
    .getByLabel('Suggest from Zotero while typing citations')
    .check();
  await setSource(page, '');
  await page.getByRole('textbox', { name: 'LaTeX source' }).focus();
  await page.keyboard.type('\\citep{syst');
  // The library's own matches come first; the plugin's hit is among them.
  await expect(
    page
      .locator('latex-editor .suggest-widget .monaco-list-row')
      .filter({ hasText: 'odum_systems_1983' })
  ).toContainText('Zotero');
  expect(localApi).toBe(0);
});

test('an older plugin without include_csl says to update it', async ({
  page,
}) => {
  await fakePlugin(page, (call) =>
    call.method === 'tools/call'
      ? {
          result: {
            content: [
              {
                type: 'text',
                text: 'Invalid arguments: include_csl is not a known argument.',
              },
            ],
            isError: true,
          },
        }
      : working(call)
  );
  await openPanel(page);
  await panel(page).getByRole('button', { name: 'Connect' }).click();
  await expect(panel(page)).toContainText('Connected to Zotero');
  const library = page.getByRole('region', { name: 'Bibliography' });
  await library.getByText('Zotero', { exact: true }).click();
  await library.getByRole('searchbox', { name: 'Search Zotero' }).fill('odum');
  await library.getByRole('button', { name: 'Search' }).click();
  await expect(library.locator('.bib-status')).toContainText(
    'Update the LaTeX Emulator plugin in Zotero'
  );
});

test('a remembered connection serves searches after a reload, without asking the password manager while typing', async ({
  page,
}) => {
  for (const mode of ['no password manager', 'password manager'] as const) {
    await page.unrouteAll({ behavior: 'wait' });
    if (mode === 'password manager') await fakePasswordManager(page);
    else await noPasswordManager(page);
    await page.reload();
    await editorReady(page);
    const calls = await fakePlugin(page, searching);
    await openPanel(page);
    await panel(page)
      .getByRole('checkbox', { name: /Remember/ })
      .check();
    await panel(page).getByRole('button', { name: 'Connect' }).click();
    await expect(panel(page)).toContainText('Connected to Zotero');

    await page.reload();
    await editorReady(page);
    calls.length = 0;
    const library = page.getByRole('region', { name: 'Bibliography' });
    await openView(page, 'References');
    await library.getByText('Zotero', { exact: true }).click();
    await library
      .getByRole('searchbox', { name: 'Search Zotero' })
      .fill('odum');
    await library.getByRole('button', { name: 'Search' }).click();
    if (mode === 'no password manager') {
      // Encrypted storage reads silently: the remembered token is used.
      await expect(library.locator('.bib-status')).toHaveText(
        '1 item in Zotero.'
      );
      expect(calls.some((c) => c.method === 'tools/call')).toBe(true);
    } else {
      // The password manager may ask, so it isn't read for a search…
      expect(calls.some((c) => c.method === 'tools/call')).toBe(false);
      expect(await credentialReads(page)).toBe(0);
      // …until the plugin section reads it; then searches use it.
      await openPanel(page);
      await expect(panel(page)).toContainText('Connected to Zotero');
      await library.getByRole('button', { name: 'Search' }).click();
      await expect(library.locator('.bib-status')).toHaveText(
        '1 item in Zotero.'
      );
    }
    await page.evaluate(() => sessionStorage.clear());
  }
});
