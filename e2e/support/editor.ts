import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** The editor's text input, as assistive technology sees it. */
export const editorInput = (page: Page) =>
  page.getByRole('textbox', { name: 'LaTeX source' });

/** Wait until the Monaco editor has loaded. */
export async function editorReady(page: Page) {
  await expect(page.locator('latex-editor .monaco-editor')).toBeVisible();
}

/**
 * Replace the whole document the way a user would: focus, select all, paste.
 * (Typing a multi-line document would get Monaco's auto-indent on every line.)
 * Then check the editor really holds exactly that text.
 */
export async function setSource(page: Page, text: string) {
  await editorReady(page);
  await editorInput(page).focus();
  await page.keyboard.press('ControlOrMeta+a');
  if (text === '') await page.keyboard.press('Delete');
  else
    await editorInput(page).evaluate((el, value) => {
      const data = new DataTransfer();
      data.setData('text/plain', value);
      el.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        })
      );
    }, text);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            document.querySelector('latex-editor') as unknown as {
              value: string;
            }
          ).value
      )
    )
    .toBe(text);
}
