import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { editorReady } from '../support/editor.ts';

/**
 * The activity bar and primary side bar (ADR 0022): one view at a time,
 * VS Code's toggle, remembered across reloads, keyboard-operable.
 */

const bar = (page: Page) =>
  page.getByRole('tablist', { name: 'Side bar views' });
const tab = (page: Page, name: string) =>
  bar(page).getByRole('tab', { name, exact: true });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await editorReady(page);
});

test('one view at a time; clicking the open view closes the side bar', async ({
  page,
}) => {
  await expect(bar(page).getByRole('tab')).toHaveText([
    'Explorer',
    'Versions',
    'References',
    'Storage',
  ]);
  await tab(page, 'Versions').click();
  await expect(tab(page, 'Versions')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Versions' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Bibliography' })).toBeHidden();

  await tab(page, 'References').click();
  await expect(
    page.getByRole('region', { name: 'Bibliography' })
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Versions' })).toBeHidden();

  await tab(page, 'References').click();
  await expect(
    page.getByRole('navigation', { name: 'Documents' })
  ).toBeHidden();
  await expect(tab(page, 'References')).toHaveAttribute(
    'aria-selected',
    'false'
  );
});

test('the Explorer holds the documents and images; the view is remembered', async ({
  page,
}) => {
  await tab(page, 'Explorer').click();
  const docs = page.getByRole('navigation', { name: 'Documents' });
  await expect(
    docs.getByRole('button', { name: 'A Short Example', exact: true })
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Images' })).toBeVisible();

  await tab(page, 'Storage').click();
  await page.reload();
  await editorReady(page);
  await expect(page.getByRole('region', { name: 'Storage' })).toBeVisible();
  await expect(tab(page, 'Storage')).toHaveAttribute('aria-selected', 'true');
});

test('Ctrl/⌘+B and the toolbar button still toggle the side bar', async ({
  page,
}) => {
  await tab(page, 'Versions').click();
  await page.getByRole('button', { name: 'Toggle documents' }).click();
  await expect(page.getByRole('region', { name: 'Versions' })).toBeHidden();
  await page.keyboard.press('ControlOrMeta+b');
  await expect(page.getByRole('region', { name: 'Versions' })).toBeVisible();
});

test('arrow keys move between views, as in a tablist', async ({ page }) => {
  await tab(page, 'Explorer').focus();
  await page.keyboard.press('ArrowDown');
  await expect(tab(page, 'Versions')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(tab(page, 'Storage')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Storage' })).toBeVisible();
});

test('a storage warning shows on the Storage icon while another view is open', async ({
  page,
}) => {
  // Nearly full storage: the status line warns (ADR 0019).
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'estimate', {
      value: async () => ({ usage: 950, quota: 1000 }),
    });
  });
  await page.reload();
  await editorReady(page);
  await expect(
    bar(page).getByRole('tab', { name: 'Storage (needs attention)' })
  ).toBeVisible();
});
