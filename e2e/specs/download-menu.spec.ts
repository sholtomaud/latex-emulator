import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { editorReady } from '../support/editor.ts';

/**
 * One Download button in the toolbar, with the four downloads in a menu:
 * the toolbar stays minimal, and the choices appear when asked for.
 */

const button = (page: Page) =>
  page.getByRole('button', { name: 'Download', exact: true });
const menu = (page: Page) => page.getByRole('menu', { name: 'Download' });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await editorReady(page);
});

test('the toolbar has one Download button; it opens the four downloads', async ({
  page,
}) => {
  const toolbar = page.locator('header.toolbar');
  for (const name of ['Download .tex', 'Download PDF'])
    await expect(toolbar.getByRole('button', { name })).toHaveCount(0);
  await expect(button(page)).toHaveAttribute('aria-expanded', 'false');
  await button(page).click();
  await expect(button(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(menu(page).getByRole('menuitem')).toHaveText([
    /PDF/,
    /Preprint/,
    /Project/,
    /\.tex/,
  ]);
  await expect(
    menu(page).getByRole('menuitem', { name: 'Download PDF' })
  ).toBeFocused();
});

test('choosing an item downloads it and closes the menu', async ({ page }) => {
  await button(page).click();
  const downloadPromise = page.waitForEvent('download');
  await menu(page).getByRole('menuitem', { name: 'Download .tex' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    'a-short-example.tex'
  );
  await expect(menu(page)).toBeHidden();
  await expect(button(page)).toHaveAttribute('aria-expanded', 'false');
});

test('keyboard: arrows move, Escape closes and returns to the button', async ({
  page,
}) => {
  await button(page).focus();
  await page.keyboard.press('ArrowDown');
  const items = menu(page).getByRole('menuitem');
  await expect(items.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.nth(3)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(0)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
  await expect(button(page)).toBeFocused();
});

test('clicking elsewhere closes it', async ({ page }) => {
  await button(page).click();
  await expect(menu(page)).toBeVisible();
  await page.locator('latex-editor').click();
  await expect(menu(page)).toBeHidden();
});
