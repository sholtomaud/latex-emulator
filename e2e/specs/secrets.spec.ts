import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { editorReady } from '../support/editor.ts';
import { openView } from '../support/views.ts';
import { fakePasswordManager, savedPassword } from '../support/credentials.ts';

/**
 * Remembered secrets share one place (src/storage/vault.ts): the browser's
 * password manager keeps one password per site, so the assistant's keys
 * and the Zotero plugin's token are one JSON object, and saving either
 * must keep the other.
 */

const MCP = 'http://127.0.0.1:23119/latex-emulator/mcp';
const TOKEN = 'T'.repeat(43);
const setup = (page: Page) =>
  page.getByRole('region', { name: 'Assistant setup' });
const plugin = (page: Page) =>
  page.getByRole('region', { name: 'Zotero plugin' });
const saved = async (page: Page) =>
  JSON.parse((await savedPassword(page)) ?? '{}');

test('the assistant’s keys and the plugin’s token share one saved password', async ({
  page,
}) => {
  await fakePasswordManager(page);
  await page.route(MCP, async (route) => {
    const body = route.request().postDataJSON();
    const result =
      body.method === 'pair/request'
        ? { token: TOKEN, scopes: ['read'] }
        : {
            serverInfo: { version: '0.1.0' },
            _meta: { 'latex-emulator/zotero-version': '10.0.8' },
          };
    await route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*' },
      contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result }),
    });
  });
  await page.goto('/');
  await editorReady(page);

  await openView(page, 'Assistant setup');
  await setup(page)
    .getByLabel('Claude (Anthropic) API key')
    .fill('sk-ant-test');
  await setup(page).getByLabel('Claude (Anthropic) API key').press('Tab');
  await setup(page)
    .getByRole('checkbox', { name: 'Remember the Claude (Anthropic) key' })
    .check();
  await expect.poll(() => saved(page)).toEqual({ anthropic: 'sk-ant-test' });

  await openView(page, 'References');
  await page.getByText('Zotero plugin', { exact: true }).click();
  await plugin(page)
    .getByRole('checkbox', { name: /Remember/ })
    .check();
  await plugin(page).getByRole('button', { name: 'Connect' }).click();
  await expect(plugin(page)).toContainText('Connected to Zotero');
  expect(await saved(page)).toEqual({
    anthropic: 'sk-ant-test',
    'zotero-plugin-token': TOKEN,
  });

  // Forgetting the key keeps the token.
  await openView(page, 'Assistant setup');
  await setup(page)
    .getByRole('checkbox', { name: 'Remember the Claude (Anthropic) key' })
    .uncheck();
  await expect
    .poll(() => saved(page))
    .toEqual({ 'zotero-plugin-token': TOKEN });
});
