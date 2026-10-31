import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { editorReady, setSource } from '../support/editor.ts';

interface PrintRecord {
  title: string;
  stamp: string;
  heading: string;
}

const sha256 = (text: string) =>
  createHash('sha256').update(text, 'utf8').digest('hex');
const sample = fs.readFileSync('fixtures/article-basic/input.tex', 'utf8');
const explorer = (page: Page) =>
  page.getByRole('navigation', { name: 'Documents' });
const versions = (page: Page) => page.getByRole('region', { name: 'Versions' });

/** Replace the preview iframe's print() with a recorder of what would print. */
async function recordPrints(page: Page) {
  await page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>(
      'latex-preview iframe'
    )!;
    const w = window as unknown as { prints: PrintRecord[] };
    w.prints = [];
    frame.contentWindow!.print = () => {
      const doc = frame.contentDocument!;
      w.prints.push({
        title: doc.title,
        stamp: doc.querySelector('style[data-preprint]')?.textContent ?? '',
        heading:
          doc.querySelector('header.maketitle .title')?.textContent ?? '',
      });
    };
  });
}
const prints = (page: Page) =>
  page.evaluate(() => (window as unknown as { prints: PrintRecord[] }).prints);
const stampNow = (page: Page) =>
  page
    .frameLocator('latex-preview iframe')
    .locator('style[data-preprint]')
    .evaluate((el) => el.textContent ?? '');

async function openExplorer(page: Page) {
  const toggle = page.getByRole('button', { name: 'Toggle documents' });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true')
    await toggle.click();
  await expect(explorer(page)).toBeVisible();
}

test.describe('versions and preprints', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await editorReady(page);
    await expect(
      page.frameLocator('latex-preview iframe').locator('header.maketitle')
    ).toBeVisible();
    await recordPrints(page);
  });

  test('Download Preprint prints a v0.1.0 snapshot stamped with its hash', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Download Preprint' }).click();
    await expect.poll(() => prints(page)).toHaveLength(1);
    const [p] = await prints(page);
    expect(p.title).toBe('a-short-example-v0.1.0-preprint');
    expect(p.stamp).toContain('Preprint · v0.1.0 · ');
    expect(p.stamp).toContain(`SHA-256 ${sha256(sample).slice(0, 16)}`);
    expect(p.heading).toBe('A Short Example');
    // The stamp is only there while printing.
    await expect.poll(() => stampNow(page)).toBe('');
  });

  test('unchanged text reuses the version; an edit bumps the patch', async ({
    page,
  }) => {
    const preprint = page.getByRole('button', { name: 'Download Preprint' });
    await preprint.click();
    await expect.poll(() => prints(page)).toHaveLength(1);
    await preprint.click();
    await expect.poll(() => prints(page)).toHaveLength(2);
    await setSource(page, sample.replace('A Short Example', 'Revised'));
    await preprint.click();
    await expect.poll(() => prints(page)).toHaveLength(3);
    expect((await prints(page)).map((p) => p.title)).toEqual([
      'a-short-example-v0.1.0-preprint',
      'a-short-example-v0.1.0-preprint',
      'a-short-example-v0.1.1-preprint',
    ]);
  });

  test('the version history saves minor releases and survives a reload', async ({
    page,
  }) => {
    await openExplorer(page);
    await versions(page).getByRole('button', { name: 'Save version' }).click();
    await expect(versions(page).getByRole('listitem')).toHaveCount(1);
    await versions(page)
      .getByRole('combobox', { name: 'Version bump' })
      .selectOption('minor');
    await versions(page).getByRole('button', { name: 'Save version' }).click();
    await expect(versions(page).getByRole('listitem').first()).toContainText(
      'v0.2.0'
    );
    await page.reload();
    await openExplorer(page);
    await expect(versions(page).getByRole('listitem')).toHaveCount(2);
    await expect(versions(page).getByRole('listitem').nth(1)).toContainText(
      'v0.1.0'
    );
  });

  test('a version downloads as .tex whose SHA-256 matches the one shown', async ({
    page,
  }) => {
    await openExplorer(page);
    await versions(page).getByRole('button', { name: 'Save version' }).click();
    const item = versions(page).getByRole('listitem').first();
    await expect(item).toContainText(sha256(sample).slice(0, 16));
    const shown = await item.getAttribute('title');
    const downloadPromise = page.waitForEvent('download');
    await item.getByRole('button', { name: 'Download v0.1.0 .tex' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('a-short-example-v0.1.0.tex');
    const text = fs.readFileSync((await download.path())!, 'utf8');
    expect(text).toBe(sample);
    expect(shown).toContain(sha256(text));
  });

  test('a preprint of an older version prints that version, then restores the preview', async ({
    page,
  }) => {
    await openExplorer(page);
    await versions(page).getByRole('button', { name: 'Save version' }).click();
    await setSource(page, sample.replace('A Short Example', 'Changed Since'));
    const title = page
      .frameLocator('latex-preview iframe')
      .locator('header.maketitle .title');
    await expect(title).toHaveText('Changed Since');
    await versions(page)
      .getByRole('button', { name: 'Preprint v0.1.0' })
      .click();
    await expect.poll(() => prints(page)).toHaveLength(1);
    expect((await prints(page))[0].heading).toBe('A Short Example');
    await expect(title).toHaveText('Changed Since');
  });
});
