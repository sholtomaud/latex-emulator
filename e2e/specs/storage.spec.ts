import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import { editorReady, setSource } from '../support/editor.ts';
import { unzip } from '../support/unzip.ts';

/**
 * Keeping documents safe in the browser (ADR 0019): the storage status,
 * asking for persistent storage, and backing up and restoring the whole
 * workspace.
 */

const storagePanel = (page: Page) =>
  page.getByRole('region', { name: 'Storage' });

/** Make navigator.storage answer as a browser that has (not) protected us. */
async function fakePersistence(page: Page, granted: boolean) {
  await page.addInitScript((granted) => {
    const w = window as unknown as { persistCalls: number };
    w.persistCalls = 0;
    let persisted = false;
    Object.defineProperty(navigator.storage, 'persisted', {
      value: async () => persisted,
    });
    Object.defineProperty(navigator.storage, 'persist', {
      value: async () => {
        w.persistCalls++;
        persisted = granted;
        return granted;
      },
    });
  }, granted);
}

async function openExplorer(page: Page) {
  await page.goto('/');
  await editorReady(page);
  await page.getByRole('button', { name: 'Toggle documents' }).click();
}

test('the storage status says documents are not protected until the browser agrees', async ({
  page,
}) => {
  await fakePersistence(page, true);
  await openExplorer(page);
  await expect(storagePanel(page)).toContainText(
    'Stored in this browser only.'
  );
  await expect(storagePanel(page)).toContainText('Not protected');
  await expect(storagePanel(page)).toContainText('No backup yet.');
  await expect(storagePanel(page)).toContainText(/Using .* of /);

  // Persistence is asked for once the user has written something.
  await setSource(
    page,
    '\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n'
  );
  await expect(storagePanel(page)).toContainText('Protected from the browser');
  expect(
    await page.evaluate(
      () => (window as unknown as { persistCalls: number }).persistCalls
    )
  ).toBe(1);
});

test('a refused request is said plainly and not repeated on every save', async ({
  page,
}) => {
  await fakePersistence(page, false);
  await openExplorer(page);
  await setSource(page, 'one');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { persistCalls: number }).persistCalls
      )
    )
    .toBe(1);
  await setSource(page, 'two');
  await page.waitForTimeout(800);
  expect(
    await page.evaluate(
      () => (window as unknown as { persistCalls: number }).persistCalls
    )
  ).toBe(1);
  await expect(storagePanel(page)).toContainText('Not protected');
});

test('Back up all, then restore it into a browser that lost its storage', async ({
  page,
  browser,
}) => {
  await openExplorer(page);
  await page
    .locator('image-panel .add-image-input')
    .setInputFiles('fixtures/figure-basic/images/plot.png');
  await expect(page.locator('image-panel .image-item')).toHaveCount(1);
  await setSource(page, 'The paper text.');
  await page.getByRole('button', { name: 'Save version' }).click();
  await expect(page.locator('.version-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'New document' }).click();
  // Wait until the new document is in the editor before replacing its text.
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
    .toContain('\\title{Untitled}');
  await setSource(page, 'Second document.');

  const downloadPromise = page.waitForEvent('download');
  await storagePanel(page).getByRole('button', { name: 'Back up all' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^latex-emulator-backup-\d{4}-\d{2}-\d{2}\.zip$/
  );
  const path = (await download.path())!;
  const files = unzip(fs.readFileSync(path));
  expect([...files.keys()]).toContain('workspace.json');
  expect([...files.keys()]).toContain('documents/a-short-example.tex');
  expect(files.get('documents/a-short-example.tex')!.toString()).toBe(
    'The paper text.'
  );
  await expect(storagePanel(page)).toContainText('Last backup today.');

  // A fresh browser profile: nothing stored, as after "Clear site data".
  const fresh = await browser.newContext();
  const other = await fresh.newPage();
  await openExplorer(other);
  const docs = other.getByRole('navigation', { name: 'Documents' });
  await other.locator('storage-panel .restore-input').setInputFiles({
    name: 'backup.zip',
    mimeType: 'application/zip',
    buffer: fs.readFileSync(path),
  });
  await expect(storagePanel(other)).toContainText('Restored 2 documents');
  await expect(
    docs.getByRole('button', { name: 'Untitled', exact: true })
  ).toBeVisible();
  // The restored copy of the starter document is newer than the fresh one.
  await docs
    .getByRole('button', { name: 'A Short Example', exact: true })
    .click();
  await expect
    .poll(() =>
      other.evaluate(
        () =>
          (
            document.querySelector('latex-editor') as unknown as {
              value: string;
            }
          ).value
      )
    )
    .toBe('The paper text.');
  await expect(other.locator('.version-item')).toHaveCount(1);
  await expect(other.locator('image-panel .image-item')).toHaveCount(1);

  // Restoring the same backup again changes nothing.
  await other.locator('storage-panel .restore-input').setInputFiles({
    name: 'backup.zip',
    mimeType: 'application/zip',
    buffer: fs.readFileSync(path),
  });
  await expect(storagePanel(other)).toContainText('Nothing to restore');
  await fresh.close();
});

test('a file that is not a backup is refused with a reason', async ({
  page,
}) => {
  await openExplorer(page);
  await page.locator('storage-panel .restore-input').setInputFiles({
    name: 'notes.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('not a zip'),
  });
  await expect(storagePanel(page)).toContainText('This is not a zip file.');
});
