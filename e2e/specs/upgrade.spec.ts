import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { editorInput, editorReady, setSource } from '../support/editor.ts';
import { openView } from '../support/views.ts';

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
    await openView(page, 'References');
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

  test('after a newer version takes the database, this tab saves what it had and stops taking edits', async ({
    page,
  }) => {
    await page.goto('/');
    await setSource(page, 'Typed before the update.');
    const newer = await page.context().newPage();
    await newer.goto('/favicon.svg');
    await newer.evaluate(
      (name) =>
        new Promise<void>((resolve) => {
          const r = indexedDB.open(name, 1000);
          r.onsuccess = () => {
            r.result.close();
            resolve();
          };
        }),
      DB
    );
    await expect(notice(page)).toContainText('read-only');
    // Edits now could never be stored, so the editor refuses them.
    await editorInput(page).focus();
    await page.keyboard.type('lost?');
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
      .toBe('Typed before the update.');
    // What was typed before the update reached the database.
    const stored = await newer.evaluate(
      (name) =>
        new Promise<string[]>((resolve) => {
          const r = indexedDB.open(name);
          r.onsuccess = () => {
            const all = r.result
              .transaction('documents')
              .objectStore('documents')
              .getAll();
            all.onsuccess = () =>
              resolve(
                (all.result as { source: string }[]).map((d) => d.source)
              );
          };
        }),
      DB
    );
    expect(stored).toContain('Typed before the update.');
  });
});
