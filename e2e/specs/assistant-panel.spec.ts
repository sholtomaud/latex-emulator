import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { editorReady } from '../support/editor.ts';

/**
 * The secondary side bar (ADR 0022, 0023): the Assistant on the right,
 * opened from the bottom of the activity bar or with Ctrl/⌘+Alt+B.
 * Pinned (the default), it is a column like the left side bar; unpinned,
 * it floats over the preview and closes when you go back to the editor.
 * Its left edge resizes it. On phones it is a drawer.
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
  ).toHaveCount(5);

  await toggle(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(panel(page)).toContainText('Ask about your document');

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

const editorBox = (page: Page) => box(page, '.pane[aria-label="LaTeX source"]');
const pinButton = (page: Page) =>
  panel(page).getByRole('button', { name: 'Pin assistant' });

test('pinned, it is a column: the editor and preview make room, at any width', async ({
  page,
}) => {
  for (const width of [1100, 1600]) {
    await start(page, width);
    // Open from the last pass (it is remembered): close it to measure.
    if (await panel(page).isVisible()) await toggle(page).click();
    await expect(panel(page)).toBeHidden();
    const before = await editorBox(page);
    await toggle(page).click();
    await expect(pinButton(page)).toHaveAttribute('aria-pressed', 'true');
    const preview = await box(page, '.pane-preview');
    const aside = await box(page, 'assistant-panel');
    expect(preview.x + preview.width).toBeLessThanOrEqual(aside.x + 0.5);
    expect(aside.x + aside.width).toBeCloseTo(width, 0);
    expect((await editorBox(page)).width).toBeLessThan(before.width);
  }
});

test('unpinned, it floats over the preview and closes when you go back to the editor', async ({
  page,
}) => {
  await start(page, 1280);
  const before = await editorBox(page);
  await toggle(page).click();
  await pinButton(page).click();
  await expect(pinButton(page)).toHaveAttribute('aria-pressed', 'false');
  expect((await editorBox(page)).width).toBeCloseTo(before.width, 0);
  const preview = await box(page, '.pane-preview');
  const aside = await box(page, 'assistant-panel');
  expect(aside.x).toBeGreaterThan(preview.x);
  expect(aside.x + aside.width).toBeCloseTo(1280, 0);

  // Typing in it keeps it open; clicking into the editor closes it.
  await panel(page).getByLabel('Message the assistant').click();
  await expect(panel(page)).toBeVisible();
  await page.locator('latex-editor .monaco-editor').click();
  await expect(panel(page)).toBeHidden();

  // Unpinned is remembered.
  await page.reload();
  await editorReady(page);
  await toggle(page).click();
  await expect(pinButton(page)).toHaveAttribute('aria-pressed', 'false');
});

test('its left edge resizes it, by dragging or with the arrow keys; the width is remembered', async ({
  page,
}) => {
  await start(page, 1400);
  await toggle(page).click();
  const handle = panel(page).getByRole('separator', {
    name: 'Resize assistant',
  });
  const start0 = await box(page, 'assistant-panel');
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + 200);
  await page.mouse.down();
  await page.mouse.move(h.x - 150, h.y + 200, { steps: 5 });
  await page.mouse.up();
  const dragged = await box(page, 'assistant-panel');
  expect(dragged.width).toBeGreaterThan(start0.width + 100);

  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(async () => (await box(page, 'assistant-panel')).width)
    .toBeCloseTo(dragged.width - 16, 0);
  await page.keyboard.press('Home');
  await expect(handle).toHaveAttribute('aria-valuenow', '280');

  await page.reload();
  await editorReady(page);
  expect((await box(page, 'assistant-panel')).width).toBeCloseTo(280, 0);
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
