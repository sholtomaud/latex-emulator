import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { editorReady } from '../support/editor.ts';

/**
 * The app open in two tabs (or a tab and the installed window) while the
 * database schema changes. IndexedDB can't upgrade while another tab holds
 * an older version open, so each side must cope, visibly.
 */

const DB = 'latex-emulator';
/** The app's own notice (Monaco has alert regions of its own). */
const notice = (page: Page) =>
  page.locator('app-shell .app-notice[role="alert"]');

/** Another same-origin tab that holds the database open at `version`. */
async function holdDatabase(page: Page, version: number) {
  const other = await page.context().newPage();
  await other.goto('/favicon.svg');
  await other.evaluate(
    ([name, v]) =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open(name as string, v as number);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('documents'))
            db.createObjectStore('documents', { keyPath: 'id' });
        };
        r.onsuccess = () => {
          (window as unknown as { held: IDBDatabase }).held = r.result;
          resolve();
        };
        r.onerror = () => reject(r.error);
      }),
    [DB, version]
  );
  return other;
}

test.describe('database upgrades with the app open elsewhere', () => {
  test('an older tab blocking the upgrade shows a notice; the app starts once it closes', async ({
    page,
  }) => {
    // An earlier release (database version 1) is still open in another tab.
    const old = await holdDatabase(page, 1);
    await page.goto('/');
    await expect(notice(page)).toContainText('Close other LaTeX Emulator tabs');

    await old.evaluate(() =>
      (window as unknown as { held: IDBDatabase }).held.close()
    );
    await expect(notice(page)).toBeHidden();
    await editorReady(page);
    await page.getByRole('button', { name: 'Toggle documents' }).click();
    await expect(
      page.getByRole('navigation', { name: 'Documents' }).getByRole('button', {
        name: 'A Short Example',
        exact: true,
      })
    ).toBeVisible();
  });

  test('a newer version opening elsewhere is not blocked by this tab, which says so', async ({
    page,
  }) => {
    await page.goto('/');
    await editorReady(page);
    await page.getByRole('button', { name: 'Toggle documents' }).click();
    await expect(
      page.getByRole('region', { name: 'Bibliography' })
    ).toContainText('references.bib');
    const newer = await page.context().newPage();
    await newer.goto('/favicon.svg');
    const opened = await newer.evaluate(
      (name) =>
        new Promise<string>((resolve) => {
          const r = indexedDB.open(name, 1000);
          r.onblocked = () => resolve('blocked');
          r.onsuccess = () => resolve('opened');
        }),
      DB
    );
    expect(opened).toBe('opened');
    await expect(notice(page)).toContainText('newer version');
  });
});
