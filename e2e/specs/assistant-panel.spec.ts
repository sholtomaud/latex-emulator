import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { editorReady } from '../support/editor.ts';

/**
 * The secondary side bar (ADR 0022 phase 3): the Assistant on the right,
 * opened from the bottom of the activity bar or with Ctrl/⌘+Alt+B. It is
 * a fourth column on wide screens, laid over the preview when space is
 * short (so the editor keeps its width), and a drawer on phones.
 */

const toggle = (page: Page) =>
  page.getByRole('button', { name: 'Assistant', exact: true });
const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Assistant' });
const box = async (page: Page, selector: string) =>
  (await page.locator(selector).boundingBox())!;

async function start(page: Page, width = 1280, height = 800) {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await editorReady(page);
}

test('the Assistant button opens and closes the panel; it is remembered', async ({
  page,
}) => {
  await start(page);
  await expect(panel(page)).toBeHidden();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  // It sits in the activity bar, but is not one of the primary side bar's views.
  await expect(
    page.getByRole('tablist', { name: 'Side bar views' }).getByRole('tab')
  ).toHaveCount(4);

  await toggle(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(panel(page)).toContainText('style profile');

  await page.reload();
  await editorReady(page);
  await expect(panel(page)).toBeVisible();

  // Its own close button closes it and hands focus back to the toggle.
  await panel(page).getByRole('button', { name: 'Close assistant' }).click();
  await expect(panel(page)).toBeHidden();
  await expect(toggle(page)).toBeFocused();
  await page.reload();
  await editorReady(page);
  await expect(panel(page)).toBeHidden();
});

test('Ctrl/⌘+Alt+B toggles it, even from the editor, and leaves the explorer alone', async ({
  page,
}) => {
  await start(page);
  await page.locator('latex-editor .monaco-editor').click();
  await page.keyboard.press('ControlOrMeta+Alt+b');
  await expect(panel(page)).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Documents' })
  ).toBeHidden();
  await page.keyboard.press('ControlOrMeta+Alt+b');
  await expect(panel(page)).toBeHidden();
});

test('on a wide screen it is a fourth column beside the preview', async ({
  page,
}) => {
  await start(page, 1600);
  await toggle(page).click();
  const preview = await box(page, '.pane-preview');
  const aside = await box(page, 'assistant-panel');
  expect(preview.x + preview.width).toBeLessThanOrEqual(aside.x + 0.5);
  expect(aside.x + aside.width).toBeCloseTo(1600, 0);
});

test('when space is short it lies over the preview; the editor keeps its width', async ({
  page,
}) => {
  await start(page, 1100);
  const before = await box(page, '.pane[aria-label="LaTeX source"]');
  await toggle(page).click();
  await expect(panel(page)).toBeVisible();
  const after = await box(page, '.pane[aria-label="LaTeX source"]');
  expect(after.width).toBeCloseTo(before.width, 0);
  const preview = await box(page, '.pane-preview');
  const aside = await box(page, 'assistant-panel');
  expect(aside.x).toBeGreaterThan(preview.x);
  expect(aside.x + aside.width).toBeCloseTo(1100, 0);
});

test('on a phone it is a drawer from the right, inside the screen', async ({
  page,
}) => {
  await start(page, 390, 844);
  await toggle(page).click();
  await expect(panel(page)).toBeVisible();
  const aside = await box(page, 'assistant-panel');
  expect(aside.x).toBeGreaterThanOrEqual(0);
  expect(aside.x + aside.width).toBeCloseTo(390, 0);
  expect(aside.width).toBeLessThanOrEqual(390 * 0.9);
});
