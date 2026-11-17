import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { editorReady, setSource } from '../support/editor.ts';
import { openView } from '../support/views.ts';

/**
 * Comments (ADR 0025): threads on a selection, their own underline in the
 * editor, kept in step with edits, replies and resolving, kept per
 * document across reloads, never in the .tex.
 */

const SOURCE =
  '\\documentclass{article}\n\\begin{document}\nEnergy is the currency of systems.\n\\end{document}\n';

const view = (page: Page) => page.getByRole('region', { name: 'Comments' });
const threads = (page: Page) =>
  view(page)
    .getByRole('list', { name: 'Comment threads' })
    .getByRole('listitem')
    .filter({ has: page.locator('.thread-quote') });
const underline = (page: Page) => page.locator('latex-editor .latex-comment');
const editorValue = (page: Page) =>
  page.evaluate(
    () =>
      (document.querySelector('latex-editor') as unknown as { value: string })
        .value
  );

/** Double-click `word` where it is drawn in the editor. */
async function selectWord(page: Page, word: string) {
  const box = await page
    .locator('latex-editor .view-line', { hasText: word })
    .first()
    .evaluate((line, w) => {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        // Monaco draws spaces as U+00A0.
        const at = (n.textContent ?? '').replace(/\u00a0/g, ' ').indexOf(w);
        if (at < 0) continue;
        const r = document.createRange();
        r.setStart(n, at);
        r.setEnd(n, at + w.length);
        const b = r.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      }
      throw new Error(`${w} not drawn`);
    }, word);
  await page.mouse.dblclick(box.x, box.y);
}

async function comment(page: Page, word: string, text: string) {
  await selectWord(page, word);
  await page.keyboard.press('ControlOrMeta+Alt+m');
  await expect(
    view(page).getByRole('form', { name: 'New comment' })
  ).toBeVisible();
  await view(page).getByLabel('Comment', { exact: true }).fill(text);
  await view(page)
    .getByLabel('Comment', { exact: true })
    .press('ControlOrMeta+Enter');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await editorReady(page);
  await setSource(page, SOURCE);
});

test('Ctrl/⌘+Alt+M comments on the selection: a thread, and its own underline', async ({
  page,
}) => {
  await expect(view(page)).toBeHidden();
  await comment(page, 'Energy', 'Define energy here?');
  await expect(view(page)).toBeVisible();
  await expect(threads(page)).toHaveCount(1);
  await expect(threads(page).first()).toContainText('“Energy”');
  await expect(threads(page).first()).toContainText(
    /You\s*Define energy here\?/
  );
  await expect(underline(page)).toHaveText('Energy');
  // The comment is not in the document.
  expect(await editorValue(page)).toBe(SOURCE);
});

test('the underline follows edits before and inside the commented text', async ({
  page,
}) => {
  await comment(page, 'currency', 'Metaphor?');
  await expect(underline(page)).toHaveText('currency');
  // Type at the start of line 3: the range moves with its text.
  await page
    .locator('latex-editor .view-line', { hasText: 'Energy' })
    .click({ position: { x: 1, y: 5 } });
  await page.keyboard.press('Home');
  await page.keyboard.type('Note: ');
  await expect(underline(page)).toHaveText('currency');
  await expect(threads(page).first()).toContainText('“currency”');
});

test('reply, resolve (the underline goes) and reopen; kept across a reload', async ({
  page,
}) => {
  await comment(page, 'systems', 'Which systems?');
  const thread = threads(page).first();
  await thread.getByLabel('Reply').fill('Ecological ones.');
  await thread.getByRole('button', { name: 'Reply' }).click();
  await expect(thread).toContainText(/You\s*Ecological ones\./);
  await expect(thread.getByLabel('Reply')).toHaveValue('');

  await thread.getByRole('button', { name: 'Resolve' }).click();
  await expect(underline(page)).toHaveCount(0);
  await expect(thread).toHaveAccessibleName(/resolved/);

  await page.waitForTimeout(700);
  await page.reload();
  await editorReady(page);
  await openView(page, 'Comments');
  await expect(threads(page)).toHaveCount(1);
  await expect(threads(page).first()).toContainText('Ecological ones.');
  await threads(page).first().getByRole('button', { name: 'Reopen' }).click();
  await expect(underline(page)).toHaveText('systems');
});

test('each document has its own comments; deleted text is reported, not dropped', async ({
  page,
}) => {
  await comment(page, 'Energy', 'One');
  await openView(page, 'Explorer');
  await page.getByRole('button', { name: 'New document' }).click();
  await openView(page, 'Comments');
  await expect(threads(page)).toHaveCount(0);
  await openView(page, 'Explorer');
  await page
    .getByRole('button', { name: 'A Short Example', exact: true })
    .click();
  await openView(page, 'Comments');
  await expect(threads(page)).toHaveCount(1);

  await setSource(
    page,
    SOURCE.replace('Energy is the currency', 'Power is the currency')
  );
  await expect(threads(page).first()).toContainText(
    'Its text is no longer in the document.'
  );
  await expect(underline(page)).toHaveCount(0);
});
